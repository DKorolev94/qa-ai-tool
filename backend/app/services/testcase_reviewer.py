from __future__ import annotations

import logging

from app.core.llm_client import review_testcase_with_llm
from app.parsing.testit_parser import parse_testit_content
from app.schemas.review import ReviewIssue, ReviewResponse, SuggestedTestCase, SuggestedTestCaseStep
from app.schemas.testcase import NormalizedTestCase

logger = logging.getLogger(__name__)


def _coerce_issue(raw: dict) -> ReviewIssue | None:
    try:
        severity = raw.get("severity", "medium")
        if severity not in ("low", "medium", "high"):
            severity = "medium"
        return ReviewIssue(
            severity=severity,
            title=str(raw.get("title", "Unknown issue")),
            description=str(raw.get("description", "")),
            recommendation=str(raw.get("recommendation", "")),
        )
    except Exception as exc:
        logger.warning("Failed to coerce issue: %s — %s", raw, exc)
        return None


def _coerce_suggested(raw: dict) -> SuggestedTestCase | None:
    try:
        tc_type = raw.get("type", "positive")
        if tc_type not in ("positive", "negative", "boundary", "permission", "integration"):
            tc_type = "positive"
        priority = raw.get("priority", "medium")
        if priority not in ("low", "medium", "high"):
            priority = "medium"
        steps = [
            SuggestedTestCaseStep(
                action=str(s.get("action", "")),
                expected=str(s.get("expected", "")),
            )
            for s in raw.get("steps", [])
            if isinstance(s, dict)
        ]
        return SuggestedTestCase(
            title=str(raw.get("title", "Untitled")),
            type=tc_type,
            priority=priority,
            steps=steps,
        )
    except Exception as exc:
        logger.warning("Failed to coerce suggested test case: %s — %s", raw, exc)
        return None


def _build_response(normalized: NormalizedTestCase, llm_result: dict) -> ReviewResponse:
    clean_dict = normalized.model_dump()
    parse_warnings = normalized.warnings or []
    llm_warnings = llm_result.get("warnings") or []
    all_warnings = parse_warnings + [w for w in llm_warnings if w not in parse_warnings]

    issues = [
        issue
        for raw in (llm_result.get("issues") or [])
        if isinstance(raw, dict)
        for issue in [_coerce_issue(raw)]
        if issue is not None
    ]

    suggested = [
        tc
        for raw in (llm_result.get("suggested_test_cases") or [])
        if isinstance(raw, dict)
        for tc in [_coerce_suggested(raw)]
        if tc is not None
    ]

    return ReviewResponse(
        summary=str(llm_result.get("summary", "Review завершён.")),
        issues=issues,
        suggested_test_cases=suggested,
        warnings=all_warnings,
        raw_cleaned_testcase=clean_dict,
    )


def review_normalized_testcase(normalized: NormalizedTestCase) -> ReviewResponse:
    llm_result = review_testcase_with_llm(normalized.model_dump())
    return _build_response(normalized, llm_result)


def review_raw_testcase(raw_content: str) -> ReviewResponse:
    normalized = parse_testit_content(raw_content)
    llm_result = review_testcase_with_llm(normalized.model_dump())
    return _build_response(normalized, llm_result)
