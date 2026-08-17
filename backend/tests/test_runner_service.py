from app.schemas.runner import RunnerRunResponse, RunnerScreenshot, RunnerStartRequest


def test_runner_start_request_requires_work_item_id():
    req = RunnerStartRequest(work_item_id="6109")
    assert req.work_item_id == "6109"


def test_runner_run_response_defaults():
    r = RunnerRunResponse(
        status="passed",
        summary="All steps completed",
        steps_count=5,
        errors=[],
        screenshots=[],
        duration_sec=12.3,
        run_id="abc-123",
    )
    assert r.status == "passed"
    assert r.screenshots == []


import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.runner_service import _build_task_prompt, _extract_url
from app.schemas.testcase import NormalizedTestCase, TestCaseStep


def _tc(**kwargs) -> NormalizedTestCase:
    defaults = dict(title="Login test", preconditions=[], steps=[], postconditions=[])
    return NormalizedTestCase(**{**defaults, **kwargs})


def test_build_prompt_includes_title():
    tc = _tc(title="Check login form")
    prompt = _build_task_prompt(tc)
    assert "Check login form" in prompt


def test_build_prompt_numbers_steps():
    tc = _tc(steps=[
        TestCaseStep(action="Open page", expected="Page loaded"),
        TestCaseStep(action="Click button", expected="Modal shown"),
    ])
    prompt = _build_task_prompt(tc)
    assert "1. Open page" in prompt
    assert "Expected result: Page loaded" in prompt
    assert "2. Click button" in prompt


def test_build_prompt_includes_preconditions():
    tc = _tc(preconditions=[TestCaseStep(action="User is logged in")])
    prompt = _build_task_prompt(tc)
    assert "User is logged in" in prompt


def test_build_prompt_skips_empty_expected():
    tc = _tc(steps=[TestCaseStep(action="Do something", expected=None)])
    prompt = _build_task_prompt(tc)
    assert "Expected result" not in prompt


def test_extract_url_from_preconditions():
    tc = _tc(preconditions=[TestCaseStep(action="Open https://example.com/login")])
    assert _extract_url(tc) == "https://example.com/login"


def test_extract_url_from_steps_if_no_precondition_url():
    tc = _tc(steps=[TestCaseStep(action="Navigate to https://app.example.com/dashboard")])
    assert _extract_url(tc) == "https://app.example.com/dashboard"


def test_extract_url_returns_none_when_no_url():
    tc = _tc(steps=[TestCaseStep(action="Click the button")])
    assert _extract_url(tc) is None


from app.schemas.runner import BrowserProfileRequest
from app.services.runner_service import _cache_fields


def test_cache_fields_absent_without_tag():
    tc = _tc(tags=[], attributes={"modifiedDate": "2026-01-01"})
    assert _cache_fields(tc, False) == {"force_regenerate": False}


def test_cache_fields_present_with_tag_and_modified_date():
    tc = _tc(tags=["cache-ok"], attributes={"modifiedDate": "2026-01-01"})
    assert _cache_fields(tc, False) == {"force_regenerate": False, "cache_key": "2026-01-01:auto:desktop"}


def test_cache_fields_absent_without_modified_date():
    tc = _tc(tags=["cache-ok"], attributes={})
    assert _cache_fields(tc, False) == {"force_regenerate": False}


def test_cache_fields_force_regenerate_passthrough():
    tc = _tc(tags=["cache-ok"], attributes={"modifiedDate": "2026-01-01"})
    assert _cache_fields(tc, True) == {"force_regenerate": True, "cache_key": "2026-01-01:auto:desktop"}


def test_cache_fields_locale_changes_cache_key():
    # A recording made under one locale renders different page text than another —
    # replaying it under a mismatched locale would silently skip the locale-specific
    # assertion instead of re-verifying it, so locale must bust the cache key.
    tc = _tc(tags=["cache-ok"], attributes={"modifiedDate": "2026-01-01"})
    ru = _cache_fields(tc, False, BrowserProfileRequest(locale="ru-RU"))
    en = _cache_fields(tc, False, BrowserProfileRequest(locale="en-US"))
    auto = _cache_fields(tc, False)
    assert ru["cache_key"] == "2026-01-01:ru-RU:desktop"
    assert en["cache_key"] == "2026-01-01:en-US:desktop"
    assert auto["cache_key"] == "2026-01-01:auto:desktop"
    assert len({ru["cache_key"], en["cache_key"], auto["cache_key"]}) == 3


def test_cache_fields_device_changes_cache_key():
    # Same reasoning as locale — a recording made on one device shape (viewport,
    # touch emulation) isn't a valid stand-in for another, so device must bust
    # the cache key too, independently of locale.
    tc = _tc(tags=["cache-ok"], attributes={"modifiedDate": "2026-01-01"})
    desktop = _cache_fields(tc, False, BrowserProfileRequest(is_mobile=False))
    mobile = _cache_fields(tc, False, BrowserProfileRequest(is_mobile=True))
    tablet = _cache_fields(tc, False, BrowserProfileRequest(is_mobile=True, viewport_width=820, viewport_height=1180))
    assert desktop["cache_key"] == "2026-01-01:auto:desktop"
    assert mobile["cache_key"] == "2026-01-01:auto:mobile"
    assert tablet["cache_key"] == "2026-01-01:auto:mobile-820x1180"
    assert len({desktop["cache_key"], mobile["cache_key"], tablet["cache_key"]}) == 3


