import pytest
from app.services.testcase_postprocessor import postprocess_improved_testcase


def _base_improved(**kwargs):
    base = {
        "title": "Test",
        "description": "",
        "steps": [{"action": "Open page", "expected": "Page loaded"}],
        "preconditions": [],
        "postconditions": [],
        "tags": [],
        "priority": None,
        "status": None,
        "duration": None,
        "attributes": {},
        "improvement_notes": [],
        "warnings": [],
    }
    base.update(kwargs)
    return base


def test_duplicate_warnings_removed():
    improved = _base_improved(warnings=["LLM error", "LLM error", "Other warning"])
    result = postprocess_improved_testcase({}, improved)
    assert result["warnings"].count("LLM error") == 1


def test_duplicate_improvement_notes_removed():
    improved = _base_improved(improvement_notes=["Add test data", "Add test data", "Fix step 1"])
    result = postprocess_improved_testcase({}, improved)
    assert result["improvement_notes"].count("Add test data") == 1


def test_stale_test_data_note_removed_when_test_data_exists():
    improved = _base_improved(
        steps=[{"action": "Login", "expected": "OK", "test_data": "user@example.com"}],
        improvement_notes=["Вынести email в test_data", "Improve step wording"],
    )
    result = postprocess_improved_testcase({}, improved)
    assert not any("test_data" in n.lower() and "вынести" in n.lower() for n in result["improvement_notes"])
    assert "Improve step wording" in result["improvement_notes"]


def test_stale_note_kept_when_no_test_data():
    improved = _base_improved(
        steps=[{"action": "Login", "expected": "OK", "test_data": None}],
        improvement_notes=["Вынести email в test_data"],
    )
    result = postprocess_improved_testcase({}, improved)
    assert "Вынести email в test_data" in result["improvement_notes"]


def test_duration_ms_600000_becomes_10m():
    improved = _base_improved(duration=600000)
    result = postprocess_improved_testcase({}, improved)
    assert result["display_duration"] == "10m"
    assert result["raw_duration"] == 600000


def test_duration_ms_300000_becomes_5m():
    improved = _base_improved(duration=300000)
    result = postprocess_improved_testcase({}, improved)
    assert result["display_duration"] == "5m"


def test_duration_ms_3600000_becomes_1h():
    improved = _base_improved(duration=3600000)
    result = postprocess_improved_testcase({}, improved)
    assert result["display_duration"] == "1h"


def test_duration_string_kept_as_is():
    improved = _base_improved(duration="10m")
    result = postprocess_improved_testcase({}, improved)
    assert result["display_duration"] == "10m"


def test_duration_none_stays_none():
    improved = _base_improved(duration=None)
    result = postprocess_improved_testcase({}, improved)
    assert result["display_duration"] is None
    assert result["raw_duration"] is None


def test_uuid_attributes_preserved():
    uuid_key = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    uuid_val = "b2c3d4e5-f6a7-8901-bcde-f12345678901"
    improved = _base_improved(attributes={uuid_key: uuid_val})
    result = postprocess_improved_testcase({}, improved)
    # UUID attributes must be kept intact for TestIT save-back
    assert result["attributes"][uuid_key] == uuid_val


def test_attributes_from_original_used_as_fallback():
    original = {"attributes": {"stand": "staging"}}
    improved = _base_improved(attributes={})
    result = postprocess_improved_testcase(original, improved)
    assert result["attributes"].get("stand") == "staging"


def test_all_attributes_kept():
    attrs = {"env": "staging", "team": "QA", "a1b2c3d4-e5f6-7890-abcd-ef1234567890": "value"}
    improved = _base_improved(attributes=attrs)
    result = postprocess_improved_testcase({}, improved)
    assert result["attributes"] == attrs


def test_step_without_expected_warns_only_if_original_had_expected():
    # Original had expected — improved lost it → postprocessor restores and adds warning
    original = {"steps": [{"action": "Click button", "expected": "Button is clicked"}]}
    improved = _base_improved(steps=[{"action": "Click button", "expected": None}])
    result = postprocess_improved_testcase(original, improved)
    assert result["steps"][0]["expected"] == "Button is clicked"
    assert any("expected result" in w for w in result["validation_warnings"])


def test_step_without_expected_no_warning_if_original_also_missing():
    # Original had no expected — improved also has none → no warning (LLM correctly didn't invent)
    original = {"steps": [{"action": "Click button", "expected": None}]}
    improved = _base_improved(steps=[{"action": "Click button", "expected": None}])
    result = postprocess_improved_testcase(original, improved)
    assert not any("ожидаемый результат" in w for w in result["validation_warnings"])


