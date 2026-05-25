from __future__ import annotations

from app.integrations.testit_client import TestItClient
from app.parsing.testit_link_parser import extract_work_item_id
from app.parsing.testit_workitem_mapper import normalize_testit_workitem
from app.schemas.testit import FetchTestItWorkItemResponse


async def fetch_and_normalize_work_item(input_value: str) -> FetchTestItWorkItemResponse:
    work_item_id = extract_work_item_id(input_value)
    client = TestItClient()
    raw = await client.get_work_item(work_item_id)
    normalized = normalize_testit_workitem(raw)
    return FetchTestItWorkItemResponse(
        work_item_id=work_item_id,
        raw_work_item=raw,
        normalized_testcase=normalized.model_dump(),
        warnings=list(normalized.warnings or []),
    )
