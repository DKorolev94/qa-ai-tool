import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.tms.testit.client import TestItResponseError
from app.tms.testit.run_service import write_run_result


def run(coro):
    return asyncio.run(coro)


def _mock_client(work_item=None):
    client = MagicMock()
    client._check_config = MagicMock()
    client._base_url = "https://testit.example.com"
    client._headers = MagicMock(return_value={})
    client._verify_ssl = True
    client._timeout = 30
    client.get_work_item = AsyncMock(return_value=work_item if work_item is not None else {"id": "6109", "projectId": "proj-uuid"})
    return client


def _ok_resp(json_data):
    resp = MagicMock()
    resp.status_code = 200
    resp.is_success = True
    resp.json.return_value = json_data
    return resp


def _mock_http(responses):
    http = AsyncMock()
    http.post = AsyncMock(side_effect=responses)
    http.__aenter__ = AsyncMock(return_value=http)
    http.__aexit__ = AsyncMock(return_value=None)
    return http


def test_write_run_result_uses_project_id_from_work_item():
    mock_client = _mock_client()
    mock_client.search_autotests = AsyncMock(return_value=[{"id": "autotest-1"}])
    mock_client.list_configurations = AsyncMock(return_value=[{"id": "config-1", "isDefault": True}])
    responses = [
        _ok_resp({"id": "run-1"}),  # create test run
        _ok_resp({}),  # add result
    ]
    http = _mock_http(responses)

    with patch("app.tms.testit.run_service.TestItClient", return_value=mock_client), \
         patch("httpx.AsyncClient", return_value=http):
        result = run(write_run_result("6109", "passed", "All good", "run-abc", 12.3))

    assert result == {"run_id_testit": "run-1", "outcome": "Passed"}
    create_run_payload = http.post.call_args_list[0].kwargs["json"]
    assert create_run_payload["projectId"] == "proj-uuid"
    # TestIT auto-completes the run once its single result is posted — an
    # explicit POST .../complete afterward is rejected (400, invalid status
    # transition) since the run is Completed by then, so it must not be called.
    assert not any(c.args[0].endswith("/complete") for c in http.post.call_args_list)


def test_write_run_result_registers_autotest_when_missing():
    mock_client = _mock_client()
    mock_client.search_autotests = AsyncMock(return_value=[])
    mock_client.create_autotest = AsyncMock(return_value={"id": "new-autotest"})
    mock_client.list_configurations = AsyncMock(return_value=[{"id": "config-1", "isDefault": True}])
    responses = [_ok_resp({"id": "run-1"}), _ok_resp({})]
    http = _mock_http(responses)

    with patch("app.tms.testit.run_service.TestItClient", return_value=mock_client), \
         patch("httpx.AsyncClient", return_value=http):
        run(write_run_result("6109", "passed", "All good", "run-abc", 12.3))

    mock_client.create_autotest.assert_awaited_once()
    result_payload = http.post.call_args_list[1].kwargs["json"]
    assert result_payload[0]["autoTestExternalId"] == "qa-ai-tool-workitem-6109"
    assert result_payload[0]["configurationId"] == "config-1"


def test_write_run_result_raises_when_work_item_has_no_project_id():
    mock_client = _mock_client(work_item={"id": "6109"})

    with patch("app.tms.testit.run_service.TestItClient", return_value=mock_client):
        with pytest.raises(TestItResponseError, match="projectId"):
            run(write_run_result("6109", "passed", "All good", "run-abc", 12.3))