import asyncio


def run(coro):
    return asyncio.run(coro)


def test_run_test_case_includes_cache_key_when_tagged(monkeypatch):
    from app.services import runner_service

    tc = _tc(tags=["cache-ok"], attributes={"modifiedDate": "2026-01-01"})
    fetch_result = MagicMock(normalized_testcase=tc.model_dump())

    captured_payload = {}

    async def fake_call_runner(payload, timeout):
        captured_payload.update(payload)
        return RunnerRunResponse(status="passed", summary="ok", steps_count=1, errors=[], screenshots=[], duration_sec=1.0, run_id="r1")

    monkeypatch.setattr(runner_service, "fetch_and_normalize_work_item", AsyncMock(return_value=fetch_result))
    monkeypatch.setattr(runner_service, "_call_runner", fake_call_runner)

    body = RunnerStartRequest(work_item_id="6110")
    run(runner_service.run_test_case(body))

    assert captured_payload["cache_key"] == "2026-01-01:auto:desktop"
    assert captured_payload["force_regenerate"] is False


def test_call_runner_handles_null_artifacts():
    # "artifacts": null is valid JSON the runner can legitimately send (e.g. on
    # some early-failure paths) — data.get("artifacts", {}).get(...) used to
    # raise AttributeError on it instead of falling back to no screenshots.
    from app.services.runner_service import _call_runner

    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {"status": "passed", "summary": "ok", "artifacts": None}
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    with patch("httpx.AsyncClient", return_value=mock_client):
        result = run(_call_runner({"task": "x"}, 10.0))

    assert result.status == "passed"
    assert result.screenshots == []


def test_call_runner_raises_clear_error_when_status_missing():
    # A runner response missing "status" used to raise a bare KeyError.
    from app.services.runner_service import _call_runner

    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {"summary": "ok"}
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(RuntimeError, match="status"):
            run(_call_runner({"task": "x"}, 10.0))


def test_run_test_case_omits_cache_key_without_tag(monkeypatch):
    from app.services import runner_service

    tc = _tc(tags=[], attributes={"modifiedDate": "2026-01-01"})
    fetch_result = MagicMock(normalized_testcase=tc.model_dump())

    captured_payload = {}

    async def fake_call_runner(payload, timeout):
        captured_payload.update(payload)
        return RunnerRunResponse(status="passed", summary="ok", steps_count=1, errors=[], screenshots=[], duration_sec=1.0, run_id="r1")

    monkeypatch.setattr(runner_service, "fetch_and_normalize_work_item", AsyncMock(return_value=fetch_result))
    monkeypatch.setattr(runner_service, "_call_runner", fake_call_runner)

    body = RunnerStartRequest(work_item_id="6110")
    run(runner_service.run_test_case(body))

    assert "cache_key" not in captured_payload


def test_stop_during_pending_start_prevents_runner_call():
    # start-testit does a TestIT round-trip before ever reaching the runner —
    # a /stop for the same client-known run_id arriving during that window
    # used to just vanish (runner had never heard of run_id yet, replied
    # "not_running", and the run then started anyway and ran unstopped). It
    # must instead cancel the pending start before the runner call fires.
    from app.services import runner_service

    run_id = "race-test-run-id"
    fetch_started = asyncio.Event()
    release_fetch = asyncio.Event()
    tc = _tc(tags=[], attributes={})
    fetch_result = MagicMock(normalized_testcase=tc.model_dump())

    async def slow_fetch(work_item_id):
        fetch_started.set()
        await release_fetch.wait()
        return fetch_result

    posted_urls = []

    async def fake_post(url, **kwargs):
        posted_urls.append(url)
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json.return_value = {"run_id": run_id, "status": "not_running"}
        return resp

    mock_client = AsyncMock()
    mock_client.post = fake_post
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    async def scenario():
        with patch("app.services.runner_service.fetch_and_normalize_work_item", slow_fetch), \
             patch("httpx.AsyncClient", return_value=mock_client):
            start_task = asyncio.create_task(
                runner_service.start_testit_streaming("6110", 0, "ru", False, run_id, None)
            )
            await fetch_started.wait()  # start-testit is now mid-TestIT-fetch, run_id is "pending"
            stop_result = await runner_service.stop_session(run_id)
            release_fetch.set()
            start_result = await start_task
            return start_result, stop_result

    start_result, stop_result = run(scenario())

    assert start_result == {"run_id": run_id, "cancelled": True}
    assert not any(url.endswith("/start") for url in posted_urls)
    # the pending-set bookkeeping must not leak past this run_id's lifecycle
    assert run_id not in runner_service._pending_run_ids
    assert run_id not in runner_service._cancelled_pending_run_ids


def test_list_sessions_includes_stopped_runs():
    # 'stopped' is a real, terminal RunStatus (browser-use-runner/views.py) —
    # history must show it same as passed/failed/blocked, not silently drop
    # it, or a user who stopped a run has no record it ever happened.
    from app.services import runner_service

    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {"runs": [
        {"run_id": "r1", "status": "passed"},
        {"run_id": "r2", "status": "failed"},
        {"run_id": "r3", "status": "blocked"},
        {"run_id": "r4", "status": "stopped"},
        {"run_id": "r5", "status": "running"},  # in-flight run, never terminal-listed
    ]}
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = run(runner_service.list_sessions())

    ids = {s["run_id"] for s in result["sessions"]}
    assert ids == {"r1", "r2", "r3", "r4"}
