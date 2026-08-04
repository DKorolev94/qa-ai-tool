from app.schemas.analysis import (
    AnalyzeTestCaseRequest,
    ImproveTestCaseRequest,
    ReviewResult,
    ImproveResult,
    AnalysisIssue,
    AnalyzedTestCase,
    IssueResolution,
    _LLMIssue,
    _LLMReviewResult,
)
from app.tms.testit.schemas import CreateDraftRequest, FetchTestItWorkItemRequest, UpdateOriginalRequest


def test_analyze_request_default_enabled_rules():
    req = AnalyzeTestCaseRequest(raw_content="test")
    assert req.enabled_rules is None


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


def test_llm_issue_title_uses_russian_label_by_default():
    issue = _LLMIssue(
        rule="title",
        severity="low",
        problem="Weak title",
        recommendation="Fix it",
    ).to_issue()

    assert issue.title == "Заголовок"


def test_llm_issue_title_uses_english_label_when_language_is_en():
    issue = _LLMIssue(
        rule="title",
        severity="low",
        problem="Weak title",
        recommendation="Fix it",
    ).to_issue(language="en")

    assert issue.title == "Title"


def test_analyze_request_defaults_to_ru():
    req = AnalyzeTestCaseRequest(raw_content="x")
    assert req.language == "ru"


def test_improve_request_accepts_en():
    req = ImproveTestCaseRequest(raw_content="x", language="en")
    assert req.language == "en"


def test_fetch_request_defaults_to_ru():
    req = FetchTestItWorkItemRequest(input="6109")
    assert req.language == "ru"


def test_create_draft_request_defaults_to_ru():
    req = CreateDraftRequest(improved_testcase={}, source_work_item_id="1")
    assert req.language == "ru"


def test_update_original_request_defaults_to_ru():
    req = UpdateOriginalRequest(improved_testcase={}, source_work_item_id="1")
    assert req.language == "ru"


def test_invalid_language_rejected():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        AnalyzeTestCaseRequest(raw_content="x", language="fr")


def test_one_invalid_issue_dropped_not_whole_result():
    # A `rule` value the model invented (not in ReviewRuleId, not in
    # _RULE_ALIASES) used to fail list[_LLMIssue] validation entirely,
    # discarding every issue that DID validate.
    result = _LLMReviewResult(
        reasoning="r",
        summary="s",
        issues=[
            {"rule": "title", "severity": "high", "problem": "p1", "recommendation": "r1"},
            {"rule": "not_a_real_rule", "severity": "high", "problem": "p2", "recommendation": "r2"},
            {"rule": "steps", "severity": "low", "problem": "p3", "recommendation": "r3"},
        ],
    )
    assert len(result.issues) == 2
    assert {i.rule for i in result.issues} == {"title", "steps"}


def test_all_valid_issues_survive_unchanged():
    result = _LLMReviewResult(
        reasoning="r",
        summary="s",
        issues=[{"rule": "title", "severity": "high", "problem": "p1", "recommendation": "r1"}],
    )
    assert len(result.issues) == 1
