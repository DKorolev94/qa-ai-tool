import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.integrations.testit_client import TestItConfigError
from app.services import testit_draft_service
from app.services.testit_draft_service import create_draft_in_testit

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
        "app.services.testit_draft_service.settings",
        SimpleNamespace(
            TESTIT_PROJECT_UUID=project_id,
            TESTIT_DRAFT_SECTION_UUID=section_id,
            TESTIT_BASE_URL="https://testit.example.com",
        ),
    )


def _make_client(create_return=None, sections=None, section_created=None):
    mock_client = AsyncMock()
    mock_client.create_work_item = AsyncMock(return_value=create_return or CREATED)
    mock_client.list_sections = AsyncMock(return_value=sections or [])
    mock_client.create_section = AsyncMock(return_value=section_created or {"id": "new-sect-uuid"})
    mock_client.get_project = AsyncMock(return_value={"globalId": None})
    return mock_client


def setup_function():
    testit_draft_service._resolved_section_id = None
    testit_draft_service._project_global_id = None


def test_returns_work_item_id():
    with _patch_settings(), patch("app.services.testit_draft_service.TestItClient") as MockClient:
        MockClient.return_value = _make_client()
        result = run(create_draft_in_testit(IMPROVED, "6109"))
    assert result.work_item_id == "new-uuid-1234"


def test_returns_global_id():
    with _patch_settings(), patch("app.services.testit_draft_service.TestItClient") as MockClient:
        MockClient.return_value = _make_client()
        result = run(create_draft_in_testit(IMPROVED, "6109"))
    assert result.global_id == 7777


def test_returns_title_without_prefix():
    with _patch_settings(), patch("app.services.testit_draft_service.TestItClient") as MockClient:
        MockClient.return_value = _make_client()
        result = run(create_draft_in_testit(IMPROVED, "6109"))
    assert "[AI DRAFT]" not in result.title
    assert "Login test" in result.title


def test_returns_testit_url():
    with _patch_settings(), patch("app.services.testit_draft_service.TestItClient") as MockClient:
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
         patch("app.services.testit_draft_service.TestItClient") as MockClient:
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
         patch("app.services.testit_draft_service.TestItClient") as MockClient:
        mock_client = _make_client(sections=existing)
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109"))
    mock_client.create_section.assert_not_called()
    args = mock_client.create_work_item.call_args[0][0]
    assert args["sectionId"] == "existing-sect-uuid"


def test_creates_section_when_not_found():
    sections_with_root = [{"id": "root-sect-uuid", "name": "Root", "parentId": None}]
    with _patch_settings(section_id=""), \
         patch("app.services.testit_draft_service.TestItClient") as MockClient:
        mock_client = _make_client(sections=sections_with_root, section_created={"id": "auto-created-sect"})
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109"))
    mock_client.create_section.assert_called_once_with("proj-uuid", "AI Review / Drafts", parent_id="root-sect-uuid")
    args = mock_client.create_work_item.call_args[0][0]
    assert args["sectionId"] == "auto-created-sect"


def test_cache_prevents_second_api_lookup():
    with _patch_settings(section_id=""), \
         patch("app.services.testit_draft_service.TestItClient") as MockClient:
        mock_client = _make_client(sections=[], section_created={"id": "cached-sect"})
        MockClient.return_value = mock_client
        run(create_draft_in_testit(IMPROVED, "6109"))
        run(create_draft_in_testit(IMPROVED, "6109"))
    assert mock_client.list_sections.call_count == 1
    assert mock_client.create_section.call_count == 1
