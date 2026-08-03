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
        result = analyze_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None)

    assert result.summary == "Found 1 issue"
    assert len(result.issues) == 1
    assert result.issues[0].severity == "high"


def test_analyze_passes_enabled_rules_to_llm():
    with patch("app.services.testcase_analyzer.analyze_testcase_with_llm", return_value=MOCK_REVIEW) as mock_llm:
        analyze_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, enabled_rules=["title"])

    mock_llm.assert_called_once()
    call_args = mock_llm.call_args
    assert call_args.kwargs.get("enabled_rules") == ["title"] or (len(call_args.args) > 1 and call_args.args[1] == ["title"])


def test_analyze_merges_warnings():
    review_with_warnings = ReviewResult(
        summary="OK",
        issues=[],
        warnings=["LLM warning"],
    )
    with patch("app.services.testcase_analyzer.analyze_testcase_with_llm", return_value=review_with_warnings):
        result = analyze_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None)

    assert "LLM warning" in result.warnings


def test_dedupe_drops_preconditions_crossover_when_test_data_issue_present():
    from app.services.testcase_analyzer import _dedupe_test_data_crossover

    issues = [
        AnalysisIssue(rule="preconditions", severity="high", title="Preconditions",
                      description="Missing test_data for the precondition.", recommendation="Add it"),
        AnalysisIssue(rule="test_data", severity="high", title="Test data",
                      description="Missing test_data for email and password.", recommendation="Add it"),
    ]
    result = _dedupe_test_data_crossover(issues)
    assert [i.rule for i in result] == ["test_data"]


def test_dedupe_drops_steps_crossover_with_russian_paraphrase():
    from app.services.testcase_analyzer import _dedupe_test_data_crossover

    issues = [
        AnalysisIssue(rule="steps", severity="high", title="Steps",
                      description="Отсутствуют конкретные тестовые данные для шага.", recommendation="Add it"),
        AnalysisIssue(rule="test_data", severity="high", title="Test data",
                      description="Missing test data.", recommendation="Add it"),
    ]
    result = _dedupe_test_data_crossover(issues)
    assert [i.rule for i in result] == ["test_data"]


def test_dedupe_keeps_unrelated_preconditions_issue():
    from app.services.testcase_analyzer import _dedupe_test_data_crossover

    issues = [
        AnalysisIssue(rule="preconditions", severity="medium", title="Preconditions",
                      description="Precondition describes an unreachable state, not an action.", recommendation="Fix it"),
        AnalysisIssue(rule="test_data", severity="high", title="Test data",
                      description="Missing test data.", recommendation="Add it"),
    ]
    result = _dedupe_test_data_crossover(issues)
    assert [i.rule for i in result] == ["preconditions", "test_data"]


def test_dedupe_noop_when_no_test_data_issue():
    from app.services.testcase_analyzer import _dedupe_test_data_crossover

    issues = [
        AnalysisIssue(rule="preconditions", severity="high", title="Preconditions",
                      description="Missing test_data for the precondition.", recommendation="Add it"),
    ]
    result = _dedupe_test_data_crossover(issues)
    assert result == issues


def test_analyze_applies_test_data_crossover_dedupe():
    review_with_crossover = ReviewResult(
        summary="OK",
        issues=[
            AnalysisIssue(rule="preconditions", severity="high", title="Preconditions",
                          description="Missing test_data for the precondition.", recommendation="Add it"),
            AnalysisIssue(rule="test_data", severity="high", title="Test data",
                          description="Missing test_data.", recommendation="Add it"),
        ],
        warnings=[],
    )
    with patch("app.services.testcase_analyzer.analyze_testcase_with_llm", return_value=review_with_crossover):
        result = analyze_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None)

    assert [i.rule for i in result.issues] == ["test_data"]


def test_dedupe_drops_test_data_issue_for_pure_click_step():
    from app.services.testcase_analyzer import _dedupe_false_positive_test_data_on_click_steps

    issues = [
        AnalysisIssue(rule="test_data", severity="high", title="Test data",
                      description="Missing test data for step 'Нажать кнопку Войти вверху страницы'.",
                      recommendation="Add it"),
    ]
    testcase = {
        "steps": [{"action": "Нажать кнопку Войти вверху страницы", "expected": "OK"}],
        "preconditions": [], "postconditions": [],
    }
    result = _dedupe_false_positive_test_data_on_click_steps(issues, testcase)
    assert result == []


def test_dedupe_keeps_test_data_issue_for_data_entry_step():
    from app.services.testcase_analyzer import _dedupe_false_positive_test_data_on_click_steps

    issues = [
        AnalysisIssue(rule="test_data", severity="high", title="Test data",
                      description="Missing test data for step 'Enter email'.",
                      recommendation="Add it"),
    ]
    testcase = {
        "steps": [{"action": "Enter email", "expected": "OK"}],
        "preconditions": [], "postconditions": [],
    }
    result = _dedupe_false_positive_test_data_on_click_steps(issues, testcase)
    assert len(result) == 1


def test_analyze_applies_click_step_false_positive_dedupe():
    review_with_false_positive = ReviewResult(
        summary="OK",
        issues=[
            AnalysisIssue(rule="test_data", severity="high", title="Test data",
                          description="Missing test data for step 'Open login page'.",
                          recommendation="Add it"),
        ],
        warnings=[],
    )
    work_item = {
        "name": "Login test",
        "steps": [{"action": "Open login page", "expected": "Page loaded"}],
    }
    with patch("app.services.testcase_analyzer.analyze_testcase_with_llm", return_value=review_with_false_positive):
        result = analyze_raw_testcase(work_item=work_item, raw_content=None)

    assert result.issues == []


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
