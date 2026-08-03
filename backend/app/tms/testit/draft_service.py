from __future__ import annotations

import asyncio
import logging

from app.core.config import settings
from app.tms.testit.client import TestItClient, TestItConfigError
from app.tms.testit.draft_mapper import build_draft_payload
from app.tms.testit.schemas import CreateDraftResponse

logger = logging.getLogger(__name__)

DRAFT_SECTION_NAME = "AI Review / Drafts"

# In-process cache: resolved once, reused on subsequent requests
_resolved_section_id: str | None = None
_project_global_id: int | None = None
_enabled_attribute_ids: set[str] | None = None
_section_lock = asyncio.Lock()
_project_lock = asyncio.Lock()
_attributes_lock = asyncio.Lock()


async def _resolve_section_id(client: TestItClient, project_id: str) -> str:
    global _resolved_section_id

    if _resolved_section_id:
        return _resolved_section_id

    async with _section_lock:
        # double-check after acquiring lock — another coroutine may have resolved it
        if _resolved_section_id:
            return _resolved_section_id

        sections = await client.list_sections(project_id)
        known_ids = {s["id"] for s in sections if s.get("id")}
        root_id: str | None = None
        for s in sections:
            if s.get("name") == DRAFT_SECTION_NAME:
                section_id = s.get("id")
                if not section_id:
                    continue
                logger.info("Found existing draft section id=%s", section_id)
                _resolved_section_id = section_id
                return _resolved_section_id
            if root_id is None:
                parent = s.get("parentId")
                if not parent or parent not in known_ids:
                    root_id = s.get("id")

        created = await client.create_section(project_id, DRAFT_SECTION_NAME, parent_id=root_id)
        section_id = created.get("id")
        if not section_id:
            raise RuntimeError(f"TestIT create_section returned no id: {created}")
        logger.info("Created draft section id=%s parent_id=%s", section_id, root_id)
        _resolved_section_id = section_id
        return _resolved_section_id


async def _resolve_project_global_id(client: TestItClient, project_id: str) -> int | None:
    global _project_global_id
    if _project_global_id is not None:
        return _project_global_id
    async with _project_lock:
        if _project_global_id is not None:
            return _project_global_id
        try:
            project = await client.get_project(project_id)
            _project_global_id = project.get("globalId")
            return _project_global_id
        except Exception as exc:
            logger.warning("Could not fetch project globalId: %s", exc)
            return None


async def _resolve_enabled_attribute_ids(client: TestItClient, project_id: str) -> set[str] | None:
    """Returns None if the attribute list couldn't be fetched — callers should
    skip filtering in that case rather than assume everything is disabled."""
    global _enabled_attribute_ids
    if _enabled_attribute_ids is not None:
        return _enabled_attribute_ids
    async with _attributes_lock:
        if _enabled_attribute_ids is not None:
            return _enabled_attribute_ids
        try:
            attributes = await client.list_attributes(project_id)
            _enabled_attribute_ids = {
                a["id"] for a in attributes if a.get("id") and a.get("isEnabled", True)
            }
            return _enabled_attribute_ids
        except Exception as exc:
            logger.warning("Could not fetch project attributes: %s", exc)
            return None


def _filter_disabled_attributes(attributes: dict | None, enabled_ids: set[str] | None) -> dict:
    if not attributes:
        return {}
    if enabled_ids is None:
        return dict(attributes)
    return {k: v for k, v in attributes.items() if k in enabled_ids}


async def create_draft_in_testit(
    improved_testcase: dict,
    source_work_item_id: str,
    source_attributes: dict | None = None,
    manual_notes: list[str] | None = None,
) -> CreateDraftResponse:
    if not settings.TESTIT_PROJECT_UUID:
        raise TestItConfigError("TESTIT_PROJECT_UUID is not configured in .env")

    client = TestItClient()
    if settings.TESTIT_DRAFT_SECTION_UUID:
        section_id = settings.TESTIT_DRAFT_SECTION_UUID
    else:
        section_id = await _resolve_section_id(client, settings.TESTIT_PROJECT_UUID)

    # A draft is a NEW work item — attributes disabled at the project level since the
    # original was created can no longer be set on creation and must be dropped, or
    # TestIT rejects the whole request with "Disabled attribute present".
    enabled_attribute_ids = await _resolve_enabled_attribute_ids(client, settings.TESTIT_PROJECT_UUID)
    filtered_attributes = _filter_disabled_attributes(source_attributes, enabled_attribute_ids)

    payload = build_draft_payload(
        improved=improved_testcase,
        source_id=source_work_item_id,
        project_id=settings.TESTIT_PROJECT_UUID,
        section_id=section_id,
        source_attributes=filtered_attributes,
        manual_notes=manual_notes or [],
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
