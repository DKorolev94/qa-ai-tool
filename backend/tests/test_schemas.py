from app.schemas.analysis import (
    AnalyzeTestCaseRequest,
    ImproveTestCaseRequest,
    ReviewResult,
    ImproveResult,
    AnalysisIssue,
    AnalyzedTestCase,
    IssueResolution,
    _LLMIssue,
)


def test_analyze_request_default_source_type():
    req = AnalyzeTestCaseRequest(raw_content="test")
    assert req.source_type == "testit"
    assert req.enabled_rules is None


def test_analyze_request_manual_source_type():
    req = AnalyzeTestCaseRequest(raw_content="test", source_type="manual")
    assert req.source_type == "manual"


def test_improve_request_default_source_type():
    req = ImproveTestCaseRequest(raw_content="test")
    assert req.source_type == "testit"


def test_analyze_request_accepts_enabled_rules():
    req = AnalyzeTestCaseRequest(
        raw_content="test",
        enabled_rules=["title", "reproducibility"],
    )
    assert req.enabled_rules == ["title", "reproducibility"]


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


def test_llm_issue_omits_empty_evidence_from_description():
    issue = _LLMIssue(
        rule="expected_results",
        severity="medium",
        problem="У большинства шагов отсутствуют expected results.",
        evidence="Шаги 1-7: expected = null",
        recommendation="Добавить ожидаемые результаты.",
    ).to_issue()

    assert issue.description == "У большинства шагов отсутствуют expected results."
    assert "Пример:" not in issue.description


def test_llm_issue_omits_empty_text_evidence_from_description():
    issue = _LLMIssue(
        rule="description",
        severity="medium",
        problem="Description отсутствует.",
        evidence="Поле description пустое.",
        recommendation="Добавить описание.",
    ).to_issue()

    assert issue.description == "Description отсутствует."
    assert "Пример:" not in issue.description


def test_llm_issue_omits_mixed_empty_assignment_evidence_from_description():
    issue = _LLMIssue(
        rule="steps",
        severity="medium",
        problem="Шаг 9 имеет пустое поле action.",
        evidence="Шаг 9: action = '', expected = 'Отображается форма ввода кода из SMS'",
        recommendation="Заполнить action.",
    ).to_issue()

    assert issue.description == "Шаг 9 имеет пустое поле action."
    assert "Пример:" not in issue.description


def test_llm_issue_keeps_meaningful_evidence_in_description():
    issue = _LLMIssue(
        rule="test_data",
        severity="medium",
        problem="Тестовые данные вписаны в action.",
        evidence="Шаги 2-6: action содержит 'например: Иванов'",
        recommendation="Перенести примеры в test_data.",
    ).to_issue()

    assert "Пример: Шаги 2-6: action содержит 'например: Иванов'" in issue.description
