import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.services.testit_workitem_service import fetch_and_normalize_work_item

SAMPLE_RAW = {
    "name": "Login test",
    "description": "Test login flow",
    "steps": [{"action": "Open login page", "expected": "Page loaded"}],
    "precondition_steps": [],
    "tags": [{"name": "smoke"}],
    "priority": "medium",
}


def run(coro):
    return asyncio.run(coro)


def test_calls_extract_work_item_id():
    with patch("app.services.testit_workitem_service.extract_work_item_id", return_value="6109") as mock_extract, \
         patch("app.services.testit_workitem_service.TestItClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.get_work_item = AsyncMock(return_value=SAMPLE_RAW)
        MockClient.return_value = mock_client
        run(fetch_and_normalize_work_item("6109"))
    mock_extract.assert_called_once_with("6109")


def test_returns_raw_work_item():
    with patch("app.services.testit_workitem_service.extract_work_item_id", return_value="6109"), \
         patch("app.services.testit_workitem_service.TestItClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.get_work_item = AsyncMock(return_value=SAMPLE_RAW)
        MockClient.return_value = mock_client
        result = run(fetch_and_normalize_work_item("6109"))
    assert result.raw_work_item == SAMPLE_RAW


def test_returns_normalized_testcase():
    with patch("app.services.testit_workitem_service.extract_work_item_id", return_value="6109"), \
         patch("app.services.testit_workitem_service.TestItClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.get_work_item = AsyncMock(return_value=SAMPLE_RAW)
        MockClient.return_value = mock_client
        result = run(fetch_and_normalize_work_item("6109"))
    assert "steps" in result.normalized_testcase
    assert result.normalized_testcase["title"] == "Login test"


def test_returns_work_item_id():
    with patch("app.services.testit_workitem_service.extract_work_item_id", return_value="6109"), \
         patch("app.services.testit_workitem_service.TestItClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.get_work_item = AsyncMock(return_value=SAMPLE_RAW)
        MockClient.return_value = mock_client
        result = run(fetch_and_normalize_work_item("6109"))
    assert result.work_item_id == "6109"


def test_warnings_from_normalizer_included():
    raw_with_garbage = {**SAMPLE_RAW, "steps": []}
    with patch("app.services.testit_workitem_service.extract_work_item_id", return_value="6109"), \
         patch("app.services.testit_workitem_service.TestItClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.get_work_item = AsyncMock(return_value=raw_with_garbage)
        MockClient.return_value = mock_client
        result = run(fetch_and_normalize_work_item("6109"))
    assert isinstance(result.warnings, list)


def test_invalid_input_propagates():
    with pytest.raises(ValueError, match="Could not extract"):
        run(fetch_and_normalize_work_item("not-valid"))
