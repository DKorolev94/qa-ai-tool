import pytest
from app.services.testcase_diff import build_testcase_diff


def test_title_change_detected():
    orig = {"title": "Old title", "steps": []}
    impr = {"title": "New title", "steps": []}
    diff = build_testcase_diff(orig, impr)
    assert diff["summary"]["title_changed"] is True
    assert any(c["field"] == "title" for c in diff["changes"])


def test_title_unchanged_not_flagged():
    orig = {"title": "Same title", "steps": []}
    impr = {"title": "Same title", "steps": []}
    diff = build_testcase_diff(orig, impr)
    assert diff["summary"]["title_changed"] is False


def test_step_expected_added():
    orig = {"steps": [{"action": "Click login", "expected": None}]}
    impr = {"steps": [{"action": "Click login", "expected": "User is logged in"}]}
    diff = build_testcase_diff(orig, impr)
    assert diff["summary"]["steps_changed"] is True
    expected_change = next((c for c in diff["changes"] if "expected" in c["field"]), None)
    assert expected_change is not None
    assert expected_change["type"] == "added"
    assert "logged in" in expected_change["after"]


def test_step_test_data_changed():
    orig = {"steps": [{"action": "Login", "expected": "OK", "test_data": None}]}
    impr = {"steps": [{"action": "Login", "expected": "OK", "test_data": "user@example.com"}]}
    diff = build_testcase_diff(orig, impr)
    assert diff["summary"]["steps_changed"] is True
    td_change = next((c for c in diff["changes"] if "test_data" in c["field"]), None)
    assert td_change is not None
    assert td_change["type"] == "added"


def test_tags_changed():
    orig = {"tags": ["smoke"], "steps": []}
    impr = {"tags": ["smoke", "auth"], "steps": []}
    diff = build_testcase_diff(orig, impr)
    assert diff["summary"]["tags_changed"] is True
    tag_change = next((c for c in diff["changes"] if c["field"] == "tags"), None)
    assert tag_change is not None
    assert "auth" in tag_change["after"]


def test_tags_removed():
    orig = {"tags": ["smoke", "regression"], "steps": []}
    impr = {"tags": ["smoke"], "steps": []}
    diff = build_testcase_diff(orig, impr)
    assert diff["summary"]["tags_changed"] is True
    removed = next((c for c in diff["changes"] if c["type"] == "removed" and c["field"] == "tags"), None)
    assert removed is not None
    assert "regression" in removed["before"]


def test_empty_inputs_returns_valid_structure():
    diff = build_testcase_diff({}, {})
    assert "summary" in diff
    assert "changes" in diff
    assert isinstance(diff["changes"], list)
    assert isinstance(diff["summary"], dict)


def test_priority_change_detected():
    orig = {"priority": "medium", "steps": []}
    impr = {"priority": "high", "steps": []}
    diff = build_testcase_diff(orig, impr)
    assert diff["summary"]["priority_changed"] is True


def test_no_changes_returns_empty_changes():
    tc = {
        "title": "Test",
        "description": "Desc",
        "steps": [{"action": "Open", "expected": "Opened"}],
        "preconditions": [],
        "postconditions": [],
        "tags": ["smoke"],
        "priority": "high",
        "status": "ready",
    }
    diff = build_testcase_diff(tc, dict(tc))
    assert diff["changes"] == []
    assert all(not v for v in diff["summary"].values())


def test_preconditions_change_detected():
    orig = {"preconditions": [{"action": "Old precond", "expected": None}], "steps": []}
    impr = {"preconditions": [{"action": "New precond", "expected": None}], "steps": []}
    diff = build_testcase_diff(orig, impr)
    assert diff["summary"]["preconditions_changed"] is True
