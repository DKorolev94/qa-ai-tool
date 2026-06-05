# Browser Runner Tool — Design Spec

Date: 2026-06-05  
Status: Approved

## Goal

Add a standalone "Browser Runner" tool to qa-ai-tool that lets a user enter a TestIT test case ID, automatically fetches and formats it, sends it to the browser-use runner, and displays the result (passed / failed / blocked) with a screenshot gallery.

The browser-use runner (`browser-use-qa`) remains an independent service. qa-ai-tool is one of its clients — alongside n8n. When the runner moves to a remote machine, only `RUNNER_URL` in `.env` changes.

---

## User Flow

```
Sidebar → "Browser Runner" tab
  → Enter TestIT ID → "Запустить" button
  → backend: fetch TestIT → build prompt → POST {RUNNER_URL}/run
  → UI: spinner + elapsed timer (e.g. "1:23...")
  → UI: result card
      - status badge: PASSED / FAILED / BLOCKED
      - summary text
      - steps_count
      - errors list (if any)
      - screenshot gallery (thumbnails → click for full size)
```

---

## Architecture

```
Frontend (RunnerView.tsx)
  POST /api/runner/run  { work_item_id }
        ↓
qa-ai-tool backend (runner_service.py)
  1. fetch_and_normalize_work_item(work_item_id)   ← reuse existing
  2. build_runner_request(testcase) → RunRequest
  3. httpx.post(RUNNER_URL + "/run", json=..., timeout=180)
        ↓
browser-use runner (:8008)
  → browser agent runs test → returns RunResponse
        ↓
qa-ai-tool backend
  → returns RunnerRunResponse to frontend

GET /api/runner/screenshot?path=<abs_path>
  → backend reads file from FS → returns image/*
  (runner and qa-ai-tool share local filesystem when running on same host)
```

---

## Backend Changes

### New file: `app/services/runner_service.py`

Responsibility: build `RunRequest` from a normalized `TestCase`.

- Formats preconditions as "Before starting:" block
- Formats steps as numbered list: `N. {action}\n   Expected: {expected}`
- Extracts first `http(s)://` URL from preconditions or steps as `start_url`
- Wraps everything in a QA-agent system prompt
- Calls `httpx.AsyncClient.post(RUNNER_URL/run, ...)` with `timeout=180`

### New file: `app/schemas/runner.py`

```python
class RunnerStartRequest(BaseModel):
    work_item_id: str

class RunnerScreenshot(BaseModel):
    path: str
    url: str  # /api/runner/screenshot?path=...

class RunnerRunResponse(BaseModel):
    status: Literal["passed", "failed", "blocked"]
    summary: str
    steps_count: int
    errors: list[str]
    screenshots: list[RunnerScreenshot]
    duration_sec: float
    run_id: str | None
```

### Config: `app/core/config.py`

Add `RUNNER_URL: str = "http://localhost:8008"` — read from `.env`.  
Add `RUNNER_TIMEOUT_SEC: int = 180`.  
Add `RUNNER_RUNS_DIR: str = ""` — absolute path to runner's `runs/` dir on local FS (empty = screenshot serving disabled).

### New routes in `app/api/routes.py`

```
POST /api/runner/run
  body: RunnerStartRequest
  → runner_service.run_test_case(work_item_id)
  → RunnerRunResponse

GET /api/runner/screenshot
  query: path (absolute path on FS)
  → FileResponse / StreamingResponse with image content-type
  Security: validate path starts with runner runs dir (no path traversal)
```

---

## Frontend Changes

### New component: `src/components/RunnerView.tsx`

States:
- **idle**: input field + "Запустить" button
- **loading**: spinner + `useEffect` timer updating every second, elapsed display `"1:23..."`
- **result**: result card

Result card layout:
```
┌─────────────────────────────────┐
│  ● PASSED                       │  ← colored badge
│  "Все шаги выполнены успешно"   │  ← summary
│  12 шагов · 1м 47с              │  ← steps + duration
└─────────────────────────────────┘
│  Скриншоты (6)                  │
│  [img][img][img][img][img][img]  │  ← thumbnails
└─────────────────────────────────┘
```

Errors block shown only when `errors.length > 0`.

Screenshot modal: click thumbnail → overlay with full-size image.

### Sidebar: `src/components/Sidebar.tsx`

Add new nav item: icon `Play` (lucide), label "Browser Runner".  
App-level routing: `tool: 'review' | 'runner'` state in `App.tsx`.

### API: `src/api.ts`

```typescript
runTestCase: (work_item_id: string) =>
  post<RunnerRunResponse>('/runner/run', { work_item_id }),
```

Screenshot URLs: returned by backend as `/api/runner/screenshot?path=...` — fetched directly as `<img src="...">`.

### Types: `src/types.ts`

```typescript
export type RunnerStatus = 'passed' | 'failed' | 'blocked'

export interface RunnerScreenshot {
  path: string
  url: string
}

export interface RunnerRunResponse {
  status: RunnerStatus
  summary: string
  steps_count: number
  errors: string[]
  screenshots: RunnerScreenshot[]
  duration_sec: number
  run_id: string | null
}
```

---

## Prompt Format (runner_service.py)

```
You are a QA engineer executing a manual test case in a web browser.
Follow each step exactly. After completing all steps, report whether
the test passed, failed, or is blocked (cannot proceed due to missing
precondition or environment issue).

Test case: {title}

Preconditions:
{preconditions or "None"}

Steps:
1. {action}
   Expected result: {expected or "—"}
2. ...

Report: passed / failed / blocked, with a short summary of what you observed.
```

`start_url` — first `https?://` match in preconditions text or step actions.  
If no URL found → `start_url=None` (runner will infer from task text).

---

## Security

- `GET /api/runner/screenshot?path=` validates path starts with `{RUNNER_RUNS_DIR}` (configurable, e.g. `/home/dmitriy/projects/browser-use-qa/runner/runs`). Reject anything outside.
- Runner URL is backend-only config — not exposed to frontend.

---

## Out of Scope (Phase 2+)

- Live browser stream during run (CDP screenshots polling)
- Cancel running test
- Run history / list of past runs
- Multi-step progress updates (runner currently has no streaming endpoint)
- Remote runner authentication
