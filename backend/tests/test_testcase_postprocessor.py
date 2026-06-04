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
    # Original had expected — improved lost it → postprocessor restores it silently
    original = {"steps": [{"action": "Click button", "expected": "Button is clicked"}]}
    improved = _base_improved(steps=[{"action": "Click button", "expected": None}])
    result = postprocess_improved_testcase(original, improved)
    assert result["steps"][0]["expected"] == "Button is clicked"
    assert not any("ожидаемый результат" in w for w in result["validation_warnings"])


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
    assert any("шагов" in w.lower() for w in result["validation_warnings"])


def test_step_without_action_adds_validation_warning():
    improved = _base_improved(steps=[{"action": "", "expected": "Something"}])
    result = postprocess_improved_testcase({}, improved)
    assert any("действие" in w.lower() for w in result["validation_warnings"])
