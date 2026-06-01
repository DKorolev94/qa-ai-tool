# Final Actions (Screen 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Создать черновик" (fixed) and "Применить к оригиналу" (new) buttons with proper availability logic, section picker modal, confirmation modal, and tag cleanup.

**Architecture:** Backend gains `update_work_item` + new route/service for overwriting the original TestIT work item. Frontend gains two independent action buttons with computed availability, two modal components, and tag filtering in TestCaseView. Section list is mocked in frontend (TODO comment for real API).

**Tech Stack:** FastAPI + httpx (backend), React + TypeScript (frontend), existing design system (`var(--accent)`, `var(--r-*)`)

---

## File Map

| File | Change |
|---|---|
| `backend/app/integrations/testit_client.py` | add `update_work_item` |
| `backend/app/parsing/testit_update_mapper.py` | **new** — `build_update_payload` |
| `backend/app/schemas/testit.py` | add `UpdateOriginalRequest`, `UpdateOriginalResponse` |
| `backend/app/services/testit_update_service.py` | **new** — `apply_to_original_in_testit` |
| `backend/app/api/routes.py` | add `POST /testit/workitem/update-original` |
| `backend/tests/test_testit_update_mapper.py` | **new** — unit tests |
| `frontend/src/types.ts` | add `ApplyResult`, `Section` |
| `frontend/src/api.ts` | add `applyToOriginal` |
| `frontend/src/components/Workbench.tsx` | modals, button logic, tag display |
| `frontend/src/index.css` | modal styles, service-tag styles, tooltip |

---

## Task 1: Backend — `update_work_item` in TestItClient

**Files:**
- Modify: `backend/app/integrations/testit_client.py` (append after `create_work_item`)

- [ ] **Step 1: Add the method**

Append at the end of `TestItClient` class (after line 254, end of `create_work_item`):

```python
    async def update_work_item(self, work_item_id: str, payload: dict) -> dict:
        self._check_config()
        url = f"{self._base_url}/api/v2/workItems/{work_item_id}"
        logger.debug("PUT TestIT update work item id=%s", work_item_id)

        try:
            async with httpx.AsyncClient(
                verify=self._verify_ssl,
                timeout=float(self._timeout),
            ) as client:
                resp = await client.put(
                    url,
                    headers={**self._headers(), "Content-Type": "application/json"},
                    json=payload,
                )
        except httpx.TimeoutException:
            raise TestItConnectionError("Connection to TestIT timed out")
        except httpx.RequestError as exc:
            raise TestItConnectionError(f"Could not connect to TestIT: {type(exc).__name__}")

        if resp.status_code in (401, 403):
            raise TestItAuthError("TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.")
        if resp.status_code == 404:
            raise TestItNotFoundError(f"TestIT work item not found: {work_item_id}")

        try:
            data = resp.json()
        except Exception:
            raise TestItResponseError(
                f"TestIT returned non-JSON response (HTTP {resp.status_code})"
            )

        if not resp.is_success:
            logger.error(
                "TestIT update_work_item failed: HTTP %s, body: %s",
                resp.status_code,
                data,
            )
            msg = (
                data.get("message")
                or data.get("detail")
                or data.get("title")
                or data.get("errorMessage")
                or (str(data.get("errors")) if data.get("errors") else None)
                or f"HTTP {resp.status_code}"
            )
            raise TestItApiError(str(msg), status_code=resp.status_code)

        return data
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/integrations/testit_client.py
git commit -m "feat(backend): add update_work_item to TestItClient"
```

---

## Task 2: Backend — `testit_update_mapper.py`

**Files:**
- Create: `backend/app/parsing/testit_update_mapper.py`
- Create: `backend/tests/test_testit_update_mapper.py`

The mapper takes the **original raw work item** and an **improved testcase dict**, and returns a PUT payload that keeps original metadata (id, projectId, sectionId, entityTypeName, etc.) but overwrites content fields (name, description, steps, tags, priority, state, duration).

Tag rules:
- Drop `source-NNNN` tags (match `^source-\d+$`)
- Drop `needs-review` tag
- Keep `ai-generated`
- Merge with original tags (deduplicate)

Service footer strip rule: split on `\n\n---\n` and take the part before it.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_testit_update_mapper.py
import pytest
from app.parsing.testit_update_mapper import build_update_payload, _strip_service_footer


def test_strip_service_footer_removes_footer():
    desc = "Good description\n\n---\n🤖 Generated by qa-ai-tool\nSource work item: #6110"
    assert _strip_service_footer(desc) == "Good description"


