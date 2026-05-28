from unittest.mock import patch

import pytest

from app.schemas.analysis import (
    AnalyzedTestCase,
    AnalysisStep,
    ImproveResult,
    IssueResolution,
)
from app.services.testcase_improver import improve_testcase

SAMPLE_WORK_ITEM = {
    "name": "Login test",
    "description": "Test that user can login",
    "steps": [
        {"action": "Open login page", "expected": "Page loaded"},
        {"action": "Enter credentials", "expected": "Fields filled"},
    ],
    "precondition_steps": [{"action": "User is registered", "expected": None}],
}

MOCK_LLM_RESULT = ImproveResult(
    improved_testcase=AnalyzedTestCase(
        title="Логин тест — позитивный сценарий",
        description="Проверка успешного входа пользователя",
        steps=[
            AnalysisStep(
                action="Открыть страницу логина",
                expected="Страница загружена",
            )
        ],
        tags=["smoke", "auth"],
        priority="high",
    ),
    issue_resolutions=[
        IssueResolution(
            issue_index=0,
            issue_title="No expected result",
            status="resolved",
            action_taken="Added expected results",
        )
    ],
    improvement_notes=["Добавлены конкретные ожидаемые результаты"],
    manual_notes=[],
    warnings=[],
)

SELECTED_ISSUES = [
    {"severity": "high", "title": "No expected result", "description": "D", "recommendation": "Add ER"}
]


def test_improve_accepts_work_item():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_RESULT):
        result = improve_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, selected_issues=SELECTED_ISSUES)
    assert result.improved_testcase.title == "Логин тест — позитивный сценарий"


def test_improve_returns_original_normalized_testcase():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_RESULT):
        result = improve_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, selected_issues=SELECTED_ISSUES)
    assert isinstance(result.original_normalized_testcase, dict)
    assert "steps" in result.original_normalized_testcase


def test_improve_passes_source_type_to_llm():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_RESULT) as mock_llm:
        improve_testcase(
            work_item=SAMPLE_WORK_ITEM,
            raw_content=None,
            selected_issues=SELECTED_ISSUES,
            source_type="manual",
        )
    call_args = mock_llm.call_args
    assert call_args.kwargs.get("source_type") == "manual" or (len(call_args.args) > 2 and call_args.args[2] == "manual")


def test_improve_empty_request_raises_value_error():
    with pytest.raises(ValueError, match="raw_content or work_item"):
        improve_testcase(work_item=None, raw_content=None, selected_issues=[])


def test_improve_accepts_raw_content():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_RESULT):
        result = improve_testcase(
            raw_content="Login test\n1. Open login page\n2. Enter credentials",
            work_item=None,
            selected_issues=SELECTED_ISSUES,
        )
    assert result is not None
    assert result.original_normalized_testcase is not None


def test_improve_improvement_notes_in_response():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_RESULT):
        result = improve_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, selected_issues=SELECTED_ISSUES)
    assert "Добавлены конкретные ожидаемые результаты" in result.improvement_notes


def test_improved_testcase_has_only_testit_fields():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_RESULT):
        result = improve_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, selected_issues=SELECTED_ISSUES)
    tc_dict = result.improved_testcase.model_dump()
    assert "improvement_notes" not in tc_dict
    assert "warnings" not in tc_dict
    assert "title" in tc_dict
    assert "steps" in tc_dict


def test_improve_fallback_when_llm_unavailable():
    fallback = ImproveResult(
        improved_testcase=AnalyzedTestCase(),
        warnings=["LLM is unavailable, fallback response returned"],
    )
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=fallback):
        result = improve_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, selected_issues=SELECTED_ISSUES)
    assert any("unavailable" in w.lower() for w in result.warnings)
