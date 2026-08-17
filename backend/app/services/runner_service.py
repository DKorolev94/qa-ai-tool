from __future__ import annotations

import re

import httpx

from app.core.config import settings
from app.schemas.runner import BrowserProfileRequest, RunnerManualStartRequest, RunnerRunResponse, RunnerScreenshot, RunnerStartRequest
from app.schemas.testcase import NormalizedTestCase
from app.tms.testit.workitem_service import fetch_and_normalize_work_item

_URL_RE = re.compile(r'https?://[^\s)\]}>"\']+')
# Matches %param_name% or %param_name (TestIT parameter placeholder format)
_PARAM_RE = re.compile(r'%(\w+)%?')


def _params_row(testcase: NormalizedTestCase, iteration_index: int) -> dict[str, str]:
    pt = testcase.parameter_table
    if not pt or not pt.rows:
        return {}
    idx = min(max(0, iteration_index), len(pt.rows) - 1)
    return dict(zip(pt.names, pt.rows[idx]))


def _subst(text: str | None, params: dict[str, str]) -> str:
    if not text:
        return ""
    if not params:
        return text
    return _PARAM_RE.sub(lambda m: params.get(m.group(1), m.group(0)), text)


def _extract_url(testcase: NormalizedTestCase, params: dict[str, str] | None = None) -> str | None:
    p = params or {}
    m = _URL_RE.search(_subst(testcase.description, p))
    if m:
        return m.group(0)
    for step in testcase.preconditions:
        for text in (_subst(step.action, p), _subst(step.test_data, p)):
            if text:
                m = _URL_RE.search(text)
                if m:
                    return m.group(0)
    for step in testcase.steps:
        for text in (_subst(step.action, p), _subst(step.test_data, p)):
            if text:
                m = _URL_RE.search(text)
                if m:
                    return m.group(0)
    return None


def _build_task_prompt(testcase: NormalizedTestCase, params: dict[str, str] | None = None) -> str:
    p = params or {}
    lines = [
        "You are a QA engineer executing a manual test case in a web browser.",
        "Follow each step exactly. After completing all steps, report whether",
        "the test passed, failed, or is blocked (cannot proceed due to a missing",
        "precondition or environment issue).",
        "",
        f"Test case: {testcase.title or 'Untitled'}",
    ]

    if testcase.preconditions:
        lines.append("")
        lines.append("Preconditions:")
        for step in testcase.preconditions:
            lines.append(f"- {_subst(step.action, p)}")
            td = _subst(step.test_data, p)
            if td:
                lines.append(f"  Test data: {td}")

    if testcase.steps:
        lines.append("")
        lines.append("Steps:")
        for i, step in enumerate(testcase.steps, 1):
            lines.append(f"{i}. {_subst(step.action, p)}")
            exp = _subst(step.expected, p)
            if exp:
                lines.append(f"   Expected result: {exp}")
            td = _subst(step.test_data, p)
            if td:
                lines.append(f"   Test data: {td}")

    lines.append("")
    lines.append("When done, call the 'done' action with plain text: start with passed/failed/blocked, then one sentence describing what you observed. Do not use JSON, code blocks, or any structured format.")
    return "\n".join(lines)


def _device_signature(profile: BrowserProfileRequest | None) -> str:
    # Same reasoning as locale: a recording made on one device shape isn't a
    # valid stand-in for another (different viewport/layout can change what
    # renders, what's clickable, even pass/fail) — so device must bust the
    # cache key too, derived from the actual profile rather than a UI label
    # so any future custom viewport buckets correctly without new plumbing.
    if not profile or not profile.is_mobile:
        return "desktop"
    if profile.viewport_width and profile.viewport_height:
        return f"mobile-{profile.viewport_width}x{profile.viewport_height}"
    return "mobile"


def _cache_fields(
    testcase: NormalizedTestCase, force_regenerate: bool, browser_profile: BrowserProfileRequest | None = None,
) -> dict:
    fields: dict = {"force_regenerate": force_regenerate}
    modified_date = testcase.attributes.get("modifiedDate")
    if "cache-ok" in testcase.tags and modified_date:
        locale = browser_profile.locale if browser_profile else None
        fields["cache_key"] = f"{modified_date}:{locale or 'auto'}:{_device_signature(browser_profile)}"
    return fields


async def _call_runner(payload: dict, timeout: float) -> RunnerRunResponse:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.RUNNER_URL}/run",
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()

    # Defensive: runner's response is a plain dict (see browser-use-runner/main.py
    # build_manifest), not a shared Pydantic contract — "artifacts": null or a
    # missing "status" would otherwise raise AttributeError/KeyError here instead
    # of a clean error the caller's httpx.* handlers can translate to a 502.
    artifacts = data.get("artifacts") or {}
    screenshot_paths: list[str] = artifacts.get("screenshot_paths", [])
    screenshots = [
        RunnerScreenshot(path=p, url=f"/api/runner/screenshot?path={p}")
        for p in screenshot_paths
    ]
    status = data.get("status")
    if status is None:
        raise RuntimeError("Runner response missing 'status'")
    return RunnerRunResponse(
        status=status,
        summary=data.get("summary", ""),
        steps_count=data.get("steps_count", 0),
        errors=data.get("errors", []),
        screenshots=screenshots,
        duration_sec=data.get("duration_sec", 0.0),
        run_id=data.get("run_id"),
        replayed=data.get("replayed", False),
    )


def _build_manual_task_prompt(task: str) -> str:
    return (
        "You are a QA engineer executing a browser test.\n"
        "Execute ONLY the steps listed below — nothing more, nothing less.\n"
        "Do NOT navigate, click, scroll, or explore anything not explicitly required by the steps.\n"
        "After completing the last step, call done() IMMEDIATELY.\n"
        "In done(), write plain text: start with passed/failed/blocked, then one sentence describing what you observed.\n"
        "Do not use JSON, code blocks, or structured format in done().\n"
        "\n"
        f"Steps:\n{task}"
    )


