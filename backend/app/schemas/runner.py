from __future__ import annotations

from typing import Literal
from pydantic import BaseModel


class RunnerStartRequest(BaseModel):
    work_item_id: str


class RunnerScreenshot(BaseModel):
    path: str
    url: str


class RunnerRunResponse(BaseModel):
    status: Literal["passed", "failed", "blocked"]
    summary: str
    steps_count: int
    errors: list[str]
    screenshots: list[RunnerScreenshot]
    duration_sec: float
    run_id: str | None = None
