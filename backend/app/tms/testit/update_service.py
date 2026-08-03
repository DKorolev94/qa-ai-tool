from __future__ import annotations

import logging

from app.core.config import settings
from app.tms.testit.client import TestItClient, TestItConfigError
from app.tms.testit.update_mapper import build_update_payload
from app.tms.testit.schemas import UpdateOriginalResponse

logger = logging.getLogger(__name__)


async def apply_to_original_in_testit(
    improved_testcase: dict,
    source_work_item_id: str,
    source_attributes: dict | None = None,
) -> UpdateOriginalResponse:
    if not settings.TESTIT_PROJECT_UUID:
        raise TestItConfigError("TESTIT_PROJECT_UUID is not configured in .env", code="testit_project_uuid_missing")

    client = TestItClient()

    original_raw = await client.get_work_item(source_work_item_id)

    payload = build_update_payload(
        original_raw=original_raw,
        improved=improved_testcase,
        source_work_item_id=source_work_item_id,
    )

    logger.info(
        "Updating original work item id=%s name=%s",
        source_work_item_id,
        payload.get("name"),
    )
    updated = await client.update_work_item(source_work_item_id, payload)

    work_item_id = updated.get("id", source_work_item_id)
    global_id = updated.get("globalId")
    title = updated.get("name", payload["name"])

    testit_url: str | None = None
    if global_id and settings.TESTIT_BASE_URL:
        try:
            from app.tms.testit.draft_service import _resolve_project_global_id
            project_global_id = await _resolve_project_global_id(client, settings.TESTIT_PROJECT_UUID)
            if project_global_id:
                testit_url = f"{settings.TESTIT_BASE_URL}/projects/{project_global_id}/tests/{global_id}"
            else:
                testit_url = f"{settings.TESTIT_BASE_URL}/workItems/{work_item_id}"
        except Exception:
            testit_url = f"{settings.TESTIT_BASE_URL}/workItems/{work_item_id}"

    return UpdateOriginalResponse(
        work_item_id=work_item_id,
        global_id=global_id,
        title=title,
        testit_url=testit_url,
    )
