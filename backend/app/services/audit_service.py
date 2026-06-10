from __future__ import annotations

import httpx

from app.core.config import settings
from app.schemas.audit import AuditRunResponse, AuditScreenshot, AuditStartRequest


def _build_audit_prompt(task: str) -> str:
    return (
        "You are a QA engineer auditing a web application.\n"
        "Complete the task below exactly as described.\n"
        "Once you have observed and verified the result, immediately call the 'done' action with plain text:\n"
        "start with passed/failed/blocked, then one sentence describing what you observed.\n"
        "Do not use JSON, code blocks, or any structured format in the done() call.\n"
        "\n"
        f"Task:\n{task}"
    )


async def start_audit_streaming(body: AuditStartRequest) -> dict:
    payload: dict = {
        "test_case_id": body.audit_id or "audit",
        "task": _build_audit_prompt(body.task),
    }
    if body.start_url:
        payload["start_url"] = body.start_url
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.AUDIT_RUNNER_URL}/start",
            json=payload,
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()


async def list_audit_sessions(limit: int = 20) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{settings.AUDIT_RUNNER_URL}/runs?limit={limit}",
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
    known = {"passed", "failed", "blocked"}
    runs = [r for r in data.get("runs", []) if r.get("status") in known]
    return {"sessions": runs}


async def get_audit_session_steps(run_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{settings.AUDIT_RUNNER_URL}/runs/{run_id}/steps",
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()
