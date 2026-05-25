from unittest.mock import patch

import pytest

from app.services.testcase_improver import improve_raw_testcase

SAMPLE_WORK_ITEM = {
    "name": "Login test",
    "description": "Test that user can login",
    "steps": [
        {"action": "Open login page", "expected": "Page loaded"},
        {"action": "Enter credentials", "expected": "Fields filled"},
    ],
    "precondition_steps": [{"action": "User is registered", "expected": None}],
}

MOCK_LLM_IMPROVEMENT = {
    "title": "Логин тест — позитивный сценарий",
    "description": "Проверка успешного входа пользователя",
    "preconditions": [{"action": "Пользователь зарегистрирован в системе", "expected": None}],
    "steps": [
        {
            "action": "Открыть страницу логина по URL /login",
            "expected": "Страница логина загружена, отображаются поля Email и Password",
        },
        {
            "action": "Ввести валидный Email и Password",
            "expected": "Поля заполнены корректными данными",
            "test_data": "email: test@example.com, password: ValidPass123",
            "comments": None,
        },
    ],
    "postconditions": [],
    "tags": ["smoke", "auth"],
    "priority": "high",
    "status": None,
    "duration": None,
    "attributes": {},
    "improvement_notes": ["Добавлены конкретные ожидаемые результаты", "Уточнены тестовые данные"],
    "warnings": [],
}


def test_improve_accepts_work_item():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_IMPROVEMENT):
        result = improve_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, review=None)
    assert result.improved_testcase.title == "Логин тест — позитивный сценарий"
    assert len(result.improved_testcase.steps) == 2


def test_improve_returns_original_normalized_testcase():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_IMPROVEMENT):
        result = improve_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, review=None)
    assert isinstance(result.original_normalized_testcase, dict)
    assert "steps" in result.original_normalized_testcase
    assert result.original_normalized_testcase["title"] == "Login test"


def test_improve_review_in_review_used():
    review = {"summary": "Issues found", "issues": [{"severity": "high", "title": "No expected results"}]}
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_IMPROVEMENT):
        result = improve_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, review=review)
    assert result.review_used == review


def test_improve_review_none_when_not_provided():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_IMPROVEMENT):
        result = improve_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, review=None)
    assert result.review_used is None


def test_improve_fallback_when_llm_returns_warning():
    fallback = {
        "title": "Login test",
        "steps": [{"action": "Open login page", "expected": "Page loaded"}],
        "improvement_notes": ["AI improvement was not performed because LLM is unavailable"],
        "warnings": ["LLM is unavailable, fallback improved testcase returned"],
    }
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=fallback):
        result = improve_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, review=None)
    all_warnings = (result.warnings or [])
    assert any("unavailable" in w.lower() for w in all_warnings)


def test_improve_empty_request_raises_value_error():
    with pytest.raises(ValueError, match="raw_content or work_item"):
        improve_raw_testcase(work_item=None, raw_content=None, review=None)


def test_improve_accepts_raw_content():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_IMPROVEMENT):
        result = improve_raw_testcase(
            raw_content="Login test\n1. Open login page\n2. Enter credentials",
            work_item=None,
            review=None,
        )
    assert result is not None
    assert result.original_normalized_testcase is not None


def test_improve_improvement_notes_preserved():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_IMPROVEMENT):
        result = improve_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, review=None)
    # improvement_notes are at response level, not inside improved_testcase
    assert len(result.improvement_notes) == 2
    assert "Добавлены конкретные ожидаемые результаты" in result.improvement_notes


def test_improved_testcase_has_only_testit_fields():
    with patch("app.services.testcase_improver.improve_testcase_with_llm", return_value=MOCK_LLM_IMPROVEMENT):
        result = improve_raw_testcase(work_item=SAMPLE_WORK_ITEM, raw_content=None, review=None)
    tc = result.improved_testcase
    tc_dict = tc.model_dump()
    # Must not contain UI-only fields
    assert "improvement_notes" not in tc_dict
    assert "warnings" not in tc_dict
    assert "display_duration" not in tc_dict
    assert "raw_duration" not in tc_dict
    # Must contain TestIT fields
    assert "title" in tc_dict
    assert "steps" in tc_dict
    assert "attributes" in tc_dict


def test_llm_client_improve_fallback_on_network_error():
    from app.core.llm_client import improve_testcase_with_llm

    with patch("app.core.llm_client.httpx.Client") as mock_client:
        mock_client.return_value.__enter__.return_value.post.side_effect = Exception("Connection refused")
        result = improve_testcase_with_llm({"title": "Test", "steps": []})

    assert "warnings" in result
    assert any("unavailable" in w.lower() for w in result["warnings"])
    assert "improvement_notes" in result
