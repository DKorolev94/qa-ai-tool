from __future__ import annotations

from typing import Annotated, Literal
from pydantic import BaseModel, Field, StringConstraints


class RunnerStartRequest(BaseModel):
    work_item_id: str = Field(..., min_length=1)
    iteration_index: int = Field(default=0, ge=0)
    language: Literal['ru', 'en'] = 'ru'
    force_regenerate: bool = False
    browser_profile: BrowserProfileRequest | None = None
    run_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]+$')


class BrowserProfileRequest(BaseModel):
    is_mobile: bool = False
    viewport_width: int | None = Field(default=None, ge=320, le=7680)
    viewport_height: int | None = Field(default=None, ge=200, le=4320)
    device_scale_factor: float | None = Field(default=None, ge=0.5, le=5.0)
    user_agent: str | None = None
    locale: str | None = None
    timezone_id: str | None = None


class RunnerManualStartRequest(BaseModel):
    task: str = Field(..., min_length=1)
    start_url: str | None = Field(default=None, pattern=r'^https?://.*')
    test_case_id: str | None = None
    sensitive_data: dict[str, str] | None = None
    browser_profile: BrowserProfileRequest | None = None
    language: Literal['ru', 'en'] = 'ru'
    run_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]+$')


class RunnerScreenshot(BaseModel):
    path: str
    url: str


class RunnerRunResponse(BaseModel):
    status: Literal["passed", "failed", "blocked", "stopped"]
    summary: str
    steps_count: int
    errors: list[str]
    screenshots: list[RunnerScreenshot]
    duration_sec: float
    run_id: str | None = None
    replayed: bool = False


class WriteTestItResultRequest(BaseModel):
    work_item_id: str = Field(..., min_length=1)
    status: str
    summary: str = ""
    run_id: str = ""
    duration_sec: float = 0
