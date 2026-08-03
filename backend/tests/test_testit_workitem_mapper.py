import pytest
from app.tms.testit.workitem_mapper import normalize_testit_workitem, map_step


def _basic_workitem():
    return {
        "name": "Login test",
        "description": "Test login flow",
        "steps": [
            {"action": "Open login page", "expected": "Page loaded"},
            {"action": "Enter credentials", "expected": "Fields filled"},
        ],
        "precondition_steps": [
            {"action": "User is registered", "expected": None},
        ],
        "postcondition_steps": [],
        "attachments": [],
        "tags": ["smoke", "auth"],
        "priority": "high",
        "state": "ready",
    }


def test_basic_mapping():
    result = normalize_testit_workitem(_basic_workitem())
    assert result.title == "Login test"
    assert len(result.steps) == 2
    assert result.steps[0].action == "Open login page"
    assert result.steps[0].expected == "Page loaded"


def test_empty_description_is_not_error():
    wi = _basic_workitem()
    wi["description"] = ""
    result = normalize_testit_workitem(wi)
    assert result.description == ""
    assert not any("description" in w.lower() for w in result.warnings)


def test_step_action_and_expected():
    step = {"action": "Click button", "expected": "Modal opens"}
    result = map_step(step)
    assert result.action == "Click button"
    assert result.expected == "Modal opens"


def test_step_test_data_and_comments():
    step = {
        "action": "Enter value",
        "expected": "Accepted",
        "testData": "user@example.com",
        "comments": "use valid email",
    }
    result = map_step(step)
    assert result.test_data == "user@example.com"
    assert result.comments == "use valid email"


def test_preconditions_separate_from_steps():
    result = normalize_testit_workitem(_basic_workitem())
    assert len(result.preconditions) == 1
    assert result.preconditions[0].action == "User is registered"
    assert len(result.steps) == 2


def test_postconditions_separate_from_steps():
    wi = _basic_workitem()
    wi["postcondition_steps"] = [{"action": "Logout", "expected": "Session ended"}]
    result = normalize_testit_workitem(wi)
    assert len(result.postconditions) == 1
    assert result.postconditions[0].action == "Logout"


def test_tags_list_of_str():
    wi = _basic_workitem()
    wi["tags"] = ["smoke", "regression"]
    result = normalize_testit_workitem(wi)
    assert "smoke" in result.tags
    assert "regression" in result.tags


def test_tags_list_of_dict():
    wi = _basic_workitem()
    wi["tags"] = [{"name": "smoke"}, {"name": "regression"}]
    result = normalize_testit_workitem(wi)
    assert "smoke" in result.tags
    assert "regression" in result.tags


def test_priority_string():
    wi = _basic_workitem()
    wi["priority"] = "high"
    result = normalize_testit_workitem(wi)
    assert result.priority == "high"


def test_priority_dict():
    wi = _basic_workitem()
    wi["priority"] = {"name": "Critical", "id": 1}
    result = normalize_testit_workitem(wi)
    assert result.priority == "Critical"


def test_status_from_state():
    wi = _basic_workitem()
    wi["state"] = "Ready"
    result = normalize_testit_workitem(wi)
    assert result.status == "Ready"


def test_status_dict():
    wi = _basic_workitem()
    wi["state"] = {"name": "In Review"}
    result = normalize_testit_workitem(wi)
    assert result.status == "In Review"


def test_testit_metadata_exposed_for_ui_and_review():
    wi = _basic_workitem()
    wi.update(
        {
            "id": "workitem-uuid",
            "globalId": 6110,
            "versionId": "version-uuid",
            "versionNumber": 3,
            "projectId": "project-uuid",
            "sectionId": "section-uuid",
            "duration": 600000,
            "medianDuration": 120000,
            "links": [{"id": "link-1"}],
            "parameters": [{"name": "email"}],
            "externalIssues": [{"key": "BUG-1"}],
            "attributes": {"custom-attr": ["value-1", "value-2"]},
        }
    )

    result = normalize_testit_workitem(wi)

    assert result.duration == 600000
    assert result.display_duration == "10m"
    assert result.attributes["uuid"] == "workitem-uuid"
    assert result.attributes["globalId"] == 6110
    assert result.attributes["projectId"] == "project-uuid"
    assert result.attributes["sectionId"] == "section-uuid"
    assert result.attributes["display_duration"] == "10m"
    assert result.attributes["display_median_duration"] == "2m"
    assert result.attributes["links_count"] == 1
    assert result.attributes["parameters_count"] == 1
    assert result.attributes["externalIssues_count"] == 1
    assert result.attributes["custom-attr"] == ["value-1", "value-2"]


def test_no_crash_on_empty_workitem():
    result = normalize_testit_workitem({})
    assert result is not None
    assert result.steps == []
    assert any("steps" in w.lower() for w in result.warnings)


def test_no_crash_on_missing_fields():
    result = normalize_testit_workitem({"name": "Minimal test"})
    assert result.title == "Minimal test"
    assert result.steps == []
    assert result.preconditions == []
    assert result.postconditions == []


def test_camel_case_precondition_steps():
    wi = {
        "name": "Test",
        "preconditionSteps": [{"action": "Setup DB", "expected": None}],
        "steps": [{"action": "Run query", "expected": "Result returned"}],
    }
    result = normalize_testit_workitem(wi)
    assert len(result.preconditions) == 1
    assert result.preconditions[0].action == "Setup DB"


def test_attachments_mapped():
    wi = _basic_workitem()
    wi["attachments"] = [
        {"name": "screenshot.png", "url": "https://example.com/screenshot.png", "id": "abc123"}
    ]
    result = normalize_testit_workitem(wi)
    assert len(result.attachments) == 1
    assert result.attachments[0].type == "image"
    assert result.attachments[0].file_id == "abc123"


def test_html_cleaned_from_step_action():
    step = {"action": "<b>Click</b> the button", "expected": "<p>Modal opens</p>"}
    result = map_step(step)
    assert "<b>" not in result.action
    assert "Click" in result.action
    assert "<p>" not in result.expected
    assert "Modal opens" in result.expected


def _nest_shared_step(depth: int) -> dict:
    """Build a chain of shared steps (step.workItem.steps) `depth` levels deep."""
    step = {"action": f"Leaf action at depth {depth}", "expected": "Done"}
    for level in range(depth, 0, -1):
        step = {
            "action": f"Shared step wrapper {level}",
            "workItem": {"steps": [step]},
        }
    return step


def test_moderately_nested_shared_steps_fully_expanded():
    wi = _basic_workitem()
    wi["steps"] = [_nest_shared_step(5)]
    result = normalize_testit_workitem(wi)
    assert len(result.steps) == 1
    assert result.steps[0].action == "Leaf action at depth 5"
    assert not any("deeply nested" in w for w in result.warnings)


def test_deeply_nested_shared_steps_warns_instead_of_silently_dropping():
    wi = _basic_workitem()
    wi["steps"] = [_nest_shared_step(15)]
    result = normalize_testit_workitem(wi)
    assert result.steps == []
    assert any("deeply nested" in w for w in result.warnings)
