import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.tms.testit.client import TestItApiError, TestItConfigError
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


def _patch_settings():
    return patch(
        "app.tms.testit.draft_service.settings",
        SimpleNamespace(TESTIT_BASE_URL="https://testit.example.com"),
    )


def _make_client(create_return=None, sections=None, section_created=None, attributes=None, section=None,
                  work_item=None, project_id="proj-uuid"):
    mock_client = AsyncMock()
    mock_client.get_work_item = AsyncMock(return_value=work_item if work_item is not None else {"id": "6109", "projectId": project_id})
    mock_client.create_work_item = AsyncMock(return_value=create_return or CREATED)
    mock_client.list_sections = AsyncMock(return_value=sections or [])
    mock_client.create_section = AsyncMock(return_value=section_created or {"id": "new-sect-uuid"})
    mock_client.get_project = AsyncMock(return_value={"globalId": None})
    mock_client.get_section = AsyncMock(return_value=section or {"name": "AI Review / Drafts"})
    mock_client.list_attributes = AsyncMock(return_value=attributes if attributes is not None else [])
    mock_client.create_work_item_comment = AsyncMock(return_value={})
    return mock_client


def setup_function():
    testit_draft_service._resolved_section_ids.clear()
    testit_draft_service._project_global_ids.clear()
    testit_draft_service._enabled_attribute_ids_by_project.clear()


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
    with _patch_settings(), patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        MockClient.return_value = _make_client(work_item={"id": "6109"})  # no projectId
        with pytest.raises(TestItConfigError, match="projectId"):
            run(create_draft_in_testit(IMPROVED, "6109"))


def test_finds_existing_section_no_duplicate():
    existing = [
        {"id": "existing-sect-uuid", "name": "AI Review / Drafts"},
        {"id": "other-uuid", "name": "Other section"},
    ]
    with _patch_settings(), \
         patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client(sections=existing)
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109"))
    mock_client.create_section.assert_not_called()
    args = mock_client.create_work_item.call_args[0][0]
    assert args["sectionId"] == "existing-sect-uuid"


def test_creates_section_when_not_found():
    sections_with_root = [{"id": "root-sect-uuid", "name": "Root", "parentId": None}]
    with _patch_settings(), \
         patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client(sections=sections_with_root, section_created={"id": "auto-created-sect"})
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109"))
    mock_client.create_section.assert_called_once_with("proj-uuid", "AI Review / Drafts", parent_id="root-sect-uuid")
    args = mock_client.create_work_item.call_args[0][0]
    assert args["sectionId"] == "auto-created-sect"


def test_cache_prevents_second_api_lookup():
    with _patch_settings(), \
         patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client(sections=[], section_created={"id": "cached-sect"})
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109"))
        run(create_draft_in_testit(IMPROVED, "6109"))
    assert mock_client.list_sections.call_count == 1
    assert mock_client.create_section.call_count == 1


def test_cache_is_per_project():
    # Two drafts from different source projects must resolve/create their own
    # section rather than reusing whichever project happened to resolve first.
    with _patch_settings(), \
         patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client(sections=[], section_created={"id": "sect-a"}, project_id="proj-a")
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109"))

        mock_client_b = _make_client(sections=[], section_created={"id": "sect-b"}, project_id="proj-b")
        MockClient.return_value = mock_client_b
        run(create_draft_in_testit(IMPROVED, "6110"))

    assert mock_client.create_section.call_count == 1
    assert mock_client_b.create_section.call_count == 1


def test_section_id_cache_invalidated_after_create_work_item_failure():
    # A cached section_id pointing at a section since renamed/deleted in TestIT
    # would otherwise fail create_work_item forever until the process restarts —
    # the cache should drop on failure so the next call re-resolves it. Simulated
    # with TestItApiError specifically — that's the real error TestIT rejecting
    # a stale section_id actually raises, not a generic RuntimeError (a plain
    # RuntimeError from create_work_item now correctly leaves the cache alone,
    # since it isn't evidence the section itself is invalid).
    sections_with_root = [{"id": "root-sect-uuid", "name": "Root", "parentId": None}]
    with _patch_settings(), \
         patch("app.tms.testit.draft_service.TestItClient") as MockClient:
        mock_client = _make_client(sections=sections_with_root, section_created={"id": "auto-created-sect"})
        mock_client.create_work_item = AsyncMock(side_effect=[TestItApiError("section not found", status_code=404), CREATED])
        MockClient.return_value = mock_client

        with pytest.raises(TestItApiError):
            run(create_draft_in_testit(IMPROVED, "6109"))
        result = run(create_draft_in_testit(IMPROVED, "6109"))

    assert result.work_item_id == "new-uuid-1234"
    assert mock_client.list_sections.call_count == 2
    assert mock_client.create_section.call_count == 2


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
