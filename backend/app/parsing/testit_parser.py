from __future__ import annotations

import json
import re

from app.parsing.html_cleaner import clean_html
from app.parsing.attachment_parser import extract_attachments
from app.schemas.testcase import NormalizedTestCase, TestCaseStep

_PRECONDITION_HEADERS = re.compile(
    r"^\s*(предусловия|предусловие|preconditions?|pre-conditions?)\s*:?\s*$",
    re.IGNORECASE,
)

_STEP_HEADERS = re.compile(
    r"^\s*(шаги|steps?|шаги для воспроизведения|steps to reproduce|шаги воспроизведения)\s*:?\s*$",
    re.IGNORECASE,
)

_EXPECTED_HEADERS = re.compile(
    r"^\s*(ожидаемый результат|ожидаемые результаты|expected results?|expected|result)\s*:?\s*$",
    re.IGNORECASE,
)

# "Ожидаемый результат: <text on same line>"
_EXPECTED_INLINE = re.compile(
    r"^\s*(ожидаемый результат|ожидаемые результаты|expected results?|expected|result)\s*:\s*(.+)$",
    re.IGNORECASE,
)

# "Заголовок: <title>" or "Title: <title>"
_TITLE_HEADER = re.compile(
    r"^\s*(заголовок|название|title|name)\s*:\s*(.+)$",
    re.IGNORECASE,
)

# "ID: TC-1.1" or "ID: 123" — identifier line, not a title
_ID_LINE = re.compile(
    r"^\s*id\s*:\s*\S+\s*$",
    re.IGNORECASE,
)

_NUMBERED_LINE = re.compile(r"^\s*(\d+)[.)]\s+(.+)$")


def _is_short_title(line: str) -> bool:
    return 0 < len(line.strip()) <= 120