def test_strip_service_footer_no_footer():
    desc = "Plain description"
    assert _strip_service_footer(desc) == "Plain description"


def test_strip_service_footer_empty():
    assert _strip_service_footer("") == ""
    assert _strip_service_footer(None) == ""


def _make_raw(extra_tags=None):
    tags = [{"name": "regression"}, {"name": "source-6110"}, {"name": "needs-review"}]
    if extra_tags:
        tags += [{"name": t} for t in extra_tags]
    return {
        "id": "abc-123",
        "globalId": 42,
        "projectId": "proj-uuid",
        "sectionId": "sec-uuid",
        "entityTypeName": "TestCases",
        "name": "Old title",
        "description": "Old desc",
        "state": "NotReady",
        "priority": "Medium",
        "duration": 60000,
        "steps": [],
        "preconditionSteps": [],
        "postconditionSteps": [],
        "tags": tags,
        "attributes": {},
    }


def _make_improved():
    return {
        "title": "[AI DRAFT] New title",
        "description": "New description\n\n---\n🤖 Generated by qa-ai-tool\nSource work item: #6110\nNeeds QA review",
        "priority": "high",
        "status": "NeedsWork",
        "duration": 90000,
        "steps": [{"action": "Do thing", "expected": "Thing done", "test_data": None, "comments": None}],
        "preconditions": [],
        "postconditions": [],
        "tags": ["ai-generated", "regression"],
    }


def test_build_update_payload_preserves_metadata():
    raw = _make_raw()
    improved = _make_improved()
    payload = build_update_payload(raw, improved, "6110")

    assert payload["id"] == "abc-123"
    assert payload["projectId"] == "proj-uuid"
    assert payload["sectionId"] == "sec-uuid"
    assert payload["entityTypeName"] == "TestCases"


def test_build_update_payload_strips_ai_draft_prefix():
    raw = _make_raw()
    improved = _make_improved()
    payload = build_update_payload(raw, improved, "6110")
    assert payload["name"] == "New title"


def test_build_update_payload_strips_service_footer():
    raw = _make_raw()
    improved = _make_improved()
    payload = build_update_payload(raw, improved, "6110")
    assert "🤖" not in payload["description"]
    assert payload["description"] == "New description"


def test_build_update_payload_tag_cleanup():
    raw = _make_raw(extra_tags=["smoke"])
    improved = _make_improved()
    payload = build_update_payload(raw, improved, "6110")

    tag_names = {t["name"] for t in payload["tags"]}
    assert "source-6110" not in tag_names
    assert "needs-review" not in tag_names
    assert "ai-generated" in tag_names
    assert "regression" in tag_names
    assert "smoke" in tag_names


def test_build_update_payload_maps_steps():
    raw = _make_raw()
    improved = _make_improved()
    payload = build_update_payload(raw, improved, "6110")

    assert len(payload["steps"]) == 1
    assert payload["steps"][0]["action"] == "Do thing"
    assert payload["steps"][0]["expected"] == "Thing done"


def test_build_update_payload_maps_priority():
    raw = _make_raw()
    improved = _make_improved()
    payload = build_update_payload(raw, improved, "6110")
    assert payload["priority"] == "High"


def test_build_update_payload_maps_state():
    raw = _make_raw()
    improved = _make_improved()
    payload = build_update_payload(raw, improved, "6110")
    assert payload["state"] == "NeedsWork"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest tests/test_testit_update_mapper.py -v 2>&1 | head -30
```

Expected: `ImportError` or `ModuleNotFoundError` — file doesn't exist yet.

- [ ] **Step 3: Create the mapper**

```python
# backend/app/parsing/testit_update_mapper.py
from __future__ import annotations

import re

_PRIORITY_MAP = {
    "high": "High",
    "medium": "Medium",
    "low": "Low",
    "critical": "Critical",
}
_VALID_STATES = {"Ready", "NotReady", "NeedsWork"}
_SERVICE_FOOTER_SEP = "\n\n---\n"
_SERVICE_TAGS = re.compile(r"^source-\d+$")
_DROP_TAGS = {"needs-review"}


def _strip_service_footer(desc: str | None) -> str:
    if not desc:
        return ""
    idx = desc.find(_SERVICE_FOOTER_SEP)
    return desc[:idx].strip() if idx != -1 else desc.strip()


def _map_step(step: dict) -> dict:
    return {
        "action": step.get("action") or "",
        "expected": step.get("expected") or "",
        "testData": step.get("test_data") or "",
        "comments": step.get("comments") or "",
    }


