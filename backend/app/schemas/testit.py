from __future__ import annotations

from pydantic import BaseModel


class FetchTestItWorkItemRequest(BaseModel):
    input: str


class FetchTestItWorkItemResponse(BaseModel):
    work_item_id: str
    raw_work_item: dict
    normalized_testcase: dict
    warnings: list[str] = []


class CreateDraftRequest(BaseModel):
    improved_testcase: dict
    source_work_item_id: str
    source_attributes: dict = {}


class CreateDraftResponse(BaseModel):
    work_item_id: str
    global_id: int | None = None
    title: str
    testit_url: str | None = None
