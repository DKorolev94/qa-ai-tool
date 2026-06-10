from __future__ import annotations

from typing import Literal
from pydantic import BaseModel


class AuditStartRequest(BaseModel):
    task: str
    start_url: str | None = None
    audit_id: str | None = None


class AuditScreenshot(BaseModel):
    path: str
    url: str


class AuditRunResponse(BaseModel):
    status: Literal["passed", "failed", "blocked"]
    summary: str
    steps_count: int
    errors: list[str]
    screenshots: list[AuditScreenshot]
    duration_sec: float
    run_id: str | None = None
