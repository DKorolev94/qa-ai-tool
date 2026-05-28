from unittest.mock import patch

from app.schemas.analysis import AnalysisIssue, ReviewResult
from app.services.testcase_analyzer import analyze_raw_testcase

SAMPLE_WORK_ITEM = {
    "name": "Login test",
    "steps": [{"action": "Open login page", "expected": "Page loaded"}],
}

MOCK_REVIEW = ReviewResult(
    summary="Found 1 issue",
    issues=[AnalysisIssue(severity="high", title="No expected result", description="D", recommendation="Add ER")],
    warnings=[],
)


def test_analyze_returns_response_with_issues():
    with patch("app.services.testcase_analyzer.analyze_testcase_with_llm", return_value=MOCK_REVIEW):
        result = analyze_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, source_type="testit")

    assert result.summary == "Found 1 issue"
    assert len(result.issues) == 1
    assert result.issues[0].severity == "high"


def test_analyze_passes_source_type_to_llm():
    with patch("app.services.testcase_analyzer.analyze_testcase_with_llm", return_value=MOCK_REVIEW) as mock_llm:
        analyze_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, source_type="manual")

    mock_llm.assert_called_once()
    call_args = mock_llm.call_args
    # source_type passed as keyword arg
    assert call_args.kwargs.get("source_type") == "manual" or (len(call_args.args) > 1 and call_args.args[1] == "manual")


def test_analyze_merges_warnings():
    review_with_warnings = ReviewResult(
        summary="OK",
        issues=[],
        warnings=["LLM warning"],
    )
    with patch("app.services.testcase_analyzer.analyze_testcase_with_llm", return_value=review_with_warnings):
        result = analyze_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, source_type="testit")

    assert "LLM warning" in result.warnings


def test_complete_resolutions_fills_missing():
    from app.schemas.analysis import IssueResolution
    from app.services.testcase_analyzer import _complete_resolutions

    existing = [IssueResolution(issue_index=0, issue_title="T0", status="resolved", action_taken="Done")]
    issues = [
        {"title": "T0"},
        {"title": "T1"},
        {"title": "T2"},
    ]
    result = _complete_resolutions(existing, issues)
    assert len(result) == 3
    statuses = {r.issue_index: r.status for r in result}
    assert statuses[0] == "resolved"
    assert statuses[1] == "skipped"
    assert statuses[2] == "skipped"
