from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.analysis import ReviewRuleId


class BulkReviewRequest(BaseModel):
    work_item_ids: list[str] = Field(..., min_length=1, max_length=200)
    enabled_rules: list[ReviewRuleId] | None = None
    language: Literal["ru", "en"] = "ru"


class BulkReviewItemResult(BaseModel):
    work_item_id: str
    status: Literal[
        "pending", "reviewing", "improving", "creating_draft", "done", "error", "cancelled",
    ] = "pending"
    issues_count: int = 0
    draft_work_item_id: str | None = None
    testit_url: str | None = None
    error: str | None = None
    needs_manual_review: bool = False
    manual_notes: list[str] = []


class BulkReviewJobStatus(BaseModel):
    job_id: str
    done: bool = False
    items: list[BulkReviewItemResult] = []
    # Stored so a later per-item retry reruns with the same settings as the
    # original batch, without the frontend having to resend them.
    enabled_rules: list[ReviewRuleId] | None = None
    language: Literal["ru", "en"] = "ru"
