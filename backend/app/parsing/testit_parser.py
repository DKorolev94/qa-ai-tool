from __future__ import annotations

import re

from app.parsing.html_cleaner import clean_html
from app.parsing.attachment_parser import extract_attachments
from app.schemas.testcase import NormalizedTestCase, TestCaseStep

_PRECONDITION_HEADERS = re.compile(
    r"^\s*(предусловия|предусловие|preconditions?|pre-conditions?)\s*:?\s*$",
    re.IGNORECASE,
)

_STEP_HEADERS = re.compile(
    r"^\s*(шаги|steps?)\s*:?\s*$",
    re.IGNORECASE,
)

_EXPECTED_HEADERS = re.compile(
    r"^\s*(ожидаемый результат|expected results?|expected|result)\s*:?\s*$",
    re.IGNORECASE,
)

_NUMBERED_LINE = re.compile(r"^\s*(\d+)[.)]\s+(.+)$")


def _is_short_title(line: str) -> bool:
    return 0 < len(line.strip()) <= 120


def parse_testit_content(raw: str) -> NormalizedTestCase:
    if not raw or not raw.strip():
        return NormalizedTestCase(warnings=["Empty input provided"])

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

    # Extract title from first short non-empty line
    first_line = non_empty[0].strip()
    if _is_short_title(first_line) and not _PRECONDITION_HEADERS.match(first_line) and not _STEP_HEADERS.match(first_line):
        title = first_line
        lines = lines[lines.index(non_empty[0]) + 1:]

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

        if _EXPECTED_HEADERS.match(stripped):
            if mode == "steps" and current_step_action:
                mode = "expected"
            else:
                mode = "expected_standalone"
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
