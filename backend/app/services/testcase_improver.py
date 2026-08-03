from __future__ import annotations
import logging
from app.core.llm_client import improve_testcase_with_llm
from app.tms.testit.parser import parse_testit_content
from app.tms.testit.workitem_mapper import normalize_testit_workitem
from app.schemas.analysis import ImproveResult, ImproveTestCaseResponse, IssueResolution
from app.services.testcase_analyzer import _coerce_testcase, _complete_resolutions
from app.services.testcase_diff import build_testcase_diff
from app.core.time_utils import format_duration_ms as _format_duration_ms
from app.services.testcase_postprocessor import postprocess_improved_testcase

logger = logging.getLogger(__name__)

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

_ALL_TRACKED_FIELDS = {
    "title", "description", "tags", "priority", "preconditions", "postconditions", "steps",
}

_LINKED_DOC_PLACEHOLDERS = (
    "см. связанные документы",
    "смотри связанные документы",
    "см. links",
    "см. ссылки",
    "linked documents",
    "related documents",
    "see related documents",
    "see links",
)

_CONTEXT_DEPENDENT_RULES = {
    "test_data",
    "reproducibility",
}

_CONTEXT_DEPENDENT_TITLES = {
    "Test data",
    "Reproducibility",
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


def _fields_touched_by_rules(selected_issues: list[dict]) -> set[str]:
    """Fields the LLM is allowed to change, derived from selected issues' rules.

    An issue without a recognizable rule can't be mapped to a field, so it
    falls back to trusting the LLM on every field rather than risk reverting
    a fix it doesn't have rule metadata for.
    """
    fields: set[str] = set()
    for issue in selected_issues:
        rule = _issue_rule(issue)
        if rule is None:
            return set(_ALL_TRACKED_FIELDS)
        fields.update(_VERIFIABLE_RULE_FIELDS.get(rule, _ALL_TRACKED_FIELDS))
    return fields


def _restore_untouched_fields(improved: dict, original: dict, selected_issues: list[dict]) -> dict:
    """Revert fields the LLM had no selected issue for back to the original text.

    The LLM regenerates the whole test case on every call, which lets it
    quietly reword or corrupt fields nobody asked it to touch (e.g. dropping
    a character in a precondition while "fixing" an unrelated steps issue).
    """
    touched = _fields_touched_by_rules(selected_issues)
    restored = dict(improved)
    for field in _ALL_TRACKED_FIELDS - touched:
        restored[field] = original.get(field)
    return restored


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
            issue = selected_issues[r.issue_index] if 0 <= r.issue_index < len(selected_issues) else None
            issue_rule = _issue_rule(issue)
            is_context_dependent = (
                issue_rule in _CONTEXT_DEPENDENT_RULES
                or r.issue_title in _CONTEXT_DEPENDENT_TITLES
            )
            if has_bad_linked_docs_placeholder and is_context_dependent:
                r = r.model_copy(update={
                    "status": "manual_needed",
                    "reason": "Improvement references linked documents, but links is empty — a real data source is needed",
                })
            elif not _rule_field_changed(issue_rule, original, improved):
                r = r.model_copy(update={
                    "status": "skipped",
                    "reason": "Field unchanged — improvement not applied",
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
    improved_raw = _restore_untouched_fields(improved_raw, clean_dict, selected_issues)
    processed = postprocess_improved_testcase(clean_dict, improved_raw)
    validation_warnings: list[str] = processed.pop("validation_warnings", [])
    _proc_notes = processed.pop("improvement_notes", None)
    improvement_notes = _proc_notes if _proc_notes else llm_result.improvement_notes
    _proc_manual = processed.pop("manual_notes", None)
    manual_notes = _proc_manual if _proc_manual else llm_result.manual_notes
    processed.pop("warnings", None)
    has_invented_data = processed.pop("has_invented_data", False)
    if has_invented_data:
        manual_notes = list(manual_notes) + [
            "The LLM wrote test data (email/password/token) not present in the source test case — "
            "verify or replace it with a real value before using this test case."
        ]
    has_stripped_placeholder = processed.pop("has_stripped_placeholder", False)
    if has_stripped_placeholder:
        manual_notes = list(manual_notes) + [
            "Test data is missing for at least one step and no real value could be determined — "
            "state it manually rather than leaving a stand-in value."
        ]
    has_missing_param_tokens = processed.pop("has_missing_param_tokens", False)
    if has_missing_param_tokens:
        manual_notes = list(manual_notes) + [
            "A TestIT parameter reference (%param%) from the source test case appears to be "
            "missing or altered — check the diff and restore it if needed."
        ]

    issue_resolutions = _complete_resolutions(llm_result.issue_resolutions, selected_issues)
    issue_resolutions = _validate_resolutions(issue_resolutions, processed, clean_dict, selected_issues)

    has_manual_needed = (
        any(r.status == "manual_needed" for r in issue_resolutions)
        or bool(manual_notes)
        or has_invented_data
        or has_stripped_placeholder
        or has_missing_param_tokens
    )
    if has_manual_needed:
        processed["status"] = "NeedsWork"
    else:
        processed["status"] = "Ready"

    improved_final = _coerce_testcase(processed, clean_dict)

    # Compute display_duration after coercion so restored durations are formatted correctly
    dur = improved_final.duration
    if isinstance(dur, int):
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