def _map_priority(priority: str | None) -> str:
    if not priority:
        return "Medium"
    return _PRIORITY_MAP.get(priority.lower(), "Medium")


def _map_state(status: str | None) -> str:
    if status and status in _VALID_STATES:
        return status
    return "Ready"


def _strip_ai_draft_prefix(title: str) -> str:
    prefix = "[AI DRAFT] "
    return title[len(prefix):] if title.startswith(prefix) else title


def build_update_payload(
    original_raw: dict,
    improved: dict,
    source_work_item_id: str,
) -> dict:
    """Merge improved content onto original raw work item for a PUT update.

    Keeps all original metadata (id, projectId, sectionId, etc.).
    Overwrites content: name, description, steps, tags, priority, state, duration.
    Tag cleanup: drop source-NNNN and needs-review, keep ai-generated, merge with original.
    """
    # Tags: start from original raw tags, apply cleanup rules
    original_tag_names = {t["name"] for t in (original_raw.get("tags") or [])}
    improved_tag_names = set(improved.get("tags") or [])

    merged = (original_tag_names | improved_tag_names)
    cleaned = {
        t for t in merged
        if not _SERVICE_TAGS.match(t) and t not in _DROP_TAGS
    }
    # Always keep ai-generated for traceability
    cleaned.add("ai-generated")

    payload = {
        **original_raw,
        "name": _strip_ai_draft_prefix(improved.get("title") or original_raw.get("name") or ""),
        "description": _strip_service_footer(improved.get("description")),
        "state": _map_state(improved.get("status")),
        "priority": _map_priority(improved.get("priority")),
        "duration": int(improved.get("duration") or original_raw.get("duration") or 60000),
        "steps": [_map_step(s) for s in (improved.get("steps") or [])],
        "preconditionSteps": [_map_step(s) for s in (improved.get("preconditions") or [])],
        "postconditionSteps": [_map_step(s) for s in (improved.get("postconditions") or [])],
        "tags": [{"name": t} for t in sorted(cleaned)],
    }

    return payload
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd backend && python -m pytest tests/test_testit_update_mapper.py -v
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add backend/app/parsing/testit_update_mapper.py backend/tests/test_testit_update_mapper.py
git commit -m "feat(backend): add testit_update_mapper with build_update_payload"
```

---

## Task 3: Backend — schemas, service, route for update-original

**Files:**
- Modify: `backend/app/schemas/testit.py`
- Create: `backend/app/services/testit_update_service.py`
- Modify: `backend/app/api/routes.py`

- [ ] **Step 1: Add schemas to `testit.py`**

Append at end of `backend/app/schemas/testit.py`:

```python
class UpdateOriginalRequest(BaseModel):
    improved_testcase: dict
    source_work_item_id: str
    source_attributes: dict = {}


class UpdateOriginalResponse(BaseModel):
    work_item_id: str
    global_id: int | None = None
    title: str
    testit_url: str | None = None
```

- [ ] **Step 2: Create `testit_update_service.py`**

```python
# backend/app/services/testit_update_service.py
from __future__ import annotations

import logging

from app.core.config import settings
from app.integrations.testit_client import TestItClient, TestItConfigError
from app.parsing.testit_update_mapper import build_update_payload
from app.schemas.testit import UpdateOriginalResponse

logger = logging.getLogger(__name__)


async def apply_to_original_in_testit(
    improved_testcase: dict,
    source_work_item_id: str,
    source_attributes: dict | None = None,
) -> UpdateOriginalResponse:
    if not settings.TESTIT_PROJECT_UUID:
        raise TestItConfigError("TESTIT_PROJECT_UUID is not configured in .env")

    client = TestItClient()

    # Fetch the current original to get full raw metadata for the PUT payload
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
        # Best-effort URL construction — same pattern as draft service
        try:
            from app.services.testit_draft_service import _resolve_project_global_id
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
```

- [ ] **Step 3: Add route to `routes.py`**

Add imports at the top of routes.py (after existing service imports):

```python
from app.services.testit_update_service import apply_to_original_in_testit
from app.schemas.testit import (
    CreateDraftRequest,
    CreateDraftResponse,
    FetchTestItWorkItemRequest,
    FetchTestItWorkItemResponse,
    UpdateOriginalRequest,
    UpdateOriginalResponse,
)
```

Add route at the end of `routes.py`:

```python
@router.post("/testit/workitem/update-original", response_model=UpdateOriginalResponse)
async def update_testit_original(body: UpdateOriginalRequest) -> UpdateOriginalResponse:
    try:
        return await apply_to_original_in_testit(
            improved_testcase=body.improved_testcase,
            source_work_item_id=body.source_work_item_id,
            source_attributes=body.source_attributes,
        )
    except TestItConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except TestItAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except TestItNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except TestItConnectionError as exc:
        raise HTTPException(status_code=503, detail=f"TestIT unavailable: {exc}")
    except TestItResponseError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except TestItApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
