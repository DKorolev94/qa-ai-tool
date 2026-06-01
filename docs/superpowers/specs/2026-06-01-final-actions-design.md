# Screen 3 — Final Actions Design

**Date:** 2026-06-01  
**Scope:** Workbench (Screen 3) — save/apply logic. Layout untouched.

---

## Goals

- Two independent action buttons: "Создать черновик" and "Применить к оригиналу"
- Human in the loop: AI never auto-overwrites the original
- Section selector before draft creation (mock list, stub for real API)
- Confirmation modal before overwriting original
- Tag cleanup: `source-NNNN` removed from display, service tags visually separated

---

## Button States

### Computed values

| Variable | Formula |
|---|---|
| `openCritical` | high-severity issues with no `resolved` resolution |
| `openManual` | resolutions with status `manual_needed` |
| `hasBlockingIssues` | `openCritical > 0 \|\| openManual > 0` |
| `canDraft` | `improveStatus === 'success' \|\| improveStatus === 'partial'` |
| `canApply` | `improveStatus === 'success' && !hasBlockingIssues` |
| `applyBlockReason` | `'Кейс требует доработки'` or `'Сначала закройте критичные замечания'` |

### State matrix

| Status | Черновик | Применить |
|---|---|---|
| success, no blockers | active | active |
| success, blockers | active | disabled + tooltip |
| partial | active | disabled + tooltip |
| error | disabled | disabled (show Повторить) |

### Independence

The two actions are independent. Creating a draft does not block "Применить к оригиналу" and vice versa. Each button transitions to a done-state individually. "Улучшить ещё" resets both.

---

## Section Picker Modal

Shown on "Создать черновик" click.

```
┌─────────────────────────────┐
│ Создать черновик             │
│                             │
│ Сохранить в                 │
│ [AI Review / Drafts     ▾]  │
│                             │
│      [Отмена]  [Создать]    │
└─────────────────────────────┘
```

- Mock sections list with `// TODO: fetch from GET /testit/sections` comment
- Default: `AI Review / Drafts`
- `selectedSectionId` passed to `createDraft` API call

---

## Confirm Apply Modal

Shown on "Применить к оригиналу" click.

```
┌────────────────────────────────────┐
│ ⚠  Заменить оригинал #6110?        │
│                                    │
│ Улучшенная версия заменит          │
│ исходный тест-кейс.                │
│ Действие необратимо.               │
│                                    │
│         [Отмена]  [Заменить]       │
└────────────────────────────────────┘
```

- "Заменить" — warning-accent color (not default accent)
- "Отмена" — secondary

---

## Tag Filtering (TestCaseView)

```
allTags = tc.tags ?? []
sourceTag = find t matching /^source-\d+$/
sourceId  = sourceTag?.replace('source-', '')
filteredTags = allTags excluding source-NNNN
regularTags  = filteredTags excluding SERVICE_TAGS
serviceTags  = filteredTags ∩ SERVICE_TAGS  (ai-generated, needs-review)
```

### Display

- `sourceId` → badge "Исходный кейс: #NNNN" above tags section
- `regularTags` → normal chips (existing style)
- `serviceTags` → separate sub-group with muted/system style, label "Служебные"
- Empty state: "не указано" (existing behavior)

---

## Backend: Применить к оригиналу

### New: `TestItClient.update_work_item(work_item_id, payload)`

`PUT /api/v2/workItems/{id}` with full payload.

### New service: `apply_to_original_in_testit`

1. Fetch raw original work item
2. Build update payload:
   - content from `improved_testcase` (title without `[AI DRAFT]`, description stripped of service footer)
   - metadata from original (projectId, sectionId, attributes, etc.)
   - tags: original tags + `ai-generated`, minus `needs-review`, minus `source-NNNN`
   - state, priority from improved
3. `PUT` to TestIT

### New schemas

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

### New route

`POST /testit/workitem/update-original`

---

## Files Changed

### Frontend
- `frontend/src/components/Workbench.tsx` — button logic, modals, tag display
- `frontend/src/index.css` — modal styles, service tag styles, tooltip styles
- `frontend/src/api.ts` — add `applyToOriginal()`, update `createDraft()` signature
- `frontend/src/types.ts` — add `ApplyResult`, `Section`

### Backend
- `backend/app/integrations/testit_client.py` — add `update_work_item`
- `backend/app/services/testit_workitem_service.py` — add `apply_to_original_in_testit`
- `backend/app/schemas/testit.py` — add `UpdateOriginalRequest`, `UpdateOriginalResponse`
- `backend/app/api/routes.py` — add `POST /testit/workitem/update-original`

---

## Design Constraints

- Design system: rounded corners 6/10/14, outline icons, accent `#7C3AED`
- "Применить к оригиналу" primary button: `#7C3AED`
- "Заменить" in confirm modal: warning accent `#D97706` or red `#D92D20`
- Right rail and tabs: untouched
