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


def test_5xx_retried_once_then_succeeds():
    # _with_retry's docstring promises resilience to "a flaky TestIT instance" —
    # but it used to only retry on network-level exceptions, so a single 5xx
    # HTTP response (not an exception) went straight to the caller as a hard
    # failure. One retry should now recover from a transient 502.
    client = TestItClient(_cfg())
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=[_mock_resp(502, {"message": "bad gateway"}), _mock_resp(200, {"id": "6109"})])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    with patch("httpx.AsyncClient", return_value=mock_client), patch("asyncio.sleep", AsyncMock()):
        result = run(client.get_work_item("6109"))
    assert result == {"id": "6109"}
    assert mock_client.get.call_count == 2


def test_5xx_persists_past_retry_raises_api_error():
    client = TestItClient(_cfg())
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=[_mock_resp(503, {"message": "down"}), _mock_resp(503, {"message": "still down"})])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    with patch("httpx.AsyncClient", return_value=mock_client), patch("asyncio.sleep", AsyncMock()):
        with pytest.raises(TestItApiError):
            run(client.get_work_item("6109"))
    assert mock_client.get.call_count == 2


def test_write_timeout_not_retried():
    # A read timeout on a POST looks identical to the server-side view as "request
    # received, response lost" — the write may have already been persisted, so
    # retrying (unlike for GET) would risk creating a duplicate work item.
    client = TestItClient(_cfg())
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("timed out"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    with patch("httpx.AsyncClient", return_value=mock_client), patch("asyncio.sleep", AsyncMock()):
        with pytest.raises(TestItConnectionError):
            run(client.create_work_item({"name": "x"}))
    assert mock_client.post.call_count == 1


def test_non_json_raises_response_error():
    client = TestItClient(_cfg())
    mock_client = _make_async_client(_mock_resp(200, raises_json=True))
    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(TestItResponseError):
            run(client.get_work_item("6109"))


def test_non_dict_error_body_raises_api_error_not_attribute_error():
    # A gateway/proxy error page can return a JSON array or bare string —
    # data.get(...) on that would raise AttributeError instead of a typed error.
    client = TestItClient(_cfg())
    mock_client = _make_async_client(_mock_resp(502, ["Bad Gateway"]))
    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(TestItApiError):
            run(client.get_work_item("6109"))


def test_list_sections_non_dict_error_body_raises_api_error():
    client = TestItClient(_cfg())
    mock_client = _make_async_client(_mock_resp(502, "gateway error"))
    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(TestItApiError):
            run(client.list_sections("proj-uuid"))


def test_list_sections_success_still_returns_list():
    client = TestItClient(_cfg())
    mock_client = _make_async_client(_mock_resp(200, [{"id": "s1"}]))
    with patch("httpx.AsyncClient", return_value=mock_client):
        result = run(client.list_sections("proj-uuid"))
    assert result == [{"id": "s1"}]


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


# ── Error code / params ───────────────────────────────────────────────────────

def test_auth_error_has_code():
    from app.tms.testit.client import TestItAuthError
    exc = TestItAuthError("TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.", code="testit_auth_failed")
    assert exc.code == "testit_auth_failed"
    assert exc.params == {}


def test_not_found_error_has_code_and_params():
    from app.tms.testit.client import TestItNotFoundError
    exc = TestItNotFoundError("TestIT work item not found: 6109", code="testit_not_found", id="6109")
    assert exc.code == "testit_not_found"
    assert exc.params == {"id": "6109"}


def test_error_without_code_defaults_to_none():
    from app.tms.testit.client import TestItConnectionError
    exc = TestItConnectionError("Connection to TestIT timed out")
    assert exc.code is None
    assert exc.params == {}