```

- [ ] **Step 4: Verify import consistency — run backend**

```bash
cd backend && python -c "from app.api.routes import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/testit.py backend/app/services/testit_update_service.py backend/app/api/routes.py
git commit -m "feat(backend): add update-original route and service"
```

---

## Task 4: Frontend — types and API client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add types to `types.ts`**

Append at end of `frontend/src/types.ts`:

```typescript
export interface ApplyResult {
  work_item_id: string
  global_id?: number
  title: string
  testit_url?: string
}

export interface Section {
  id: string
  name: string
}
```

- [ ] **Step 2: Update `api.ts`**

Add `ApplyResult` to the import line at the top:

```typescript
import type { AnalyzeResult, ApplyResult, DraftResult, FetchResult, ImproveResult, ReviewConfig, ReviewIssue, ReviewRuleId } from './types'
```

Add `applyToOriginal` method to the `api` object (after `createDraft`):

```typescript
  applyToOriginal: (body: {
    improved_testcase: unknown
    source_work_item_id: string
    source_attributes: Record<string, unknown>
  }) => post<ApplyResult>('/testit/workitem/update-original', body),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat(frontend): add ApplyResult type and applyToOriginal API method"
```

---

## Task 5: Frontend — CSS for modals, tooltips, service tags

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Add modal and tag styles**

Find the `/* Rail */` comment block (around line 916) and insert the new styles **before** it:

```css
/* Action modals (section picker + confirm apply) */
.action-modal-overlay {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(15,17,23,0.5);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}
.action-modal {
  background: var(--bg-panel); border-radius: var(--r-lg);
  width: 400px;
  box-shadow: 0 24px 64px rgba(15,17,23,0.25), 0 4px 16px rgba(15,17,23,0.1);
  overflow: hidden;
}
.action-modal-header {
  display: flex; align-items: center; gap: 10px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border);
}
.action-modal-icon { color: var(--tx-muted); display: flex; }
.action-modal-icon-warn { color: #D97706; }
.action-modal-title { font-size: 15px; font-weight: 500; color: var(--tx-primary); }
.action-modal-body {
  padding: 16px 20px;
  font-size: 13px; color: var(--tx-secondary); line-height: 1.55;
}
.action-modal-warn-text { color: var(--tx-muted); font-size: 12px; margin-top: 6px; }
.action-modal-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border);
}
.action-modal-label {
  font-size: 12px; font-weight: 500; color: var(--tx-secondary);
  display: block; margin-bottom: 6px;
}
.action-modal-select {
  width: 100%; height: 34px; border: 1px solid var(--border);
  border-radius: var(--r-sm); background: var(--bg-surface);
  padding: 0 10px; font-family: var(--font); font-size: 13px;
  color: var(--tx-primary); outline: none;
  transition: border-color .14s, box-shadow .14s;
}
.action-modal-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(124,58,237,0.1); }
/* Confirm/replace button — warning red */
.wb-btn-danger {
  height: 30px; padding: 0 14px; border-radius: var(--r-sm);
  background: #D92D20; color: #fff; font-family: var(--font);
  font-size: 12px; font-weight: 500; border: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: opacity .14s;
}
.wb-btn-danger:hover { opacity: 0.88; }

/* "Применить к оригиналу" button — accent primary */
.wb-btn-apply {
  height: 30px; padding: 0 14px; border-radius: var(--r-sm);
  background: var(--accent); color: #fff; font-family: var(--font);
  font-size: 12px; font-weight: 500; border: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: opacity .14s;
}
.wb-btn-apply:hover:not(:disabled) { opacity: 0.88; }
.wb-btn-apply:disabled { opacity: 0.4; cursor: not-allowed; }

/* Disabled button tooltip wrapper */
.wb-btn-wrap { position: relative; display: inline-flex; }
.wb-btn-tip {
  position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
  background: var(--tx-primary); color: #fff; border-radius: var(--r-sm);
  padding: 5px 8px; font-size: 11px; line-height: 15px; white-space: nowrap;
  pointer-events: none; opacity: 0; transition: opacity .15s;
  z-index: 100;
}
.wb-btn-wrap:hover .wb-btn-tip { opacity: 1; }

