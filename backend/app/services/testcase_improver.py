from __future__ import annotations
import logging
from app.core.llm_client import improve_testcase_with_llm
from app.core.service_i18n import localize as _localize
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

# steps/expected_results/test_data all live inside the same step-list fields, so
# comparing whole-list equality would mark any one of them "changed" whenever
# ANY of the others touched the list — e.g. fixing a step's action would also
# validate an untouched test_data resolution as legit. Compare the specific
# sub-field these rules actually care about instead.
_STEP_SECTIONS = ("preconditions", "steps", "postconditions")
_STEP_SUBFIELD_RULES: dict[str, str] = {
    "steps": "action",
    "expected_results": "expected",
    "test_data": "test_data",
}


def _any_step_subfield_changed(field: str, original: dict, improved: dict) -> bool:
    for section in _STEP_SECTIONS:
        orig_list = original.get(section) or []
        impr_list = improved.get(section) or []
        for i in range(max(len(orig_list), len(impr_list))):
            o = orig_list[i] if i < len(orig_list) and isinstance(orig_list[i], dict) else {}
            n = impr_list[i] if i < len(impr_list) and isinstance(impr_list[i], dict) else {}
            if o.get(field) != n.get(field):
                return True
    return False


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
    if not rule:
        return True
    if rule in _STEP_SUBFIELD_RULES:
        return _any_step_subfield_changed(_STEP_SUBFIELD_RULES[rule], original, improved)
    if rule not in _VERIFIABLE_RULE_FIELDS:
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


def _restrict_step_subfields(restored: dict, original: dict, allowed_subfields: set[str]) -> dict:
    """Within preconditions/steps/postconditions, keep only the specific
    subfields a subfield-scoped rule (test_data/expected_results) authorized —
    revert every other subfield (action/comments/the other of the two) back to
    original per step, instead of trusting the whole list wholesale."""
    result = dict(restored)
    for section in _STEP_SECTIONS:
        orig_list = original.get(section) or []
        rest_list = restored.get(section) or []
        if len(orig_list) != len(rest_list):
            # A subfield-scoped rule (test_data/expected_results) has no license to
            # add/remove steps — the LLM ignoring that means index-based pairing
            # below can't be trusted (misattributes data to the wrong step, and a
            # step with no original counterpart gets action=None, which the
            # schema doesn't allow). Discard the whole section rather than risk
            # either — the rule's own subfield fix is lost too, but that's the
            # safe trade-off against silently corrupting a step.
            result[section] = original.get(section)
            continue
        merged = []
        for i in range(len(orig_list)):
            o = orig_list[i] if isinstance(orig_list[i], dict) else {}
            r = rest_list[i] if isinstance(rest_list[i], dict) else dict(o)
            step = dict(r)
            for field in ("action", "expected", "test_data", "comments"):
                if field not in allowed_subfields:
                    step[field] = o.get(field)
            merged.append(step)
        result[section] = merged
    return result


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

    if "steps" in touched:
        rules = {_issue_rule(i) for i in selected_issues}
        subfield_rules = {r for r in rules if r in _STEP_SUBFIELD_RULES}
        # Any OTHER selected rule that also lands on "steps" — the general "steps"
        # rule (may restructure the list), an unrecognized rule (already trust-
        # everything, per _fields_touched_by_rules), or one of atomicity/
        # independence/reproducibility (not in _VERIFIABLE_RULE_FIELDS at all,
        # same trust-everything fallback) — means the LLM may have had a real
        # reason to touch more than test_data/expected_results, so don't narrow.
        other_rules_touching_steps = {
            r for r in rules
            if r not in _STEP_SUBFIELD_RULES
            and (r is None or r not in _VERIFIABLE_RULE_FIELDS or _VERIFIABLE_RULE_FIELDS[r] == ["steps"])
        }
        if subfield_rules and not other_rules_touching_steps:
            allowed_subfields = {_STEP_SUBFIELD_RULES[r] for r in subfield_rules}
            restored = _restrict_step_subfields(restored, original, allowed_subfields)
    return restored


def _validate_resolutions(
    resolutions: list[IssueResolution],
    improved: dict,
    original: dict,
    selected_issues: list[dict],
    language: str = "ru",
) -> list[IssueResolution]:
    result = []
    has_bad_linked_docs_placeholder = _uses_linked_docs_without_links(improved, original)
    for r in resolutions:
        if r.status == "resolved":
            issue = selected_issues[r.issue_index] if 0 <= r.issue_index < len(selected_issues) else None
            issue_rule = _issue_rule(issue)
            is_context_dependent = issue_rule in _CONTEXT_DEPENDENT_RULES
            if has_bad_linked_docs_placeholder and is_context_dependent:
                r = r.model_copy(update={
                    "status": "manual_needed",
                    "reason": _localize("linked_docs_placeholder", language),
                })
            elif not _rule_field_changed(issue_rule, original, improved):
                r = r.model_copy(update={
                    "status": "skipped",
                    "reason": _localize("field_unchanged", language),
                })
        result.append(r)
    return result


def improve_testcase(
    raw_content: str | None,
    work_item: dict | None,
    selected_issues: list[dict],
    language: str = "ru",
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
        language=language,
    )

    improved_raw = llm_result.improved_testcase.model_dump()
    improved_raw = _restore_untouched_fields(improved_raw, clean_dict, selected_issues)
    processed = postprocess_improved_testcase(clean_dict, improved_raw, language)
    validation_warnings: list[str] = processed.pop("validation_warnings", [])
    _proc_notes = processed.pop("improvement_notes", None)
    improvement_notes = _proc_notes if _proc_notes else llm_result.improvement_notes
    _proc_manual = processed.pop("manual_notes", None)
    manual_notes = _proc_manual if _proc_manual else llm_result.manual_notes
    processed.pop("warnings", None)
    has_invented_data = processed.pop("has_invented_data", False)
    if has_invented_data:
        manual_notes = list(manual_notes) + [_localize("invented_test_data", language)]
    has_stripped_placeholder = processed.pop("has_stripped_placeholder", False)
    if has_stripped_placeholder:
        manual_notes = list(manual_notes) + [_localize("stripped_placeholder", language)]
    has_missing_param_tokens = processed.pop("has_missing_param_tokens", False)
    if has_missing_param_tokens:
        manual_notes = list(manual_notes) + [_localize("missing_param_tokens", language)]

    issue_resolutions = _complete_resolutions(llm_result.issue_resolutions, selected_issues, language)
    issue_resolutions = _validate_resolutions(issue_resolutions, processed, clean_dict, selected_issues, language)

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