def parse_testit_content(raw: str) -> NormalizedTestCase:
    if not raw or not raw.strip():
        return NormalizedTestCase(warnings=["Empty input provided"])

    # Auto-detect JSON input and delegate to workitem mapper
    stripped = raw.strip()
    if stripped.startswith('{') or stripped.startswith('['):
        try:
            parsed = json.loads(stripped)
            from app.parsing.testit_workitem_mapper import normalize_testit_workitem
            if isinstance(parsed, dict):
                return normalize_testit_workitem(parsed)
            if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                return normalize_testit_workitem(parsed[0])
        except (json.JSONDecodeError, Exception):
            pass  # not valid JSON, fall through to text parsing

    # Use LLM to parse free-form text (handles all language/format variations)
    try:
        from app.core.llm_client import parse_testcase_with_llm
        llm_result = parse_testcase_with_llm(raw)
        if llm_result is not None and (llm_result.title or llm_result.steps):
            return NormalizedTestCase(
                title=llm_result.title or None,
                description=llm_result.description,
                preconditions=[
                    TestCaseStep(action=s.action, expected=s.expected, test_data=s.test_data, comments=s.comments)
                    for s in llm_result.preconditions
                ],
                steps=[
                    TestCaseStep(action=s.action, expected=s.expected, test_data=s.test_data, comments=s.comments)
                    for s in llm_result.steps
                ],
                postconditions=[
                    TestCaseStep(action=s.action, expected=s.expected, test_data=s.test_data, comments=s.comments)
                    for s in llm_result.postconditions
                ],
                tags=llm_result.tags,
                priority=llm_result.priority,
                status=llm_result.status,
                duration=llm_result.duration,
                attachments=extract_attachments(raw),
            )
    except Exception:
        pass  # LLM unavailable — fall through to regex parser

    cleaned = clean_html(raw)
    attachments = extract_attachments(raw)
    warnings: list[str] = []

    lines = [l for l in cleaned.splitlines()]
    non_empty = [l for l in lines if l.strip()]

    if not non_empty:
        return NormalizedTestCase(warnings=["Empty content after cleaning"])

    title: str | None = None
    description_lines: list[str] = []
    preconditions: list[TestCaseStep] = []
    steps: list[TestCaseStep] = []

    # Scan early lines for explicit title headers or ID line
    remaining_lines = list(lines)
    for i, line in enumerate(non_empty[:5]):  # check first 5 non-empty lines
        stripped = line.strip()
        title_match = _TITLE_HEADER.match(stripped)
        if title_match:
            title = title_match.group(2).strip().rstrip('.')
            idx = lines.index(line)
            remaining_lines = lines[idx + 1:]
            break
        if _ID_LINE.match(stripped):
            # skip ID line, continue looking
            idx = lines.index(line)
            remaining_lines = lines[idx + 1:]
            continue
    else:
        # No explicit title header found — use first non-empty non-ID line as title
        first_line = non_empty[0].strip()
        if (
            _is_short_title(first_line)
            and not _PRECONDITION_HEADERS.match(first_line)
            and not _STEP_HEADERS.match(first_line)
            and not _ID_LINE.match(first_line)
        ):
            title = first_line
            remaining_lines = lines[lines.index(non_empty[0]) + 1:]

    lines = remaining_lines

    mode = "description"
    current_step_action: str | None = None
    current_step_expected: list[str] = []
    numbered_steps_found = False
    expected_found = False

    def flush_step():
        nonlocal current_step_action, current_step_expected
        if current_step_action:
            steps.append(TestCaseStep(
                action=current_step_action,
                expected="\n".join(current_step_expected).strip() or None,
            ))
        current_step_action = None
        current_step_expected = []

    for line in lines:
        stripped = line.strip()

        if _PRECONDITION_HEADERS.match(stripped):
            flush_step()
            mode = "preconditions"
            continue

        if _STEP_HEADERS.match(stripped):
            flush_step()
            mode = "steps"
            continue

        # "Ожидаемый результат: <text on same line>"
        inline_expected = _EXPECTED_INLINE.match(stripped)
        if inline_expected and inline_expected.group(2).strip():
            text = inline_expected.group(2).strip()
            if mode == "steps" and current_step_action:
                current_step_expected.append(text)
                expected_found = True
                flush_step()
                mode = "steps"
            elif steps:
                last = steps[-1]
                existing = last.expected or ""
                steps[-1] = TestCaseStep(
                    action=last.action,
                    expected=(existing + "\n" + text).strip() if existing else text,
                )
                expected_found = True
            continue

        if _EXPECTED_HEADERS.match(stripped):
            if mode == "steps" and current_step_action:
                mode = "expected"
            else:
                mode = "expected_standalone"
            continue

        # "Заголовок: <title>" inside body — set title if not yet set
        title_match = _TITLE_HEADER.match(stripped)
        if title_match and title is None:
            title = title_match.group(2).strip().rstrip('.')
            continue

        if not stripped:
            if mode == "expected":
                flush_step()
                mode = "steps"
            continue

        # Numbered line detection (works in any mode)
        numbered = _NUMBERED_LINE.match(stripped)
        if numbered and mode in ("description", "steps", "preconditions"):
            flush_step()
            mode = "steps"
            numbered_steps_found = True
            current_step_action = numbered.group(2)
            continue

        if mode == "description":
            description_lines.append(stripped)
        elif mode == "preconditions":
            preconditions.append(TestCaseStep(action=stripped))
        elif mode == "steps":
            if current_step_action is None:
                current_step_action = stripped
            else:
                # next line without numbering — append to action
                current_step_action += " " + stripped
        elif mode == "expected":
            current_step_expected.append(stripped)
            expected_found = True
        elif mode == "expected_standalone":
            # attach to last step if exists
            if steps:
                last = steps[-1]
                existing = last.expected or ""
                steps[-1] = TestCaseStep(
                    action=last.action,
                    expected=(existing + "\n" + stripped).strip(),
                )
            expected_found = True

    flush_step()

    if not steps:
        warnings.append("Could not confidently extract steps from raw content")
    elif not expected_found and not any(s.expected for s in steps):
        warnings.append("Could not confidently extract expected results")

    description = "\n".join(description_lines).strip()

    return NormalizedTestCase(
        title=title,
        description=description,
        preconditions=preconditions,
        steps=steps,
        attachments=attachments,
        warnings=warnings,
    )
