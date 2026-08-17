from __future__ import annotations

import asyncio
import logging

from app.core.config import settings
from app.tms.testit.client import TestItApiError, TestItClient, TestItConfigError
from app.tms.testit.draft_mapper import build_draft_payload
from app.tms.testit.link_parser import extract_work_item_id
from app.tms.testit.schemas import CreateDraftResponse

logger = logging.getLogger(__name__)

DRAFT_SECTION_NAME = "AI Review / Drafts"

# In-process caches, keyed by project_id. A draft now always goes to whichever
# project its source test case came from (create_draft_in_testit fetches the
# source work item and reads its own projectId, not a single fixed setting) —
# a plain singleton cache would leak one project's section/attribute data
# into a request for a different project.
_resolved_section_ids: dict[str, str] = {}
_project_global_ids: dict[str, int] = {}
_enabled_attribute_ids_by_project: dict[str, set[str] | None] = {}
_section_locks: dict[str, asyncio.Lock] = {}
_project_locks: dict[str, asyncio.Lock] = {}
_attribute_locks: dict[str, asyncio.Lock] = {}


def _lock_for(locks: dict[str, asyncio.Lock], key: str) -> asyncio.Lock:
    # dict.setdefault has no `await` between check and set, so this is safe
    # without its own lock despite running on a shared event loop.
    return locks.setdefault(key, asyncio.Lock())


async def _resolve_section_id(client: TestItClient, project_id: str) -> str:
    cached = _resolved_section_ids.get(project_id)
    if cached:
        return cached

    async with _lock_for(_section_locks, project_id):
        # double-check after acquiring lock — another coroutine may have resolved it
        cached = _resolved_section_ids.get(project_id)
        if cached:
            return cached

        sections = await client.list_sections(project_id)
        known_ids = {s["id"] for s in sections if s.get("id")}
        root_id: str | None = None
        for s in sections:
            if s.get("name") == DRAFT_SECTION_NAME:
                section_id = s.get("id")
                if not section_id:
                    continue
                logger.info("Found existing draft section id=%s project=%s", section_id, project_id)
                _resolved_section_ids[project_id] = section_id
                return section_id
            if root_id is None:
                parent = s.get("parentId")
                if not parent or parent not in known_ids:
                    root_id = s.get("id")

        created = await client.create_section(project_id, DRAFT_SECTION_NAME, parent_id=root_id)
        section_id = created.get("id")
        if not section_id:
            raise RuntimeError(f"TestIT create_section returned no id: {created}")
        logger.info("Created draft section id=%s parent_id=%s project=%s", section_id, root_id, project_id)
        _resolved_section_ids[project_id] = section_id
        return section_id


async def _resolve_project_global_id(client: TestItClient, project_id: str) -> int | None:
    cached = _project_global_ids.get(project_id)
    if cached is not None:
        return cached
    async with _lock_for(_project_locks, project_id):
        cached = _project_global_ids.get(project_id)
        if cached is not None:
            return cached
        try:
            project = await client.get_project(project_id)
            global_id = project.get("globalId")
            if global_id is not None:
                _project_global_ids[project_id] = global_id
            return global_id
        except Exception as exc:
            logger.warning("Could not fetch project globalId for project=%s: %s", project_id, exc)
            return None


async def _resolve_enabled_attribute_ids(client: TestItClient, project_id: str) -> set[str] | None:
    """Returns None if the attribute list couldn't be fetched — callers should
    skip filtering in that case rather than assume everything is disabled."""
    if project_id in _enabled_attribute_ids_by_project:
        return _enabled_attribute_ids_by_project[project_id]
    async with _lock_for(_attribute_locks, project_id):
        if project_id in _enabled_attribute_ids_by_project:
            return _enabled_attribute_ids_by_project[project_id]
        try:
            attributes = await client.list_attributes(project_id)
            enabled_ids = {
                a["id"] for a in attributes if a.get("id") and a.get("isEnabled", True)
            }
            _enabled_attribute_ids_by_project[project_id] = enabled_ids
            return enabled_ids
        except Exception as exc:
            logger.warning("Could not fetch project attributes for project=%s: %s", project_id, exc)
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
    source_work_item_id = extract_work_item_id(source_work_item_id)
    client = TestItClient()

    # projectId lives on the raw work item itself, not in its `attributes` dict
    # (source_attributes is TestIT's custom-field map, reused verbatim as the
    # draft's own attributes below) — so the source item is fetched fresh here
    # rather than trusting a client-supplied value.
    source_work_item = await client.get_work_item(source_work_item_id)
    project_id = source_work_item.get("projectId")
    if not project_id:
        raise TestItConfigError(
            "Source test case has no projectId — cannot determine which TestIT project to save the draft to",
            code="testit_project_uuid_missing",
        )

    section_id = await _resolve_section_id(client, project_id)

    # A draft is a NEW work item — attributes disabled at the project level since the
    # original was created can no longer be set on creation and must be dropped, or
    # TestIT rejects the whole request with "Disabled attribute present".
    enabled_attribute_ids = await _resolve_enabled_attribute_ids(client, project_id)
    filtered_attributes = _filter_disabled_attributes(source_attributes, enabled_attribute_ids)

    payload = build_draft_payload(
        improved=improved_testcase,
        project_id=project_id,
        section_id=section_id,
        source_attributes=filtered_attributes,
    )

    logger.info(
        "Creating draft work item: name=%s project=%s section=%s",
        payload.get("name"),
        project_id,
        section_id,
    )
    try:
        created = await client.create_work_item(payload)
    except TestItApiError:
        # Cached section_id may point at a section that was since renamed/deleted
        # in TestIT — drop the cache so the next call re-resolves it instead of
        # failing forever until the process restarts. Scoped to TestItApiError
        # specifically (TestIT rejected the payload) — an auth/config/network
        # failure has nothing to do with the section's validity and shouldn't
        # force a needless re-resolve on the next call.
        _resolved_section_ids.pop(project_id, None)
        raise

    work_item_id = created.get("id", "")
    global_id = created.get("globalId")
    title = created.get("name", payload["name"])

    needs_review = payload.get("state") != "Ready"
    if work_item_id and needs_review:
        provenance = f"🤖 Сгенерировано qa-ai-tool из #{source_work_item_id}. Требуется проверка QA перед заменой оригинала."
        comments = [provenance, *(manual_notes or [])]
        posted = 0
        for comment in comments:
            try:
                await client.create_work_item_comment(work_item_id, comment)
                posted += 1
            except Exception:
                logger.exception(
                    "Failed to post one draft comment for work_item_id=%s (comment: %.80s)",
                    work_item_id, comment,
                )
        if posted < len(comments):
            logger.warning(
                "Draft work_item_id=%s only got %d/%d comments posted — some manual-review notes may be missing in TestIT",
                work_item_id, posted, len(comments),
            )

    testit_url: str | None = None
    if global_id and settings.TESTIT_BASE_URL:
        project_global_id = await _resolve_project_global_id(client, project_id)
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
