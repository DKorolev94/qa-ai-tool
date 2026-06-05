# Browser Runner Tool — Design Spec

Date: 2026-06-05  
Status: Approved

## Goal

Add a standalone "Browser Runner" tool to qa-ai-tool. User enters a TestIT test case ID → backend fetches and formats it → sends to browser-use runner → UI shows result (passed / failed / blocked) + screenshot gallery.

The runner code moves from `browser-use-qa` into this repo as `runner/` — a separate service with its own dependencies. Runner supports multiple LLM providers: DeepSeek, OpenAI, Claude, Ollama.

---

## Repository Structure

```
qa-ai-tool/
  backend/          ← existing FastAPI :8000 (unchanged deps)
  runner/           ← browser-use runner :8008 (own pyproject.toml, own venv)
    main.py
    views.py
    llm_factory.py  ← NEW: provider-agnostic LLM factory
    .env.example
    start.sh
    pyproject.toml
  frontend/         ← existing Vite/React
```

Runner is a separate process. `backend/` calls it via HTTP (`RUNNER_URL`). When runner moves to a remote machine — only `RUNNER_URL` in `backend/.env` changes.

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
      - steps_count + duration
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
  3. httpx.AsyncClient.post(RUNNER_URL + "/run", timeout=180s)
        ↓
runner/ service (:8008)
  → llm_factory creates LLM by provider
  → browser-use Agent runs test
  → returns RunResponse
        ↓
qa-ai-tool backend
  → maps screenshots to /api/runner/screenshot?path=...
  → returns RunnerRunResponse to frontend

GET /api/runner/screenshot?path=<abs_path>
  → backend reads file from shared FS → returns image/*
```

---

## Runner Changes

### New file: `runner/llm_factory.py`

Creates LLM client for browser-use based on `LLM_PROVIDER` env var.

```python
# LLM_PROVIDER=deepseek  → browser_use.llm.ChatDeepSeek (existing)
# LLM_PROVIDER=openai    → langchain_openai.ChatOpenAI
# LLM_PROVIDER=claude    → langchain_anthropic.ChatAnthropic
# LLM_PROVIDER=ollama    → langchain_ollama.ChatOllama
```

### `runner/.env.example` additions

```
LLM_PROVIDER=deepseek          # deepseek | openai | claude | ollama

# DeepSeek
DEEPSEEK_API_KEY=

# OpenAI
OPENAI_API_KEY=
# OPENAI_BASE_URL=             # optional: custom endpoint

# Claude
ANTHROPIC_API_KEY=

# Ollama (local, no key needed)
OLLAMA_BASE_URL=http://localhost:11434

RUNNER_LLM_MODEL=deepseek-chat # model name for selected provider
```

### `runner/main.py`

Replace hardcoded `DeepSeekWithUsage(...)` with `llm_factory.create_llm()`.

### `runner/pyproject.toml`

Add optional deps:
```toml
[project.optional-dependencies]
openai   = ["langchain-openai"]
claude   = ["langchain-anthropic"]
ollama   = ["langchain-ollama"]
all      = ["langchain-openai", "langchain-anthropic", "langchain-ollama"]
```

Core deps include `browser-use`, `fastapi`, `uvicorn`, `httpx`, `python-dotenv`.

---

## Backend Changes (qa-ai-tool/backend/)

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

### New file: `app/services/runner_service.py`

- Builds task prompt from `TestCase` (see Prompt Format below)
- Extracts `start_url` from preconditions/steps (first `http(s)://` URL)
- Calls runner via httpx, maps response to `RunnerRunResponse`
- Maps `screenshot_paths` from RunResponse to `RunnerScreenshot` list with URLs

### Config: `app/core/config.py`

```python
RUNNER_URL: str = "http://localhost:8008"
RUNNER_TIMEOUT_SEC: int = 180
RUNNER_RUNS_DIR: str = ""  # abs path to runner/runs/ on local FS; empty = screenshots disabled
```

### New routes in `app/api/routes.py`

```
POST /api/runner/run
  body: RunnerStartRequest { work_item_id }
  → runner_service.run_test_case(work_item_id)
  → RunnerRunResponse

GET /api/runner/screenshot?path=<abs_path>
  → validates path starts with RUNNER_RUNS_DIR (path traversal guard)
  → FileResponse with image content-type
```

---

## Frontend Changes

### New component: `src/components/RunnerView.tsx`

States: idle → loading → result

```
[idle]
  ┌──────────────────────────────┐
  │ TestIT ID: [_______] [Run]  │
  └──────────────────────────────┘

[loading]
  spinner  "Агент работает... 1:23"

[result]
  ┌─────────────────────────────────┐
  │  ● PASSED                       │  ← green / red / yellow badge
  │  "Все шаги выполнены успешно"   │
  │  12 шагов · 1м 47с              │
  └─────────────────────────────────┘
  [errors block — only if errors.length > 0]
  ┌─────────────────────────────────┐
  │  Скриншоты (6)                  │
  │  [img][img][img][img][img][img]  │  thumbnails
  └─────────────────────────────────┘
  [click thumbnail → full-size overlay modal]
```

### Sidebar: `src/components/Sidebar.tsx`

New nav item: lucide icon `MonitorPlay`, label "Browser Runner".

### App.tsx

Add `tool: 'review' | 'runner'` state. Render `RunnerView` when `tool === 'runner'`.

### `src/api.ts`

```typescript
runTestCase: (work_item_id: string) =>
  post<RunnerRunResponse>('/runner/run', { work_item_id }),
```

### `src/types.ts`

```typescript
export type RunnerStatus = 'passed' | 'failed' | 'blocked'
export interface RunnerScreenshot { path: string; url: string }
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
{preconditions_text or "None"}

Steps:
1. {action}
   Expected result: {expected or "—"}
2. ...

Report: passed / failed / blocked, with a short summary of what you observed.
```

`start_url` — first `https?://` match scanning preconditions then step actions.  
If none found → `start_url=None` (runner infers from task text).

---

## Security

- `GET /api/runner/screenshot?path=` rejects any path not starting with `RUNNER_RUNS_DIR`. Returns 403 if outside.
- `RUNNER_URL` is backend-only config, never sent to frontend.

---

## Out of Scope (Phase 2+)

- Live browser stream during run (CDP screenshot polling)
- Cancel running test
- Run history / list of past runs
- Remote runner authentication
