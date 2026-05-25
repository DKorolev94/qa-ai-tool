from __future__ import annotations

import logging

from app.core.llm_client import improve_testcase_with_llm
from app.parsing.testit_parser import parse_testit_content
from app.parsing.testit_workitem_mapper import normalize_testit_workitem
from app.schemas.improvement import ImprovedTestCase, ImproveTestCaseResponse, ImprovedTestCaseStep
from app.services.testcase_diff import build_testcase_diff
from app.services.testcase_postprocessor import postprocess_improved_testcase

logger = logging.getLogger(__name__)


def _coerce_step(raw: object) -> ImprovedTestCaseStep | None:
    if not isinstance(raw, dict):
        return None
    try:
        return ImprovedTestCaseStep(
            action=str(raw.get("action") or ""),
            expected=str(raw["expected"]) if raw.get("expected") else None,
            test_data=str(raw["test_data"]) if raw.get("test_data") else None,
            comments=str(raw["comments"]) if raw.get("comments") else None,
        )
    except Exception as exc:
        logger.warning("Failed to coerce step: %s — %s", raw, exc)
        return None


def _coerce_testcase(raw: dict, original: dict) -> ImprovedTestCase:
    """Coerce LLM/processed dict into ImprovedTestCase (TestIT fields only)."""
    try:
        steps = [s for r in raw.get("steps") or [] for s in [_coerce_step(r)] if s]
        preconditions = [s for r in raw.get("preconditions") or [] for s in [_coerce_step(r)] if s]
        postconditions = [s for r in raw.get("postconditions") or [] for s in [_coerce_step(r)] if s]

        return ImprovedTestCase(
            title=str(raw.get("title") or original.get("title") or ""),
            description=str(raw.get("description") or original.get("description") or ""),
            preconditions=preconditions,
            steps=steps,
            postconditions=postconditions,
            tags=list(raw.get("tags") or []),
            priority=raw.get("priority") or original.get("priority"),
            status=raw.get("status") or original.get("status"),
            duration=raw.get("duration") if raw.get("duration") is not None else original.get("duration"),
            attributes=raw.get("attributes") or original.get("attributes") or {},
        )
    except Exception as exc:
        logger.warning("Coercion failed, falling back to original: %s", exc)
        orig_steps = [
            ImprovedTestCaseStep(
                action=str(s.get("action") or ""),
                expected=str(s["expected"]) if s.get("expected") else None,
            )
            for s in (original.get("steps") or [])
            if isinstance(s, dict)
        ]
        return ImprovedTestCase(
            title=str(original.get("title") or ""),
            description=str(original.get("description") or ""),
            steps=orig_steps,
            attributes=original.get("attributes") or {},
        )


def improve_raw_testcase(
    raw_content: str | None,
    work_item: dict | None,
    review: dict | None,
) -> ImproveTestCaseResponse:
    if work_item is None and raw_content is None:
        raise ValueError("Provide raw_content or work_item")

    if work_item is not None:
        normalized = normalize_testit_workitem(work_item)
    else:
        normalized = parse_testit_content(raw_content)  # type: ignore[arg-type]

    clean_dict = normalized.model_dump()
    llm_result = improve_testcase_with_llm(clean_dict, review=review)

    # Extract UI-only fields from LLM result before postprocessing
    improvement_notes_raw = [str(n) for n in (llm_result.get("improvement_notes") or [])]
    llm_warnings_raw = [str(w) for w in (llm_result.get("warnings") or [])]

    # Post-process: dedup, stale notes, duration, validation
    processed = postprocess_improved_testcase(clean_dict, llm_result, review=review)

    validation_warnings: list[str] = processed.pop("validation_warnings", [])
    display_duration: str | None = processed.get("display_duration")

    # Improvement notes + warnings live at response level, not inside testcase
    improvement_notes = processed.pop("improvement_notes", improvement_notes_raw)
    processed_warnings = processed.pop("warnings", llm_warnings_raw)

    # Coerce to typed model (TestIT fields only)
    improved_final = _coerce_testcase(processed, clean_dict)

    # Build diff
    diff = build_testcase_diff(clean_dict, improved_final.model_dump())

    # Merge all warnings
    parse_warnings = normalized.warnings or []
    all_warnings = list(dict.fromkeys(parse_warnings + processed_warnings))

    return ImproveTestCaseResponse(
        improved_testcase=improved_final,
        original_normalized_testcase=clean_dict,
        review_used=review,
        diff=diff,
        improvement_notes=improvement_notes,
        warnings=all_warnings,
        validation_warnings=validation_warnings,
        display_duration=display_duration,
    )
