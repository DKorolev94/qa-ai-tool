from app.schemas.analysis import (
    AnalyzeTestCaseRequest,
    ImproveTestCaseRequest,
    ReviewResult,
    ImproveResult,
    AnalysisIssue,
    AnalyzedTestCase,
    IssueResolution,
)


def test_analyze_request_default_source_type():
    req = AnalyzeTestCaseRequest(raw_content="test")
    assert req.source_type == "testit"


def test_analyze_request_manual_source_type():
    req = AnalyzeTestCaseRequest(raw_content="test", source_type="manual")
    assert req.source_type == "manual"


def test_improve_request_default_source_type():
    req = ImproveTestCaseRequest(raw_content="test")
    assert req.source_type == "testit"


def test_review_result_model():
    result = ReviewResult(
        summary="Test summary",
        issues=[AnalysisIssue(severity="high", title="T", description="D", recommendation="R")],
    )
    assert result.summary == "Test summary"
    assert len(result.issues) == 1
    assert result.warnings == []


def test_improve_result_model():
    result = ImproveResult(
        improved_testcase=AnalyzedTestCase(title="T", steps=[]),
        issue_resolutions=[
            IssueResolution(issue_index=0, issue_title="T", status="resolved", action_taken="Done")
        ],
    )
    assert result.improved_testcase.title == "T"
    assert result.warnings == []
