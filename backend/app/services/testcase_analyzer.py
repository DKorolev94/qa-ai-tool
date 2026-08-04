from __future__ import annotations
import logging
import re
from app.core.llm_client import analyze_testcase_with_llm
from app.core.service_i18n import localize as _localize
from app.tms.testit.parser import parse_testit_content
from app.tms.testit.workitem_mapper import normalize_testit_workitem
from app.schemas.analysis import (
    AnalysisStep,
    AnalyzedTestCase,
    AnalyzeTestCaseResponse,
    IssueResolution,
    ReviewResult,
)

logger = logging.getLogger(__name__)


def _coerce_step(raw: object) -> AnalysisStep | None:
    if not isinstance(raw, dict):
        return None
    try:
        return AnalysisStep(
            action=str(raw.get("action") or ""),
            expected=str(raw["expected"]) if raw.get("expected") else None,
            test_data=str(raw["test_data"]) if raw.get("test_data") else None,
            comments=str(raw["comments"]) if raw.get("comments") else None,
        )
    except Exception as exc:
        logger.warning("Failed to coerce step: %s — %s", raw, exc)
        return None


def _coerce_testcase(raw: dict, original: dict) -> AnalyzedTestCase:
    try:
        return AnalyzedTestCase(
            title=str(raw.get("title") or original.get("title") or ""),
            description=str(raw.get("description") or original.get("description") or ""),
            preconditions=[s for r in raw.get("preconditions") or [] for s in [_coerce_step(r)] if s],
            steps=[s for r in raw.get("steps") or [] for s in [_coerce_step(r)] if s],
            postconditions=[s for r in raw.get("postconditions") or [] for s in [_coerce_step(r)] if s],
            tags=list(raw.get("tags") or []),
            priority=raw.get("priority") or original.get("priority"),
            status=raw.get("status") or original.get("status"),
            duration=raw.get("duration") if raw.get("duration") is not None else original.get("duration"),
            attributes=raw.get("attributes") or original.get("attributes") or {},
        )
    except Exception as exc:
        logger.warning("Coercion failed, falling back: %s", exc)
        return AnalyzedTestCase(
            title=str(original.get("title") or ""),
            description=str(original.get("description") or ""),
            steps=[s for r in (original.get("steps") or []) for s in [_coerce_step(r)] if s],
            attributes=original.get("attributes") or {},
        )


def _complete_resolutions(
    resolutions: list[IssueResolution],
    issues: list[dict],
    language: str = "ru",
) -> list[IssueResolution]:
    valid_resolutions = [r for r in resolutions if 0 <= r.issue_index < len(issues)]
    seen = {r.issue_index for r in valid_resolutions}
    result = list(valid_resolutions)
    for idx in range(len(issues)):
        if idx not in seen:
            result.append(IssueResolution(
                issue_index=idx,
                issue_title=str(issues[idx].get("title", "") if isinstance(issues[idx], dict) else ""),
                status="skipped",
                reason=_localize("not_processed_by_llm", language),
            ))
    result.sort(key=lambda r: r.issue_index)
    return result


_TEST_DATA_MENTION_RE = re.compile(r"test_data|test data|тестов(?:ые|ых) данн", re.IGNORECASE)


def _dedupe_test_data_crossover(issues: list) -> list:
    """The LLM sometimes raises a preconditions/steps issue for the exact same
    missing test_data already covered by a dedicated test_data issue, despite
    the "one cause = one issue" rule — sometimes spelled out as the literal
    `test_data` field name, sometimes paraphrased ("тестовые данные"). Drop the
    crossover duplicate — a legitimate preconditions/steps issue has no reason
    to talk about test data at all."""
    if not any(i.rule == "test_data" for i in issues):
        return issues
    return [
        i for i in issues
        if not (i.rule in ("preconditions", "steps") and _TEST_DATA_MENTION_RE.search(i.description))
    ]


_CLICK_ACTION_RE = re.compile(
    r'^\s*(?:нажать|нажми|нажатие|кликнуть|клик|click|tap|press|открыть|open|'
    r'перейти|go to|navigate|выбрать пункт|select the)\b',
    re.IGNORECASE,
)
_DATA_ENTRY_WORD_RE = re.compile(
    r'ввести|ввод|заполнить|указать|введите|enter|input\b|type\b|fill|upload|attach|'
    r'прикрепить|загрузить',
    re.IGNORECASE,
)


def _is_pure_click_step(action: str) -> bool:
    return bool(_CLICK_ACTION_RE.search(action)) and not _DATA_ENTRY_WORD_RE.search(action)


def _dedupe_false_positive_test_data_on_click_steps(issues: list, testcase: dict) -> list:
    """test_data.md explicitly says click/navigation steps don't need test
    data, but the LLM sometimes flags them anyway. Drop a `test_data` issue
    if its description quotes a step whose action is a pure click/navigation
    with no data-entry wording — the rule the prompt already states, enforced
    deterministically since the model doesn't reliably follow it."""
    click_actions = [
        str(step.get("action"))
        for section in ("preconditions", "steps", "postconditions")
        for step in (testcase.get(section) or [])
        if isinstance(step, dict) and step.get("action") and _is_pure_click_step(str(step["action"]))
    ]
    if not click_actions:
        return issues
    return [
        i for i in issues
        if not (
            i.rule == "test_data"
            and any(action.lower() in i.description.lower() for action in click_actions)
        )
    ]


def analyze_raw_testcase(
    raw_content: str | None,
    work_item: dict | None,
    enabled_rules: list[str] | None = None,
    language: str = "ru",
) -> AnalyzeTestCaseResponse:
    if raw_content is None and work_item is None:
        raise ValueError("Provide raw_content or work_item")

    if work_item is not None:
        normalized = normalize_testit_workitem(work_item)
    else:
        normalized = parse_testit_content(raw_content)  # type: ignore[arg-type]

    clean_dict = normalized.model_dump()
    llm_result: ReviewResult = analyze_testcase_with_llm(
        clean_dict,
        enabled_rules=enabled_rules,
        language=language,
    )

    parse_warnings = normalized.warnings or []
    all_warnings = list(dict.fromkeys(parse_warnings + llm_result.warnings))

    issues = _dedupe_test_data_crossover(llm_result.issues)
    issues = _dedupe_false_positive_test_data_on_click_steps(issues, clean_dict)

    return AnalyzeTestCaseResponse(
        summary=llm_result.summary,
        issues=issues,
        original_normalized_testcase=clean_dict,
        warnings=all_warnings,
    )