def test_no_expected_warning_when_steps_restructured():
    # LLM split 1 step into 2 — expected moved to step 2, step 1 has no expected → no warning
    original = {"steps": [{"action": "Enter + click", "expected": "Redirect to main"}]}
    improved = _base_improved(steps=[
        {"action": "Enter credentials", "expected": None},
        {"action": "Click button", "expected": "Redirect to main"},
    ])
    result = postprocess_improved_testcase(original, improved)
    assert not any("ожидаемый результат" in w for w in result["validation_warnings"])


def test_empty_steps_adds_validation_warning():
    improved = _base_improved(steps=[])
    result = postprocess_improved_testcase({}, improved)
    assert any("no steps" in w.lower() for w in result["validation_warnings"])


def test_step_without_action_adds_validation_warning():
    improved = _base_improved(steps=[{"action": "", "expected": "Something"}])
    result = postprocess_improved_testcase({}, improved)
    assert any("missing action" in w.lower() for w in result["validation_warnings"])


def test_literal_value_stripped_from_action_when_duplicated_in_test_data():
    improved = _base_improved(steps=[
        {"action": "Заполнить поле Фамилия значением Иванов", "expected": "OK", "test_data": "Иванов"}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert result["steps"][0]["action"] == "Заполнить поле Фамилия"
    assert result["steps"][0]["test_data"] == "Иванов"


def test_literal_substring_not_stripped_from_unrelated_word():
    improved = _base_improved(steps=[
        {"action": "Заполнить поле Фамилия значением Иванов", "expected": "OK", "test_data": "Иван"}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert "Иванов" in result["steps"][0]["action"]


def test_example_marker_literal_stripped_from_action():
    improved = _base_improved(steps=[
        {"action": "Ввести email test@mail.com", "expected": "OK", "test_data": "например: test@mail.com"}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert "test@mail.com" not in result["steps"][0]["action"]
    assert result["steps"][0]["test_data"] == "например: test@mail.com"


def test_no_duplication_action_left_untouched():
    improved = _base_improved(steps=[
        {"action": "Заполнить поле Фамилия", "expected": "OK", "test_data": "Иванов"}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert result["steps"][0]["action"] == "Заполнить поле Фамилия"


def test_dangling_empty_quotes_after_llm_removed_value_itself():
    improved = _base_improved(steps=[
        {"action": 'Заполнить поле "Фамилия" значением ""', "expected": "OK", "test_data": "Иванов"}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert result["steps"][0]["action"] == 'Заполнить поле "Фамилия"'


def test_inline_placeholder_stripped_from_action_not_moved_to_test_data():
    improved = _base_improved(steps=[
        {"action": "Enter email [email — test accounts], click Submit", "expected": "OK", "test_data": None}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert result["steps"][0]["test_data"] is None
    assert "[" not in result["steps"][0]["action"]
    assert result["steps"][0]["action"] == "Enter email, click Submit"
    assert result["has_stripped_placeholder"] is True


def test_inline_placeholder_with_backticks_stripped():
    improved = _base_improved(steps=[
        {"action": "Enter email `[email — test accounts]` in the field", "expected": "OK", "test_data": None}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert result["steps"][0]["test_data"] is None
    assert "[" not in result["steps"][0]["action"]


def test_placeholder_in_test_data_stripped_even_when_already_set():
    improved = _base_improved(steps=[
        {"action": "Enter email", "expected": "OK", "test_data": "[email — test accounts]"}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert result["steps"][0]["test_data"] is None
    assert result["has_stripped_placeholder"] is True


def test_real_value_in_test_data_not_stripped():
    improved = _base_improved(steps=[
        {"action": "Enter email", "expected": "OK", "test_data": "existing@value.com"}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert result["steps"][0]["test_data"] == "existing@value.com"
    assert result["has_stripped_placeholder"] is False


def test_empty_code_span_cleaned_up():
    improved = _base_improved(steps=[
        {"action": "Enter email ``, click Submit", "expected": "OK", "test_data": "test@example.com"}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert "`" not in result["steps"][0]["action"]
    assert result["steps"][0]["action"] == "Enter email, click Submit"


def test_invented_email_flagged_and_status_downgraded():
    original = {
        "title": "Login test",
        "steps": [{"action": "Log in", "expected": "OK"}],
        "preconditions": [], "postconditions": [],
    }
    improved = _base_improved(
        status="Ready",
        preconditions=[
            {"action": "Confirmed account with email `test@example.com`", "expected": None, "test_data": None}
        ],
    )
    result = postprocess_improved_testcase(original, improved)
    assert result["has_invented_data"] is True
    assert any("test@example.com" in w for w in result["validation_warnings"])


def test_data_carried_over_from_source_not_flagged_as_invented():
    original = {
        "title": "Login test",
        "steps": [{"action": "Enter password `NewTest12345` in both fields", "expected": "OK"}],
        "preconditions": [], "postconditions": [],
    }
    improved = _base_improved(steps=[
        {"action": "Enter password `NewTest12345` in both fields", "expected": "OK", "test_data": None}
    ])
    result = postprocess_improved_testcase(original, improved)
    assert result["has_invented_data"] is False
    assert result["validation_warnings"] == []


def test_invented_json_token_flagged():
    original = {
        "title": "Get profile",
        "preconditions": [{"action": "User is authenticated (valid token)", "expected": None, "test_data": None}],
        "steps": [], "postconditions": [],
    }
    improved = _base_improved(preconditions=[
        {"action": "User is authenticated", "expected": None,
         "test_data": '{"token": "valid_token_example"}', "comments": None}
    ])
    result = postprocess_improved_testcase(original, improved)
    assert result["has_invented_data"] is True
    assert any("valid_token_example" in w for w in result["validation_warnings"])


def test_json_value_carried_over_from_source_not_flagged():
    original = {
        "title": "Update profile",
        "steps": [{"action": "POST", "expected": "200 OK",
                   "test_data": '{"nickname": "john_doe123"}'}],
        "preconditions": [], "postconditions": [],
    }
    improved = _base_improved(steps=[
        {"action": "POST", "expected": "200 OK",
         "test_data": '{"nickname": "john_doe123"}', "comments": None}
    ])
    result = postprocess_improved_testcase(original, improved)
    assert result["has_invented_data"] is False


def test_invented_synthetic_json_value_flagged_regardless_of_key():
    original = {
        "title": "Add card",
        "steps": [{"action": "POST", "expected": "200 OK",
                   "test_data": '{"card_number": "4111111111111111"}'}],
        "preconditions": [], "postconditions": [],
    }
    improved = _base_improved(steps=[
        {"action": "POST", "expected": "200 OK",
         "test_data": '{"card_number": "dummy_card_example"}', "comments": None}
    ])
    result = postprocess_improved_testcase(original, improved)
    assert result["has_invented_data"] is True
    assert any("dummy_card_example" in w for w in result["validation_warnings"])


def test_testit_param_token_preserved_not_flagged():
    original = {
        "title": "Login",
        "steps": [{"action": "Enter email %email%, click Submit", "expected": "OK"}],
        "preconditions": [], "postconditions": [],
    }
    improved = _base_improved(steps=[
        {"action": "Enter email %email%, click Submit", "expected": "OK", "test_data": None}
    ])
    result = postprocess_improved_testcase(original, improved)
    assert result["has_missing_param_tokens"] is False
    assert result["validation_warnings"] == []


def test_testit_param_token_mangled_by_llm_flagged():
    original = {
        "title": "Login",
        "steps": [{"action": "Enter email %email%, click Submit", "expected": "OK"}],
        "preconditions": [], "postconditions": [],
    }
    improved = _base_improved(steps=[
        {"action": "Enter email test@example.com, click Submit", "expected": "OK", "test_data": None}
    ])
    result = postprocess_improved_testcase(original, improved)
    assert result["has_missing_param_tokens"] is True
    assert any("%email%" in w for w in result["validation_warnings"])


def test_ui_element_placeholder_stripped_from_click_step():
    improved = _base_improved(steps=[
        {"action": "Click the Log in button", "expected": "Login form opens", "test_data": "[button — test accounts]"}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert result["steps"][0]["test_data"] is None


def test_ui_element_placeholder_stripped_russian():
    improved = _base_improved(steps=[
        {"action": "Нажать кнопку Войти", "expected": "OK", "test_data": "[кнопка — тестовые учётки]"}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert result["steps"][0]["test_data"] is None


def test_bare_ui_element_value_stripped_without_brackets():
    improved = _base_improved(steps=[
        {"action": "Нажать кнопку Войти вверху страницы", "expected": "OK", "test_data": "Кнопка Войти"}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert result["steps"][0]["test_data"] is None
    assert result["has_stripped_placeholder"] is True


def test_bare_ui_element_value_stripped_english():
    improved = _base_improved(steps=[
        {"action": "Click the Log in button", "expected": "OK", "test_data": "Log in button"}
    ])
    result = postprocess_improved_testcase({}, improved)
    assert result["steps"][0]["test_data"] is None
