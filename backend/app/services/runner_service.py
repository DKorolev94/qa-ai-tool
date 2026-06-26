from __future__ import annotations

import re

import httpx

_EXAMPLE_RE = re.compile(
    r'^(например|пример|формат|образец|пр\.|e\.g\.|eg\.|example|like|тип)[:\s]',
    re.IGNORECASE,
)
_PLACEHOLDER_RE = re.compile(r'^<.+>$')

# Strips navigation verbs to detect pure-navigation actions
_NAV_STRIP_RE = re.compile(
    r'\b(?:перейти|перейдите|открыть|открой|navigate|go\s+to|open|visit)\b'
    r'|\b(?:по\s+ссылке|по\s+адресу|на\s+страницу)\b',
    re.IGNORECASE,
)


def _is_pure_nav(action: str, url: str) -> bool:
    """True only when action is essentially just a URL navigation, nothing else."""
    remaining = action.replace(url, '')
    remaining = _NAV_STRIP_RE.sub('', remaining).strip(' .,;:-\n')
    return len(remaining) < 15


def _annotate_test_data(td: str) -> str:
    """Wrap test data with an explicit label so the agent knows how to use it."""
    s = td.strip()
    if _EXAMPLE_RE.match(s):
        return f"[EXAMPLE — generate your own valid value of this type/format] {s}"
    if _PLACEHOLDER_RE.match(s):
        return f"[MISSING DATA — cannot proceed without real value, mark step blocked] {s}"
    return f"[USE EXACTLY] {s}"

from app.core.config import settings
from app.schemas.runner import RunnerManualStartRequest, RunnerRunResponse, RunnerScreenshot, RunnerStartRequest
from app.schemas.testcase import NormalizedTestCase
from app.services.testit_workitem_service import fetch_and_normalize_work_item

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



async def _call_runner(payload: dict, timeout: float) -> RunnerRunResponse:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.RUNNER_URL}/run",
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()

    screenshot_paths: list[str] = data.get("artifacts", {}).get("screenshot_paths", [])
    screenshots = [
        RunnerScreenshot(path=p, url=f"/api/runner/screenshot?path={p}")
        for p in screenshot_paths
    ]
    return RunnerRunResponse(
        status=data["status"],
        summary=data.get("summary", ""),
        steps_count=data.get("steps_count", 0),
        errors=data.get("errors", []),
        screenshots=screenshots,
        duration_sec=data.get("duration_sec", 0.0),
        run_id=data.get("run_id"),
    )


def _build_manual_task_prompt(task: str) -> str:
    return (
        "You are a QA engineer executing a browser task.\n"
        "Complete the task below exactly as described. Be efficient — do not explore beyond what is needed.\n"
        "Once you have verified the result, immediately call the 'done' action with plain text:\n"
        "start with passed/failed/blocked, then one sentence describing what you observed.\n"
        "Do not use JSON, code blocks, or any structured format in the done() call.\n"
        "\n"
        f"Task:\n{task}"
    )


async def start_manual_streaming(body: RunnerManualStartRequest) -> dict:
    payload: dict = {
        'test_case_id': body.test_case_id or 'manual',
        'task': _build_manual_task_prompt(body.task),
    }
    start_url = body.start_url
    if not start_url:
        m = _URL_RE.search(body.task)
        if m:
            start_url = m.group(0)
    if start_url:
        payload['start_url'] = start_url
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f'{settings.RUNNER_URL}/start',
            json=payload,
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()


async def start_testit_streaming(work_item_id: str, iteration_index: int = 0) -> dict:
    fetch_result = await fetch_and_normalize_work_item(work_item_id)
    testcase = NormalizedTestCase(**fetch_result.normalized_testcase)
    params = _params_row(testcase, iteration_index)
    task = _build_task_prompt(testcase, params)
    start_url = _extract_url(testcase, params)
    payload: dict = {'test_case_id': work_item_id, 'task': task}
    if start_url:
        payload['start_url'] = start_url
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f'{settings.RUNNER_URL}/start',
            json=payload,
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()



async def list_sessions(limit: int = 20) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f'{settings.RUNNER_URL}/runs?limit={limit}',
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
    known = {'passed', 'failed', 'blocked'}
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


async def run_manual(body: RunnerManualStartRequest) -> RunnerRunResponse:
    payload: dict = {
        "test_case_id": body.test_case_id or "manual",
        "task": _build_manual_task_prompt(body.task),
    }
    if body.start_url:
        payload["start_url"] = body.start_url
    return await _call_runner(payload, float(settings.RUNNER_TIMEOUT_SEC))


async def run_test_case(body: RunnerStartRequest) -> RunnerRunResponse:
    fetch_result = await fetch_and_normalize_work_item(body.work_item_id)
    testcase = NormalizedTestCase(**fetch_result.normalized_testcase)
    params = _params_row(testcase, body.iteration_index)
    task = _build_task_prompt(testcase, params)
    start_url = _extract_url(testcase, params)

    payload: dict = {"test_case_id": body.work_item_id, "task": task}
    if start_url:
        payload["start_url"] = start_url
    return await _call_runner(payload, float(settings.RUNNER_TIMEOUT_SEC))
