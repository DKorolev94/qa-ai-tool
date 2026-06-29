from __future__ import annotations
import logging
from app.core.llm_client import improve_testcase_with_llm
from app.parsing.testit_parser import parse_testit_content
from app.parsing.testit_workitem_mapper import normalize_testit_workitem
from app.schemas.analysis import ImproveResult, ImproveTestCaseResponse, IssueResolution
from app.services.testcase_analyzer import _coerce_testcase, _complete_resolutions
from app.services.testcase_diff import build_testcase_diff
from app.services.testcase_postprocessor import postprocess_improved_testcase

logger = logging.getLogger(__name__)

# Rules that require external context and cannot be auto-resolved:
# maps issue_title → field that must be non-empty to count as resolved
_FIELD_REQUIRED_FOR_RESOLVED: dict[str, str] = {}

_VERIFIABLE_RULE_FIELDS: dict[str, list[str]] = {
    "title": ["title"],
    "description": ["description"],
    "tags": ["tags"],
    "priority": ["priority"],
    "preconditions": ["preconditions"],
    "postconditions": ["postconditions"],
    "steps": ["steps"],
    "expected_results": ["steps"],
    "test_data": ["steps"],
}

_LINKED_DOC_PLACEHOLDERS = (
    "см. связанные документы",
    "смотри связанные документы",
    "см. links",
    "см. ссылки",
    "linked documents",
    "related documents",
)

_CONTEXT_DEPENDENT_RULES = {
    "test_data",
    "reproducibility",
}

_CONTEXT_DEPENDENT_TITLES = {
    "Тестовые данные",
    "Воспроизводимость",
}


def _has_links(testcase: dict) -> bool:
    return bool(testcase.get("links"))


def _iter_step_texts(testcase: dict):
    for section in ("preconditions", "steps", "postconditions"):
        for step in testcase.get(section) or []:
            if not isinstance(step, dict):
                continue
            for field in ("action", "expected", "test_data", "comments"):
                value = step.get(field)
                if value:
                    yield str(value)


def _uses_linked_docs_without_links(improved: dict, original: dict) -> bool:
    if _has_links(original) or _has_links(improved):
        return False
    return any(
        marker in text.lower()
        for text in _iter_step_texts(improved)
        for marker in _LINKED_DOC_PLACEHOLDERS
    )


def _rule_field_changed(rule: str | None, original: dict, improved: dict) -> bool:
    if not rule or rule not in _VERIFIABLE_RULE_FIELDS:
        return True
    return any(original.get(f) != improved.get(f) for f in _VERIFIABLE_RULE_FIELDS[rule])


def _issue_rule(issue: dict | None) -> str | None:
    if not isinstance(issue, dict):
        return None
    value = issue.get("rule")
    return str(value) if value else None


def _validate_resolutions(
    resolutions: list[IssueResolution],
    improved: dict,
    original: dict,
    selected_issues: list[dict],
) -> list[IssueResolution]:
    result = []
    has_bad_linked_docs_placeholder = _uses_linked_docs_without_links(improved, original)
    for r in resolutions:
        if r.status == "resolved":
            required_field = _FIELD_REQUIRED_FOR_RESOLVED.get(r.issue_title)
            if required_field and not improved.get(required_field):
                r = r.model_copy(update={
                    "status": "manual_needed",
                    "reason": f"Поле '{required_field}' осталось пустым — исправление требует ручного добавления",
                })
            else:
                issue = selected_issues[r.issue_index] if 0 <= r.issue_index < len(selected_issues) else None
                issue_rule = _issue_rule(issue)
                is_context_dependent = (
                    issue_rule in _CONTEXT_DEPENDENT_RULES
                    or r.issue_title in _CONTEXT_DEPENDENT_TITLES
                )
                if has_bad_linked_docs_placeholder and is_context_dependent:
                    r = r.model_copy(update={
                        "status": "manual_needed",
                        "reason": "Улучшение ссылается на связанные документы, но links пустой — нужен реальный источник данных",
                    })
                elif not _rule_field_changed(issue_rule, original, improved):
                    r = r.model_copy(update={
                        "status": "skipped",
                        "reason": "Поле не изменилось — улучшение не применено",
                    })
        result.append(r)
    return result


def improve_testcase(
    raw_content: str | None,
    work_item: dict | None,
    selected_issues: list[dict],
) -> ImproveTestCaseResponse:
    if raw_content is None and work_item is None:
        raise ValueError("Provide raw_content or work_item")

    if work_item is not None:
        normalized = normalize_testit_workitem(work_item)
    else:
        normalized = parse_testit_content(raw_content)  # type: ignore[arg-type]

    clean_dict = normalized.model_dump()
    llm_result: ImproveResult = improve_testcase_with_llm(
        clean_dict,
        selected_issues,
    )

    improved_raw = llm_result.improved_testcase.model_dump()
    processed = postprocess_improved_testcase(clean_dict, improved_raw)
    validation_warnings: list[str] = processed.pop("validation_warnings", [])
    improvement_notes = processed.pop("improvement_notes", None) or llm_result.improvement_notes
    manual_notes = processed.pop("manual_notes", None) or llm_result.manual_notes
    processed.pop("warnings", None)

    issue_resolutions = _complete_resolutions(llm_result.issue_resolutions, selected_issues)
    issue_resolutions = _validate_resolutions(issue_resolutions, processed, clean_dict, selected_issues)

    has_manual_needed = (
        any(r.status == "manual_needed" for r in issue_resolutions)
        or bool(manual_notes)
    )
    if has_manual_needed:
        processed["status"] = "NeedsWork"
    else:
        processed["status"] = "Ready"

    improved_final = _coerce_testcase(processed, clean_dict)

    # Compute display_duration after coercion so restored durations are formatted correctly
    dur = improved_final.duration
    if isinstance(dur, int):
        from app.services.testcase_postprocessor import _format_duration_ms
        display_duration: str | None = _format_duration_ms(dur)
    else:
        display_duration = processed.get("display_duration")
    diff = build_testcase_diff(clean_dict, improved_final.model_dump())

    parse_warnings = normalized.warnings or []
    all_warnings = list(dict.fromkeys(parse_warnings + llm_result.warnings))

    return ImproveTestCaseResponse(
        improved_testcase=improved_final,
        original_normalized_testcase=clean_dict,
        issue_resolutions=issue_resolutions,
        improvement_notes=improvement_notes,
        manual_notes=manual_notes,
        warnings=all_warnings,
        validation_warnings=validation_warnings,
        diff=diff,
        display_duration=display_duration,
    )
