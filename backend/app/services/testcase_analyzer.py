from __future__ import annotations
import logging
from app.core.llm_client import analyze_testcase_with_llm
from app.parsing.testit_parser import parse_testit_content
from app.parsing.testit_workitem_mapper import normalize_testit_workitem
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
) -> list[IssueResolution]:
    seen = {r.issue_index for r in resolutions}
    result = list(resolutions)
    for idx in range(len(issues)):
        if idx not in seen:
            result.append(IssueResolution(
                issue_index=idx,
                issue_title=str(issues[idx].get("title", "") if isinstance(issues[idx], dict) else ""),
                status="skipped",
                reason="Не обработано LLM",
            ))
    result.sort(key=lambda r: r.issue_index)
    return result


def analyze_raw_testcase(
    raw_content: str | None,
    work_item: dict | None,
    source_type: str = "testit",
    enabled_rules: list[str] | None = None,
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
    )

    parse_warnings = normalized.warnings or []
    all_warnings = list(dict.fromkeys(parse_warnings + llm_result.warnings))

    return AnalyzeTestCaseResponse(
        summary=llm_result.summary,
        issues=llm_result.issues,
        original_normalized_testcase=clean_dict,
        warnings=all_warnings,
    )
