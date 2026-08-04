import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.tms.testit.client import TestItConfigError
from app.tms.testit import draft_service as testit_draft_service
from app.tms.testit.draft_service import create_draft_in_testit

IMPROVED = {
    "title": "Login test",
    "description": "Test login",
    "steps": [{"action": "Open page", "expected": "Page loaded"}],
    "preconditions": [],
    "postconditions": [],
    "tags": ["smoke"],
    "priority": "medium",
    "duration": 60000,
    "attributes": {},
}

CREATED = {
    "id": "new-uuid-1234",
    "globalId": 7777,
    "name": "Login test",
}


def run(coro):
    return asyncio.run(coro)


def _patch_settings(project_id="proj-uuid", section_id="sect-uuid"):
    return patch(
        "app.tms.testit.draft_service.settings",
        SimpleNamespace(
            TESTIT_PROJECT_UUID=project_id,
            TESTIT_DRAFT_SECTION_UUID=section_id,
            TESTIT_BASE_URL="https://testit.example.com",
        ),
    )


def _make_client(create_return=None, sections=None, section_created=None, attributes=None, section=None):
    mock_client = AsyncMock()
    mock_client.create_work_item = AsyncMock(return_value=create_return or CREATED)
    mock_client.list_sections = AsyncMock(return_value=sections or [])
    mock_client.create_section = AsyncMock(return_value=section_created or {"id": "new-sect-uuid"})
    mock_client.get_project = AsyncMock(return_value={"globalId": None})
    mock_client.get_section = AsyncMock(return_value=section or {"name": "AI Review / Drafts"})
    mock_client.list_attributes = AsyncMock(return_value=attributes if attributes is not None else [])
    mock_client.create_work_item_comment = AsyncMock(return_value={})
    return mock_client


def setup_function():
    testit_draft_service._resolved_section_id = None
    testit_draft_service._resolved_section_name = None
    testit_draft_service._project_global_id = None
    testit_draft_service._enabled_attribute_ids = None


def test_returns_work_item_id():
    with _patch_settings(), patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        MockClient.return_value = _make_client()
        result = run(create_draft_in_testit(IMPROVED, "6109"))
    assert result.work_item_id == "new-uuid-1234"


def test_returns_global_id():
    with _patch_settings(), patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        MockClient.return_value = _make_client()
        result = run(create_draft_in_testit(IMPROVED, "6109"))
    assert result.global_id == 7777


def test_returns_title_without_prefix():
    with _patch_settings(), patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        MockClient.return_value = _make_client()
        result = run(create_draft_in_testit(IMPROVED, "6109"))
    assert "[AI DRAFT]" not in result.title
    assert "Login test" in result.title


def test_returns_testit_url():
    with _patch_settings(), patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        MockClient.return_value = _make_client()
        result = run(create_draft_in_testit(IMPROVED, "6109"))
    assert result.testit_url is not None
    assert "new-uuid-1234" in result.testit_url


def test_missing_project_id_raises():
    with _patch_settings(project_id=""):
        with pytest.raises(TestItConfigError, match="TESTIT_PROJECT_UUID"):
            run(create_draft_in_testit(IMPROVED, "6109"))


def test_uses_configured_section_id_without_api_call():
    with _patch_settings(section_id="configured-sect"), \
         patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client()
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109"))
    mock_client.list_sections.assert_not_called()
    mock_client.create_section.assert_not_called()


def test_finds_existing_section_no_duplicate():
    existing = [
        {"id": "existing-sect-uuid", "name": "AI Review / Drafts"},
        {"id": "other-uuid", "name": "Other section"},
    ]
    with _patch_settings(section_id=""), \
         patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client(sections=existing)
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109"))
    mock_client.create_section.assert_not_called()
    args = mock_client.create_work_item.call_args[0][0]
    assert args["sectionId"] == "existing-sect-uuid"


def test_creates_section_when_not_found():
    sections_with_root = [{"id": "root-sect-uuid", "name": "Root", "parentId": None}]
    with _patch_settings(section_id=""), \
         patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client(sections=sections_with_root, section_created={"id": "auto-created-sect"})
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109"))
    mock_client.create_section.assert_called_once_with("proj-uuid", "AI Review / Drafts", parent_id="root-sect-uuid")
    args = mock_client.create_work_item.call_args[0][0]
    assert args["sectionId"] == "auto-created-sect"


def test_cache_prevents_second_api_lookup():
    with _patch_settings(section_id=""), \
         patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client(sections=[], section_created={"id": "cached-sect"})
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109"))
        run(create_draft_in_testit(IMPROVED, "6109"))
    assert mock_client.list_sections.call_count == 1
    assert mock_client.create_section.call_count == 1


def test_disabled_attributes_stripped_from_draft_payload():
    attrs = [
        {"id": "enabled-attr", "isEnabled": True},
        {"id": "disabled-attr", "isEnabled": False},
    ]
    source_attributes = {"enabled-attr": "val-1", "disabled-attr": "val-2"}
    with _patch_settings(), patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client(attributes=attrs)
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109", source_attributes=source_attributes))
    payload = mock_client.create_work_item.call_args[0][0]
    assert payload["attributes"] == {"enabled-attr": "val-1"}


def test_attributes_kept_unfiltered_when_attribute_fetch_fails():
    source_attributes = {"some-attr": "val-1"}
    with _patch_settings(), patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client()
        mock_client.list_attributes = AsyncMock(side_effect=RuntimeError("boom"))
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109", source_attributes=source_attributes))
    payload = mock_client.create_work_item.call_args[0][0]
    assert payload["attributes"] == {"some-attr": "val-1"}


def test_no_comment_posted_when_ready():
    with _patch_settings(), patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client()
        MockClient.return_value = mock_client
        run(create_draft_in_testit({**IMPROVED, "status": "Ready"}, "6109"))
    mock_client.create_work_item_comment.assert_not_called()


def test_one_failed_comment_does_not_block_the_others():
    with _patch_settings(), patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client()
        mock_client.create_work_item_comment = AsyncMock(
            side_effect=[RuntimeError("boom"), {}]  # provenance fails, the note still posts
        )
        MockClient.return_value = mock_client
        run(create_draft_in_testit(
            {**IMPROVED, "status": "NeedsWork"}, "6109",
            manual_notes=["Clarify step 2"],
        ))
    assert mock_client.create_work_item_comment.await_count == 2


def test_provenance_comment_posted_when_needs_review():
    with _patch_settings(), patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client()
        MockClient.return_value = mock_client
        run(create_draft_in_testit({**IMPROVED, "status": "NeedsWork"}, "6109"))
    texts = [call.args[1] for call in mock_client.create_work_item_comment.call_args_list]
    assert any("6109" in t for t in texts)


def test_manual_notes_posted_as_separate_comments():
    with _patch_settings(), patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client()
        MockClient.return_value = mock_client
        run(create_draft_in_testit(
            {**IMPROVED, "status": "NeedsWork"}, "6109",
            manual_notes=["Clarify step 2", "Missing test data"],
        ))
    texts = [call.args[1] for call in mock_client.create_work_item_comment.call_args_list]
    assert "Clarify step 2" in texts
    assert "Missing test data" in texts


def test_comment_failure_does_not_break_draft_creation():
    with _patch_settings(), patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client()
        mock_client.create_work_item_comment = AsyncMock(side_effect=RuntimeError("boom"))
        MockClient.return_value = mock_client
        result = run(create_draft_in_testit({**IMPROVED, "status": "NeedsWork"}, "6109"))
    assert result.work_item_id == "new-uuid-1234"
