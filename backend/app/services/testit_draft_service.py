from __future__ import annotations

import logging

from app.core.config import settings
from app.integrations.testit_client import TestItClient, TestItConfigError
from app.parsing.testit_draft_mapper import build_draft_payload
from app.schemas.testit import CreateDraftResponse

logger = logging.getLogger(__name__)

DRAFT_SECTION_NAME = "AI Review / Drafts"

# In-process cache: resolved once, reused on subsequent requests
_resolved_section_id: str | None = None
_project_global_id: int | None = None


async def _resolve_section_id(client: TestItClient, project_id: str) -> str:
    global _resolved_section_id

    if _resolved_section_id:
        return _resolved_section_id

    sections = await client.list_sections(project_id)
    root_id: str | None = None
    for s in sections:
        if s.get("name") == DRAFT_SECTION_NAME:
            logger.info("Found existing draft section id=%s", s["id"])
            _resolved_section_id = s["id"]
            return _resolved_section_id
        if not s.get("parentId"):
            root_id = s["id"]

    created = await client.create_section(project_id, DRAFT_SECTION_NAME, parent_id=root_id)
    logger.info("Created draft section id=%s parent_id=%s", created["id"], root_id)
    _resolved_section_id = created["id"]
    return _resolved_section_id


async def _resolve_project_global_id(client: TestItClient, project_id: str) -> int | None:
    global _project_global_id
    if _project_global_id is not None:
        return _project_global_id
    try:
        project = await client.get_project(project_id)
        _project_global_id = project.get("globalId")
        return _project_global_id
    except Exception as exc:
        logger.warning("Could not fetch project globalId: %s", exc)
        return None


async def create_draft_in_testit(
    improved_testcase: dict,
    source_work_item_id: str,
    source_attributes: dict | None = None,
) -> CreateDraftResponse:
    if not settings.TESTIT_PROJECT_UUID:
        raise TestItConfigError("TESTIT_PROJECT_UUID is not configured in .env")

    client = TestItClient()
    if settings.TESTIT_DRAFT_SECTION_UUID:
        section_id = settings.TESTIT_DRAFT_SECTION_UUID
    else:
        section_id = await _resolve_section_id(client, settings.TESTIT_PROJECT_UUID)

    payload = build_draft_payload(
        improved=improved_testcase,
        source_id=source_work_item_id,
        project_id=settings.TESTIT_PROJECT_UUID,
        section_id=section_id,
        source_attributes=source_attributes,
    )

    logger.info(
        "Creating draft work item: name=%s project=%s section=%s",
        payload.get("name"),
        settings.TESTIT_PROJECT_UUID,
        section_id,
    )
    created = await client.create_work_item(payload)

    work_item_id = created.get("id", "")
    global_id = created.get("globalId")
    title = created.get("name", payload["name"])

    testit_url: str | None = None
    if global_id and settings.TESTIT_BASE_URL:
        project_global_id = await _resolve_project_global_id(client, settings.TESTIT_PROJECT_UUID)
        if project_global_id:
            testit_url = f"{settings.TESTIT_BASE_URL}/projects/{project_global_id}/tests/{global_id}"
        else:
            testit_url = f"{settings.TESTIT_BASE_URL}/workItems/{work_item_id}"

    return CreateDraftResponse(
        work_item_id=work_item_id,
        global_id=global_id,
        title=title,
        testit_url=testit_url,
    )
