from __future__ import annotations
import logging
from app.core.llm_client import improve_testcase_with_llm
from app.parsing.testit_parser import parse_testit_content
from app.parsing.testit_workitem_mapper import normalize_testit_workitem
from app.schemas.analysis import ImproveResult, ImproveTestCaseResponse
from app.services.testcase_analyzer import _coerce_testcase, _complete_resolutions
from app.services.testcase_diff import build_testcase_diff
from app.services.testcase_postprocessor import postprocess_improved_testcase

logger = logging.getLogger(__name__)


def improve_testcase(
    raw_content: str | None,
    work_item: dict | None,
    selected_issues: list[dict],
    source_type: str = "testit",
) -> ImproveTestCaseResponse:
    if raw_content is None and work_item is None:
        raise ValueError("Provide raw_content or work_item")

    if work_item is not None:
        normalized = normalize_testit_workitem(work_item)
    else:
        normalized = parse_testit_content(raw_content)  # type: ignore[arg-type]

    clean_dict = normalized.model_dump()
    llm_result: ImproveResult = improve_testcase_with_llm(
        clean_dict, selected_issues, source_type=source_type
    )

    improved_raw = llm_result.improved_testcase.model_dump()
    processed = postprocess_improved_testcase(clean_dict, improved_raw)
    validation_warnings: list[str] = processed.pop("validation_warnings", [])
    display_duration: str | None = processed.get("display_duration")
    improvement_notes = processed.pop("improvement_notes", None) or llm_result.improvement_notes
    manual_notes = processed.pop("manual_notes", None) or llm_result.manual_notes
    processed.pop("warnings", None)

    improved_final = _coerce_testcase(processed, clean_dict)
    diff = build_testcase_diff(clean_dict, improved_final.model_dump())
    issue_resolutions = _complete_resolutions(llm_result.issue_resolutions, selected_issues)

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