# A client-generated run_id is known (and stoppable, per the frontend) before
# /start-testit even reaches the runner — it does a TestIT API round-trip
# first. A /stop for that run_id arriving during that window used to just
# vanish: the runner had never heard of the run_id yet, so it correctly (but
# uselessly) replied "not_running", and the run then started anyway and ran
# to completion unstopped. This tracks run_ids in that pending window so a
# /stop can flag them for cancellation before the runner call ever fires.
_pending_run_ids: set[str] = set()
_cancelled_pending_run_ids: set[str] = set()


async def start_manual_streaming(body: RunnerManualStartRequest) -> dict:
    payload: dict = {
        'test_case_id': body.test_case_id or 'manual',
        'task': _build_manual_task_prompt(body.task),
        'language': body.language,
    }
    start_url = body.start_url
    if not start_url:
        m = _URL_RE.search(body.task)
        if m:
            start_url = m.group(0)
    if start_url:
        payload['start_url'] = start_url
    if body.sensitive_data:
        payload['sensitive_data'] = body.sensitive_data
    if body.browser_profile:
        profile = body.browser_profile.model_dump(exclude_none=True, exclude_defaults=True)
        if profile:
            payload['browser_profile'] = profile
    if body.run_id:
        payload['run_id'] = body.run_id
    if body.run_id:
        _pending_run_ids.add(body.run_id)
    try:
        if body.run_id and body.run_id in _cancelled_pending_run_ids:
            _cancelled_pending_run_ids.discard(body.run_id)
            return {'run_id': body.run_id, 'cancelled': True}
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f'{settings.RUNNER_URL}/start',
                json=payload,
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()
    finally:
        if body.run_id:
            _pending_run_ids.discard(body.run_id)


async def start_testit_streaming(
    work_item_id: str, iteration_index: int = 0, language: str = 'ru', force_regenerate: bool = False,
    run_id: str | None = None, browser_profile: BrowserProfileRequest | None = None,
) -> dict:
    if run_id:
        _pending_run_ids.add(run_id)
    try:
        fetch_result = await fetch_and_normalize_work_item(work_item_id)
        testcase = NormalizedTestCase(**fetch_result.normalized_testcase)
        params = _params_row(testcase, iteration_index)
        task = _build_task_prompt(testcase, params)
        start_url = _extract_url(testcase, params)
        payload: dict = {'test_case_id': work_item_id, 'task': task, 'language': language}
        payload.update(_cache_fields(testcase, force_regenerate, browser_profile))
        if start_url:
            payload['start_url'] = start_url
        if run_id:
            payload['run_id'] = run_id
        if browser_profile:
            profile = browser_profile.model_dump(exclude_none=True, exclude_defaults=True)
            if profile:
                payload['browser_profile'] = profile

        if run_id and run_id in _cancelled_pending_run_ids:
            # A /stop for this run_id arrived while we were still fetching from
            # TestIT — skip starting it on the runner at all rather than let a
            # run nobody's watching burn LLM/browser time to completion.
            _cancelled_pending_run_ids.discard(run_id)
            return {'run_id': run_id, 'cancelled': True}

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f'{settings.RUNNER_URL}/start',
                json=payload,
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()
    finally:
        if run_id:
            _pending_run_ids.discard(run_id)



async def list_sessions(limit: int = 20) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f'{settings.RUNNER_URL}/runs?limit={limit}',
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
    known = {'passed', 'failed', 'blocked', 'stopped'}
    runs = [r for r in data.get('runs', []) if r.get('status') in known]
    return {'sessions': runs}


async def get_session_steps(run_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f'{settings.RUNNER_URL}/runs/{run_id}/steps',
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()


async def get_session_logs(run_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f'{settings.RUNNER_URL}/runs/{run_id}/logs',
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()


async def stop_session(run_id: str) -> dict:
    if run_id in _pending_run_ids:
        # Still between accepting /start-testit (or -manual) and the runner
        # actually knowing about it — flag it so that call skips starting the
        # run at all once it gets there, instead of racing it and losing.
        _cancelled_pending_run_ids.add(run_id)
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f'{settings.RUNNER_URL}/runs/{run_id}/stop',
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()


async def run_manual(body: RunnerManualStartRequest) -> RunnerRunResponse:
    payload: dict = {
        "test_case_id": body.test_case_id or "manual",
        "task": _build_manual_task_prompt(body.task),
        "language": body.language,
    }
    if body.start_url:
        payload["start_url"] = body.start_url
    if body.sensitive_data:
        payload["sensitive_data"] = body.sensitive_data
    if body.browser_profile:
        profile = body.browser_profile.model_dump(exclude_none=True, exclude_defaults=True)
        if profile:
            payload["browser_profile"] = profile
    return await _call_runner(payload, float(settings.RUNNER_TIMEOUT_SEC))


async def run_test_case(body: RunnerStartRequest) -> RunnerRunResponse:
    fetch_result = await fetch_and_normalize_work_item(body.work_item_id)
    testcase = NormalizedTestCase(**fetch_result.normalized_testcase)
    params = _params_row(testcase, body.iteration_index)
    task = _build_task_prompt(testcase, params)
    start_url = _extract_url(testcase, params)

    payload: dict = {"test_case_id": body.work_item_id, "task": task}
    payload.update(_cache_fields(testcase, body.force_regenerate, body.browser_profile))
    if start_url:
        payload["start_url"] = start_url
    return await _call_runner(payload, float(settings.RUNNER_TIMEOUT_SEC))