/* Service tags group */
.tag-service-group { margin-top: 6px; }
.tag-service-label {
  font-size: 10px; font-weight: 500; color: var(--tx-dim);
  text-transform: uppercase; letter-spacing: 0.06em;
  display: block; margin-bottom: 4px;
}
.tag-chip-service {
  display: inline-flex; align-items: center;
  padding: 3px 8px; border-radius: 999px; font-size: 11px;
  background: var(--bg-surface); color: var(--tx-dim);
  border: 1px solid var(--border);
}

/* Source ID badge */
.source-id-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--tx-muted); margin-bottom: 6px;
}
.source-id-badge a { color: var(--accent); text-decoration: none; }
.source-id-badge a:hover { text-decoration: underline; }

/* Apply result card (in rail, mirrors draft-card) */
.apply-card {
  background: rgba(124,58,237,0.06); border: 1px solid var(--accent-border);
  border-radius: var(--r-md); padding: 10px 12px; margin-top: 8px;
}
.apply-card-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 500; color: var(--accent); margin-bottom: 4px;
}
.apply-card-name { font-size: 13px; color: var(--tx-primary); font-weight: 500; line-height: 1.4; }
.apply-card-meta { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.apply-link { font-size: 11px; color: var(--accent); text-decoration: none; }
.apply-link:hover { text-decoration: underline; }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(frontend): add action modal, service tag, and apply card CSS"
```

---

## Task 6: Frontend — TestCaseView tag refactor

**Files:**
- Modify: `frontend/src/components/Workbench.tsx`

Context: `TestCaseView` is at line ~197. The `WARN_TAGS` constant is at line ~178. The tags section was previously updated to always show (show "не указано" when empty).

- [ ] **Step 1: Add service tag constants near top of file**

After `const WARN_TAGS = new Set(...)` (around line 179), add:

```typescript
const SERVICE_TAGS = new Set(['ai-generated', 'needs-review'])
const SOURCE_TAG_RE = /^source-(\d+)$/
```

- [ ] **Step 2: Refactor the tags section in `TestCaseView`**

Find the Tags section block (starts with `{/* Tags as chips */}`, around line 271). Replace the entire block:

```tsx
      {/* Tags — always show; filter source-NNNN; separate service tags */}
      {(() => {
        const allTags = tc.tags ?? []
        const sourceMatch = allTags.map(t => t.match(SOURCE_TAG_RE)).find(Boolean)
        const sourceId = sourceMatch?.[1]
        const withoutSource = allTags.filter(t => !SOURCE_TAG_RE.test(t))
        const regularTags = withoutSource.filter(t => !SERVICE_TAGS.has(t))
        const serviceTags = withoutSource.filter(t => SERVICE_TAGS.has(t))
        const hasAny = regularTags.length > 0 || serviceTags.length > 0

        return (
          <div>
            <span className="case-sec-label">Теги</span>
            {sourceId && (
              <div className="source-id-badge">
                Исходный кейс:
                <a
                  href={settings?.TESTIT_BASE_URL ? `${settings.TESTIT_BASE_URL}/workItems/${sourceId}` : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  #{sourceId}
                </a>
              </div>
            )}
            {hasAny ? (
              <>
                {regularTags.length > 0 && (
                  <div className="tag-chips">
                    {regularTags.map(tag => (
                      <span key={tag} className={`tag-chip${WARN_TAGS.has(tag) ? ' tag-chip-warn' : ''}`}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {serviceTags.length > 0 && (
                  <div className="tag-service-group">
                    <span className="tag-service-label">Служебные</span>
                    <div className="tag-chips">
                      {serviceTags.map(tag => (
                        <span key={tag} className="tag-chip-service">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="case-text-box case-text-empty">не указано</div>
            )}
          </div>
        )
      })()}
```

Note: the "Исходный кейс" link uses `#` as fallback href since `settings` (backend config) isn't available in frontend. This is fine — the link is informational. If TestIT URL is known, it can be constructed from `fetchResult.raw_work_item` attributes instead.

Actually, simplify the href — just use `#` since we don't have the base URL in frontend:

```tsx
                  href="#"
```

But wait — we DO have `fetchResult.work_item_id` in `Workbench`, but TestCaseView doesn't receive it. The `sourceId` is extracted from the tag. We don't need a URL to the original from inside TestCaseView. Just show `#sourceId` as a text badge (no link, or link to `#`).

Use this simpler version for the source badge:

```tsx
            {sourceId && (
              <div className="source-id-badge">
                Исходный кейс: <span style={{ color: 'var(--accent)' }}>#{sourceId}</span>
              </div>
            )}
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (the `settings` reference was removed in the simplified version above).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Workbench.tsx
git commit -m "feat(frontend): filter source tags, split service tags in TestCaseView"
```

---

## Task 7: Frontend — SectionPickerModal and ConfirmApplyModal

**Files:**
- Modify: `frontend/src/components/Workbench.tsx`

Add two inline components before the `Workbench` export function (after `RailLoading`, around line 576).

- [ ] **Step 1: Add the mock sections constant**

Before `export function Workbench(...)`:

```typescript
// TODO: fetch from GET /testit/sections once backend endpoint is added
const MOCK_SECTIONS = [
  { id: 'ai-review-drafts', name: 'AI Review / Drafts' },
  { id: 'drafts', name: 'Черновики' },
  { id: 'ai-workspace', name: 'AI Workspace' },
]
```

- [ ] **Step 2: Add `SectionPickerModal` component**

```tsx
function SectionPickerModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (sectionName: string) => void
  onCancel: () => void
}) {
  const [selectedId, setSelectedId] = useState(MOCK_SECTIONS[0].id)

  return (
    <div className="action-modal-overlay" onClick={onCancel}>
      <div className="action-modal" onClick={e => e.stopPropagation()}>
        <div className="action-modal-header">
          <span className="action-modal-icon"><FolderOpen size={16} strokeWidth={1.75} /></span>
          <span className="action-modal-title">Создать черновик</span>
        </div>
        <div className="action-modal-body">
          <label className="action-modal-label">Сохранить в</label>
          <select
            className="action-modal-select"
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
          >
            {MOCK_SECTIONS.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="action-modal-footer">
          <button type="button" className="wb-btn wb-btn-sec" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            className="wb-btn wb-btn-pri"
            onClick={() => {
              const section = MOCK_SECTIONS.find(s => s.id === selectedId)
              onConfirm(section?.name ?? MOCK_SECTIONS[0].name)
            }}
          >
            <CheckCircle2 size={13} />
            Создать
          </button>
        </div>
      </div>
    </div>
  )
}
```

Note: `FolderOpen` needs to be imported from `lucide-react`.

- [ ] **Step 3: Add `ConfirmApplyModal` component**

```tsx
function ConfirmApplyModal({
  workItemId,
  onConfirm,
  onCancel,
}: {
  workItemId: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="action-modal-overlay" onClick={onCancel}>
      <div className="action-modal" onClick={e => e.stopPropagation()}>
        <div className="action-modal-header">
          <span className="action-modal-icon action-modal-icon-warn">
            <AlertTriangle size={16} strokeWidth={1.75} />
          </span>
          <span className="action-modal-title">Заменить оригинал #{workItemId}?</span>
        </div>
        <div className="action-modal-body">
          Улучшенная версия заменит исходный тест-кейс.
          <div className="action-modal-warn-text">Действие необратимо.</div>
        </div>
        <div className="action-modal-footer">
          <button type="button" className="wb-btn wb-btn-sec" onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className="wb-btn-danger" onClick={onConfirm}>
            <AlertTriangle size={13} />
            Заменить
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add `FolderOpen` to lucide-react import**

Find the lucide-react import at the top of `Workbench.tsx` and add `FolderOpen`:

```typescript
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ExternalLink, FolderOpen, Link2, Paperclip, RotateCcw, Sparkles, Wand2, Wrench } from 'lucide-react'
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Workbench.tsx
git commit -m "feat(frontend): add SectionPickerModal and ConfirmApplyModal components"
```

---

## Task 8: Frontend — Workbench state, computed values, button logic

**Files:**
- Modify: `frontend/src/components/Workbench.tsx`

This task replaces the `wb-actions` button area (lines ~854–922) with the new two-button logic, adds state for modals and apply action, and adds computed availability values.

- [ ] **Step 1: Add new state after `draftLoading` state (line ~585)**

```typescript
  const [draftSectionName, setDraftSectionName] = useState<string>(MOCK_SECTIONS[0].name)
  const [showSectionPicker, setShowSectionPicker] = useState(false)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [showConfirmApply, setShowConfirmApply] = useState(false)
```

Also add the `ApplyResult` import to the types import line at the top of the file:

```typescript
import type { AnalyzeResult, ApplyResult, DraftResult, FetchResult, ImproveResult, IssueResolution, ReviewIssue } from '../types'
```

- [ ] **Step 2: Add `runApplyToOriginal` function**

After `runCreateDraft` function (around line 678), add:

```typescript
  async function runApplyToOriginal() {
    if (!improveResult) return
    setApplyLoading(true)
    setApplyError(null)
    setApplyResult(null)
    try {
      const result = await api.applyToOriginal({
        improved_testcase: improveResult.improved_testcase,
        source_work_item_id: fetchResult.work_item_id,
        source_attributes: fetchResult.raw_work_item,
      })
      setApplyResult(result)
    } catch (err) {
      setApplyError((err as Error).message)
    } finally {
      setApplyLoading(false)
      setShowConfirmApply(false)
    }
  }
```

- [ ] **Step 3: Add computed availability values**

After the existing `const manualCount = ...` line (around line 702), add:

```typescript
  // Computed: open critical issues (high severity without resolved resolution)
  const openCriticalCount = analyzeResult?.issues.filter(i =>
    i.severity === 'high' &&
    !improveResult?.issue_resolutions?.some(
      r => r.issue_title === i.title && r.status === 'resolved'
    )
  ).length ?? 0

  // Button availability
  const canDraft = (improveStatus === 'success' || improveStatus === 'partial') && !applyResult
  const canApply = improveStatus === 'success' && openCriticalCount === 0 && manualCount === 0 && !applyResult
  const applyBlockReason = improveStatus === 'partial'
    ? 'Кейс требует доработки'
    : (openCriticalCount > 0 || manualCount > 0)
      ? 'Сначала закройте критичные замечания'
      : null

  const hasApply = !!applyResult
```

- [ ] **Step 4: Replace `wb-actions` block**

Find and replace the entire `<div className="wb-actions">` block (lines ~854–922) with:

```tsx
        <div className="wb-actions">
          {/* Initial loading — no prior result yet */}
          {analyzeLoading && !analyzeResult && (
            <button type="button" className="wb-btn wb-btn-sec" disabled>
              <span className="spinner" style={{ display: 'inline-flex' }}><Sparkles size={13} /></span>
              Анализирую...
            </button>
          )}
          {/* Re-run analyze */}
          {analyzeResult && (
            <button
              type="button" className="wb-btn wb-btn-sec"
              onClick={runAnalyze}
              disabled={analyzeLoading || improveLoading}
            >
              <RotateCcw size={13} />
              Повторить ревью
            </button>
          )}
          {/* Improve / retry */}
          {analyzeResult && (
            improveLoading ? (
              <button type="button" className="wb-btn wb-btn-sec" disabled>
                <span className="spinner" style={{ display: 'inline-flex' }}><Wand2 size={13} /></span>
                Улучшаю...
              </button>
            ) : improveStatus === 'error' ? (
              <button type="button" className="wb-btn wb-btn-pri" onClick={runImprove}>
                <RotateCcw size={13} />
                Повторить
              </button>
            ) : hasImprove ? (
              <button type="button" className="wb-btn wb-btn-sec" onClick={runImprove}
                disabled={improveLoading || analyzeLoading}>
                <Wand2 size={13} />
                Улучшить ещё
              </button>
            ) : (
              <button type="button" className="wb-btn wb-btn-pri" onClick={runImprove}>
                <Wand2 size={13} />
                Улучшить
              </button>
            )
          )}
          {/* Draft */}
          {improvedTabAccessible && improveStatus !== 'error' && (
            hasDraft ? (
              <button type="button" className="wb-btn wb-btn-done" disabled>
                <CheckCircle2 size={13} />
                Черновик создан
              </button>
            ) : draftLoading ? (
              <button type="button" className="wb-btn wb-btn-sec" disabled>
                <span className="spinner" style={{ display: 'inline-flex' }}><CheckCircle2 size={13} /></span>
                Создаю...
              </button>
            ) : canDraft ? (
              <button
                type="button"
                className={`wb-btn ${improveStatus === 'partial' ? 'wb-btn-sec-warn' : 'wb-btn-sec'}`}
                title={improveStatus === 'partial' ? 'Кейс улучшен частично — рекомендуется доработка' : undefined}
                onClick={() => setShowSectionPicker(true)}
              >
                <CheckCircle2 size={13} />
                Создать черновик
              </button>
            ) : null
          )}
          {/* Apply to original */}
          {improvedTabAccessible && improveStatus !== 'error' && (
            hasApply ? (
              <button type="button" className="wb-btn wb-btn-done" disabled>
                <CheckCircle2 size={13} />
                Применено
              </button>
            ) : applyLoading ? (
              <button type="button" className="wb-btn-apply" disabled>
                <span className="spinner" style={{ display: 'inline-flex' }}><Wand2 size={13} /></span>
                Применяю...
              </button>
            ) : (
              <div className="wb-btn-wrap">
                <button
                  type="button"
                  className="wb-btn-apply"
                  disabled={!canApply}
                  onClick={() => canApply && setShowConfirmApply(true)}
                >
                  <CheckCircle2 size={13} />
                  Применить к оригиналу
                </button>
                {!canApply && applyBlockReason && (
                  <span className="wb-btn-tip">{applyBlockReason}</span>
                )}
              </div>
            )
          )}
        </div>
```

- [ ] **Step 5: Add modals and errors below the header card**

After the closing `</div>` of `wb-card` (around line 923), before `{/* Workbench grid */}`:

```tsx
      {/* Section picker modal */}
      {showSectionPicker && (
        <SectionPickerModal
          onConfirm={(sectionName) => {
            setDraftSectionName(sectionName)
            setShowSectionPicker(false)
            runCreateDraft()
          }}
          onCancel={() => setShowSectionPicker(false)}
        />
      )}

      {/* Confirm apply modal */}
      {showConfirmApply && (
        <ConfirmApplyModal
          workItemId={fetchResult.work_item_id}
          onConfirm={runApplyToOriginal}
          onCancel={() => setShowConfirmApply(false)}
        />
      )}

      {/* Apply error */}
      {applyError && (
        <div className="alert alert-error" style={{ margin: '0 0 8px' }}>
          <span className="alert-text">Ошибка применения: {applyError}</span>
        </div>
      )}
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Workbench.tsx
git commit -m "feat(frontend): two-button action logic with section picker and confirm apply modals"
```

---

## Task 9: Frontend — apply result card in rail

**Files:**
- Modify: `frontend/src/components/Workbench.tsx`

After the existing `{hasDraft && (...)}` block (around line 1102), add apply result card:

- [ ] **Step 1: Add apply result card**

Find:
```tsx
                {/* Draft card */}
                {hasDraft && (
```

After the closing `)}` of the draft card block (around line 1123), add:

```tsx
                {/* Apply card */}
                {hasApply && (
                  <div className="apply-card">
                    <div className="apply-card-label">
                      <CheckCircle2 size={13} />
                      Применено к оригиналу
                    </div>
                    <div className="apply-card-name">#{fetchResult.work_item_id} — {applyResult!.title}</div>
                    <div className="apply-card-meta">
                      {applyResult!.testit_url && (
                        <a
                          className="apply-link"
                          href={applyResult!.testit_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Открыть в TestIT →
                        </a>
                      )}
                    </div>
                  </div>
                )}
```

- [ ] **Step 2: Final TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Workbench.tsx
git commit -m "feat(frontend): add apply result card in AI Review rail"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| "Создать черновик" — logic fixed | Task 8 |
| "Создать черновик" — available on success + partial | Task 8 (canDraft) |
| "Создать черновик" — blocked on error | Task 8 |
| "Применить к оригиналу" — new button | Task 8 |
| "Применить к оригиналу" — only on success + no blockers | Task 8 (canApply) |
| "Применить к оригиналу" — disabled + tooltip on blockers | Task 8 (.wb-btn-tip) |
| "Применить к оригиналу" — confirmation modal | Tasks 7, 8 |
| Section selector before draft | Tasks 7, 8 |
| Mock sections with TODO | Task 7 |
| source-NNNN tag filtered from display | Task 6 |
| "Исходный кейс" badge from source tag | Task 6 |
| needs-review removed on apply | Task 2 (build_update_payload) |
| ai-generated kept | Task 2 |
| Service tags visually separated | Tasks 5, 6 |
| Backend update_work_item | Task 1 |
| Backend apply-to-original route | Task 3 |
| Design system preserved | Tasks 5 (CSS vars) |

**No placeholders:** all code blocks are complete. ✓

**Type consistency:** `ApplyResult` defined in Task 4 types.ts, used in Task 8 state. `MOCK_SECTIONS` constant defined in Task 7 step 1, used in modal step 2. `canDraft`/`canApply`/`applyBlockReason` defined in Task 8 step 3, used in step 4. ✓
