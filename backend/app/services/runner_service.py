from __future__ import annotations

import re

import httpx

from app.core.config import settings
from app.schemas.runner import RunnerRunResponse, RunnerScreenshot, RunnerStartRequest
from app.schemas.testcase import NormalizedTestCase
from app.services.testit_workitem_service import fetch_and_normalize_work_item

_URL_RE = re.compile(r'https?://[^\s)\]}>"\']+')


def _extract_url(testcase: NormalizedTestCase) -> str | None:
    for step in testcase.preconditions:
        m = _URL_RE.search(step.action or "")
        if m:
            return m.group(0)
    for step in testcase.steps:
        m = _URL_RE.search(step.action or "")
        if m:
            return m.group(0)
    return None


def _build_task_prompt(testcase: NormalizedTestCase) -> str:
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
            lines.append(f"- {step.action}")

    if testcase.steps:
        lines.append("")
        lines.append("Steps:")
        for i, step in enumerate(testcase.steps, 1):
            lines.append(f"{i}. {step.action}")
            if step.expected:
                lines.append(f"   Expected result: {step.expected}")
            if step.test_data:
                lines.append(f"   Test data: {step.test_data}")

    lines.append("")
    lines.append("Report: passed / failed / blocked, with a short summary of what you observed.")
    return "\n".join(lines)


async def run_test_case(body: RunnerStartRequest) -> RunnerRunResponse:
    fetch_result = await fetch_and_normalize_work_item(body.work_item_id)
    testcase = NormalizedTestCase(**fetch_result.normalized_testcase)

    task = _build_task_prompt(testcase)
    start_url = _extract_url(testcase)

    payload: dict = {"test_case_id": body.work_item_id, "task": task}
    if start_url:
        payload["start_url"] = start_url

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.RUNNER_URL}/run",
            json=payload,
            timeout=float(settings.RUNNER_TIMEOUT_SEC),
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
