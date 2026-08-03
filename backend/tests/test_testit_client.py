import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.tms.testit.client import (
    TestItApiError,
    TestItAuthError,
    TestItClient,
    TestItConfigError,
    TestItConnectionError,
    TestItNotFoundError,
    TestItResponseError,
)


def _cfg(base_url="https://testit.example.com", token="secret", scheme="PrivateToken"):
    return SimpleNamespace(
        TESTIT_BASE_URL=base_url,
        TESTIT_PRIVATE_TOKEN=token,
        TESTIT_AUTH_SCHEME=scheme,
        TESTIT_TIMEOUT_SECONDS=30,
        TESTIT_VERIFY_SSL=True,
    )


def _mock_resp(status_code: int, json_data=None, raises_json=False):
    resp = MagicMock()
    resp.status_code = status_code
    resp.is_success = 200 <= status_code < 300
    if raises_json:
        resp.json.side_effect = ValueError("not JSON")
    else:
        resp.json.return_value = json_data or {}
    return resp


def _make_async_client(resp):
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


def run(coro):
    return asyncio.run(coro)


# ── Config errors ─────────────────────────────────────────────────────────────

def test_raises_config_error_no_base_url():
    client = TestItClient(_cfg(base_url=""))
    with pytest.raises(TestItConfigError, match="TESTIT_BASE_URL"):
        run(client.get_work_item("6109"))


def test_raises_config_error_no_token():
    client = TestItClient(_cfg(token=""))
    with pytest.raises(TestItConfigError, match="TESTIT_PRIVATE_TOKEN"):
        run(client.get_work_item("6109"))


# ── Correct URL and headers ───────────────────────────────────────────────────

def test_builds_correct_url():
    client = TestItClient(_cfg())
    resp = _mock_resp(200, {"id": "6109"})
    mock_client = _make_async_client(resp)
    with patch("httpx.AsyncClient", return_value=mock_client):
        run(client.get_work_item("6109"))
    mock_client.get.assert_awaited_once()
    call_url = mock_client.get.call_args[0][0]
    assert call_url == "https://testit.example.com/api/v2/workItems/6109"


def test_sends_private_token_header():
    client = TestItClient(_cfg(token="mytoken", scheme="PrivateToken"))
    resp = _mock_resp(200, {"id": "6109"})
    mock_client = _make_async_client(resp)
    with patch("httpx.AsyncClient", return_value=mock_client):
        run(client.get_work_item("6109"))
    headers = mock_client.get.call_args[1]["headers"]
    assert headers["Authorization"] == "PrivateToken mytoken"


def test_sends_bearer_header():
    client = TestItClient(_cfg(token="jwt123", scheme="Bearer"))
    resp = _mock_resp(200, {"id": "6109"})
    mock_client = _make_async_client(resp)
    with patch("httpx.AsyncClient", return_value=mock_client):
        run(client.get_work_item("6109"))
    headers = mock_client.get.call_args[1]["headers"]
    assert headers["Authorization"] == "Bearer jwt123"


# ── HTTP error handling ───────────────────────────────────────────────────────

def test_401_raises_auth_error():
    client = TestItClient(_cfg())
    mock_client = _make_async_client(_mock_resp(401))
    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(TestItAuthError):
            run(client.get_work_item("6109"))


def test_403_raises_auth_error():
    client = TestItClient(_cfg())
    mock_client = _make_async_client(_mock_resp(403))
    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(TestItAuthError):
            run(client.get_work_item("6109"))


def test_404_raises_not_found():
    client = TestItClient(_cfg())
    mock_client = _make_async_client(_mock_resp(404, {}))
    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(TestItNotFoundError, match="6109"):
            run(client.get_work_item("6109"))


def test_500_raises_api_error():
    client = TestItClient(_cfg())
    mock_client = _make_async_client(_mock_resp(500, {"message": "Internal error"}))
    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(TestItApiError):
            run(client.get_work_item("6109"))


def test_non_json_raises_response_error():
    client = TestItClient(_cfg())
    mock_client = _make_async_client(_mock_resp(200, raises_json=True))
    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(TestItResponseError):
            run(client.get_work_item("6109"))


# ── Network errors ────────────────────────────────────────────────────────────

def test_timeout_raises_connection_error():
    client = TestItClient(_cfg())
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(TestItConnectionError, match="timed out"):
            run(client.get_work_item("6109"))


def test_request_error_raises_connection_error():
    client = TestItClient(_cfg())
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=httpx.RequestError("conn refused"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(TestItConnectionError):
            run(client.get_work_item("6109"))


# ── Token not leaked ──────────────────────────────────────────────────────────

def test_token_not_in_exception_message():
    client = TestItClient(_cfg(token="supersecrettoken"))
    mock_client = _make_async_client(_mock_resp(401))
    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(TestItAuthError) as exc_info:
            run(client.get_work_item("6109"))
    assert "supersecrettoken" not in str(exc_info.value)
