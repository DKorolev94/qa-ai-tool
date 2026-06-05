# Browser Runner Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Browser Runner" tab to qa-ai-tool — user enters a TestIT ID, the app fetches the test case, sends it to the browser-use runner, and shows passed/failed/blocked with screenshots.

**Architecture:** runner/ lives in this repo as a separate process (:8008) with its own venv; backend/ (:8000) calls it via HTTP using RUNNER_URL from .env; frontend adds RunnerView and a sidebar nav item. Runner gains a multi-provider LLM factory (DeepSeek/OpenAI/Claude/Ollama).

**Tech Stack:** Python 3.11, FastAPI, httpx, browser-use, langchain-openai/anthropic/ollama (optional), React, TypeScript, Tailwind, lucide-react.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `runner/` (dir) | browser-use runner service (copied from browser-use-qa) |
| Create | `runner/pyproject.toml` | runner deps incl. optional LLM providers |
| Create | `runner/llm_factory.py` | provider-agnostic LLM factory |
| Modify | `runner/main.py` | replace hardcoded DeepSeek with llm_factory |
| Modify | `runner/.env.example` | add LLM_PROVIDER + per-provider keys |
| Modify | `backend/app/core/config.py` | add RUNNER_URL, RUNNER_TIMEOUT_SEC, RUNNER_RUNS_DIR |
| Modify | `backend/.env` | add RUNNER_URL, RUNNER_RUNS_DIR |
| Modify | `backend/.env.example` | same |
| Create | `backend/app/schemas/runner.py` | RunnerStartRequest, RunnerRunResponse, RunnerScreenshot |
| Create | `backend/app/services/runner_service.py` | fetch TestCase, build prompt, call runner, map response |
| Create | `backend/tests/test_runner_service.py` | unit tests for prompt builder + URL extractor |
| Modify | `backend/app/api/routes.py` | add POST /runner/run, GET /runner/screenshot |
| Modify | `frontend/src/types.ts` | add RunnerStatus, RunnerRunResponse, RunnerScreenshot |
| Modify | `frontend/src/api.ts` | add runTestCase() |
| Create | `frontend/src/components/RunnerView.tsx` | runner UI: idle/loading/result states |
| Modify | `frontend/src/components/Sidebar.tsx` | add activeTool prop + Browser Runner nav item |
| Modify | `frontend/src/App.tsx` | add tool state, pass to Sidebar, render RunnerView |

---

## Task 1: Copy runner into repo

**Files:**
- Create: `runner/` (directory with copied files)
- Create: `runner/pyproject.toml`

- [ ] **Step 1: Copy runner files**

```bash
cp /home/dmitriy/projects/browser-use-qa/runner/main.py runner/main.py
cp /home/dmitriy/projects/browser-use-qa/runner/views.py runner/views.py
cp /home/dmitriy/projects/browser-use-qa/runner/start.sh runner/start.sh
cp /home/dmitriy/projects/browser-use-qa/runner/stop.sh runner/stop.sh
cp /home/dmitriy/projects/browser-use-qa/runner/status.sh runner/status.sh
cp /home/dmitriy/projects/browser-use-qa/runner/.env.example runner/.env.example
cp /home/dmitriy/projects/browser-use-qa/runner/.env runner/.env
chmod +x runner/start.sh runner/stop.sh runner/status.sh
```

- [ ] **Step 2: Remove stale load_dotenv path in runner/main.py**

Find and remove this line (it pointed to a sibling dir that no longer exists):
```python
load_dotenv(RUNNER_DIR.parent / 'browser-use' / '.env')
```
Only keep:
```python
load_dotenv(RUNNER_DIR / '.env')
```

- [ ] **Step 3: Create runner/pyproject.toml**

```toml
[project]
name = "qa-ai-runner"
version = "0.1.0"
description = "Browser-use test runner for QA AI Tools"
requires-python = ">=3.11"
dependencies = [
    "browser-use @ git+https://github.com/browser-use/browser-use.git@main",
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "httpx>=0.27",
    "python-dotenv>=1.0",
    "pydantic>=2.7",
]

[project.optional-dependencies]
openai  = ["langchain-openai>=0.2"]
claude  = ["langchain-anthropic>=0.3"]
ollama  = ["langchain-ollama>=0.2"]
all     = ["langchain-openai>=0.2", "langchain-anthropic>=0.3", "langchain-ollama>=0.2"]
dev     = ["pytest>=8.0", "pytest-asyncio>=0.23"]

[tool.uv]
package = false

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 4: Create runner venv and install deps**

```bash
cd runner
uv venv --python 3.11
source .venv/bin/activate
uv sync --extra all
uv run playwright install chromium
```

Expected: venv created, browser-use and all langchain providers installed.

- [ ] **Step 5: Smoke-check runner starts**

```bash
cd runner && source .venv/bin/activate
uvicorn main:app --port 8008 --host 0.0.0.0 &
sleep 3
curl http://localhost:8008/health
```

Expected: `{"status":"ok"}`

Kill the test process: `pkill -f "uvicorn main:app"`

- [ ] **Step 6: Commit**

```bash
git add runner/
git commit -m "feat(runner): copy browser-use runner into repo"
```

---

## Task 2: Add llm_factory.py — multi-provider LLM support

**Files:**
- Create: `runner/llm_factory.py`
- Modify: `runner/.env.example`

- [ ] **Step 1: Create runner/llm_factory.py**

```python
from __future__ import annotations

import os
from typing import Any

from browser_use.llm import ChatDeepSeek
from browser_use.llm.views import ChatInvokeUsage


class _DeepSeekCompletionsCapture:
    def __init__(self, completions: Any, on_response: Any) -> None:
        self._completions = completions
        self._on_response = on_response

    async def create(self, *args: Any, **kwargs: Any) -> Any:
        response = await self._completions.create(*args, **kwargs)
        self._on_response(response)
        return response

    def __getattr__(self, name: str) -> Any:
        return getattr(self._completions, name)


class DeepSeekWithUsage(ChatDeepSeek):
    def _usage_from_response(self, response: Any) -> ChatInvokeUsage | None:
        usage = getattr(response, 'usage', None)
        if usage is None:
            return None
        prompt_tokens = int(getattr(usage, 'prompt_tokens', 0) or 0)
        completion_tokens = int(getattr(usage, 'completion_tokens', 0) or 0)
        total_tokens = int(getattr(usage, 'total_tokens', 0) or 0) or prompt_tokens + completion_tokens
        prompt_details = getattr(usage, 'prompt_tokens_details', None)
        cached_tokens = getattr(prompt_details, 'cached_tokens', None) if prompt_details is not None else None
        return ChatInvokeUsage(
            prompt_tokens=prompt_tokens,
            prompt_cached_tokens=cached_tokens,
            prompt_cache_creation_tokens=None,
            prompt_image_tokens=None,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )

    def _client(self) -> Any:
        client = super()._client()
        if not isinstance(client.chat.completions, _DeepSeekCompletionsCapture):
            client.chat.completions = _DeepSeekCompletionsCapture(
                client.chat.completions,
                lambda r: object.__setattr__(self, '_last_raw_response', r),
            )
        return client

    async def ainvoke(self, *args: Any, **kwargs: Any) -> Any:
        object.__setattr__(self, '_last_raw_response', None)
        result = await super().ainvoke(*args, **kwargs)
        captured = getattr(self, '_last_raw_response', None)
        if result.usage is None and captured is not None:
            result.usage = self._usage_from_response(captured)
        return result


def create_llm(model: str, llm_timeout_sec: int = 90) -> Any:
    """Return a LangChain-compatible chat model for the configured LLM_PROVIDER."""
    provider = os.getenv('LLM_PROVIDER', 'deepseek').lower()

    if provider == 'deepseek':
        api_key = os.getenv('DEEPSEEK_API_KEY', '')
        if not api_key:
            raise RuntimeError('DEEPSEEK_API_KEY is not set')
        return DeepSeekWithUsage(model=model, api_key=api_key, timeout=llm_timeout_sec + 15)

    if provider == 'openai':
        from langchain_openai import ChatOpenAI
        api_key = os.getenv('OPENAI_API_KEY', '')
        if not api_key:
            raise RuntimeError('OPENAI_API_KEY is not set')
        kwargs: dict[str, Any] = {'model': model, 'api_key': api_key}
        base_url = os.getenv('OPENAI_BASE_URL')
        if base_url:
            kwargs['base_url'] = base_url
        return ChatOpenAI(**kwargs)

    if provider == 'claude':
        from langchain_anthropic import ChatAnthropic
        api_key = os.getenv('ANTHROPIC_API_KEY', '')
        if not api_key:
            raise RuntimeError('ANTHROPIC_API_KEY is not set')
        return ChatAnthropic(model=model, api_key=api_key)

    if provider == 'ollama':
        from langchain_ollama import ChatOllama
        base_url = os.getenv('OLLAMA_BASE_URL', 'http://localhost:11434')
        return ChatOllama(model=model, base_url=base_url)

    raise RuntimeError(f'Unknown LLM_PROVIDER: {provider!r}. Choose: deepseek, openai, claude, ollama')
```

- [ ] **Step 2: Update runner/.env.example — add LLM_PROVIDER section**

Add after the existing `# LLM — DeepSeek` block:

```bash
# -----------------------------------------------------------------------------
# LLM Provider
# -----------------------------------------------------------------------------
# deepseek | openai | claude | ollama
LLM_PROVIDER=deepseek

# Model name for the selected provider
RUNNER_LLM_MODEL=deepseek-chat

# DeepSeek
DEEPSEEK_API_KEY=

# OpenAI (also works with compatible endpoints)
# OPENAI_API_KEY=
# OPENAI_BASE_URL=          # optional: e.g. https://api.openai.com/v1

# Claude / Anthropic
# ANTHROPIC_API_KEY=

# Ollama (local, no key needed)
# OLLAMA_BASE_URL=http://localhost:11434
```

- [ ] **Step 3: Commit**

```bash
git add runner/llm_factory.py runner/.env.example
git commit -m "feat(runner): add multi-provider LLM factory (deepseek/openai/claude/ollama)"
```

---

## Task 3: Update runner/main.py to use llm_factory

**Files:**
- Modify: `runner/main.py`

- [ ] **Step 1: Remove DeepSeekWithUsage and _DeepSeekCompletionsCapture from main.py**

These classes are now in `llm_factory.py`. Remove the class definitions (lines ~52–103) and the `from browser_use.llm import ChatDeepSeek` import.

- [ ] **Step 2: Add import and update create_llm in main.py**

Replace the old `create_llm` function:
```python
# OLD — remove this entire function:
def create_llm(request: RunRequest) -> ChatDeepSeek:
    api_key = os.getenv('DEEPSEEK_API_KEY', '')
    if not api_key:
        raise HTTPException(status_code=500, detail='DEEPSEEK_API_KEY is not set for runner service.')
    return DeepSeekWithUsage(
        model=request.llm.model,
        api_key=api_key,
        timeout=request.llm_timeout_sec + 15,
    )
```

With:
```python
from llm_factory import create_llm as _create_llm_for_provider

def create_llm(request: RunRequest) -> Any:
    try:
        return _create_llm_for_provider(request.llm.model, request.llm_timeout_sec)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
```

Also add `from typing import Any` if not already imported (it is, at line 12).

- [ ] **Step 3: Verify runner still starts**

```bash
cd runner && source .venv/bin/activate
uvicorn main:app --port 8008 &
sleep 3
curl http://localhost:8008/health
pkill -f "uvicorn main:app"
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Commit**

```bash
git add runner/main.py
git commit -m "refactor(runner): use llm_factory instead of hardcoded DeepSeek"
```

---

## Task 4: Add runner config to backend

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env`
- Modify: `backend/.env.example`

- [ ] **Step 1: Add runner settings to config.py**

```python
# Add to Settings class, after TESTIT_DRAFT_SECTION_UUID:

RUNNER_URL: str = "http://localhost:8008"
RUNNER_TIMEOUT_SEC: int = 180
RUNNER_RUNS_DIR: str = ""  # abs path to runner/runs/ dir; empty = screenshot serving disabled
```

- [ ] **Step 2: Add to backend/.env**

```bash
# Runner
RUNNER_URL=http://localhost:8008
RUNNER_RUNS_DIR=/home/dmitriy/projects/qa-ai-tool/runner/runs
```

- [ ] **Step 3: Add to backend/.env.example**

```bash
# -----------------------------------------------------------------------------
# Browser Runner
# -----------------------------------------------------------------------------
RUNNER_URL=http://localhost:8008
# Abs path to runner/runs/ on local FS. Leave empty if runner is on remote host.
RUNNER_RUNS_DIR=
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/core/config.py backend/.env.example
git commit -m "feat(backend): add runner config (RUNNER_URL, RUNNER_TIMEOUT_SEC, RUNNER_RUNS_DIR)"
```

---

## Task 5: Add runner schemas (backend)

**Files:**
- Create: `backend/app/schemas/runner.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_runner_service.py`:

```python
from app.schemas.runner import RunnerRunResponse, RunnerScreenshot, RunnerStartRequest


def test_runner_start_request_requires_work_item_id():
    req = RunnerStartRequest(work_item_id="6109")
    assert req.work_item_id == "6109"


def test_runner_run_response_defaults():
    r = RunnerRunResponse(
        status="passed",
        summary="All steps completed",
        steps_count=5,
        errors=[],
        screenshots=[],
        duration_sec=12.3,
        run_id="abc-123",
    )
    assert r.status == "passed"
    assert r.screenshots == []
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd backend && source venv/bin/activate
pytest tests/test_runner_service.py -v
```

Expected: `ImportError` — module not found.

- [ ] **Step 3: Create backend/app/schemas/runner.py**

```python
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel


class RunnerStartRequest(BaseModel):
    work_item_id: str


class RunnerScreenshot(BaseModel):
    path: str
    url: str


class RunnerRunResponse(BaseModel):
    status: Literal["passed", "failed", "blocked"]
    summary: str
    steps_count: int
    errors: list[str]
    screenshots: list[RunnerScreenshot]
    duration_sec: float
    run_id: str | None = None
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_runner_service.py -v
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/runner.py backend/tests/test_runner_service.py
git commit -m "feat(backend): add runner schemas"
```

---

## Task 6: Add runner_service.py (backend)

**Files:**
- Create: `backend/app/services/runner_service.py`
- Modify: `backend/tests/test_runner_service.py`

- [ ] **Step 1: Write failing tests for prompt builder and URL extractor**

Add to `backend/tests/test_runner_service.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.runner_service import _build_task_prompt, _extract_url
from app.schemas.testcase import NormalizedTestCase, TestCaseStep


def _tc(**kwargs) -> NormalizedTestCase:
    defaults = dict(title="Login test", preconditions=[], steps=[], postconditions=[])
    return NormalizedTestCase(**{**defaults, **kwargs})


def test_build_prompt_includes_title():
    tc = _tc(title="Check login form")
    prompt = _build_task_prompt(tc)
    assert "Check login form" in prompt


def test_build_prompt_numbers_steps():
    tc = _tc(steps=[
        TestCaseStep(action="Open page", expected="Page loaded"),
        TestCaseStep(action="Click button", expected="Modal shown"),
    ])
    prompt = _build_task_prompt(tc)
    assert "1. Open page" in prompt
    assert "Expected result: Page loaded" in prompt
    assert "2. Click button" in prompt


def test_build_prompt_includes_preconditions():
    tc = _tc(preconditions=[TestCaseStep(action="User is logged in")])
    prompt = _build_task_prompt(tc)
    assert "User is logged in" in prompt


def test_build_prompt_skips_empty_expected():
    tc = _tc(steps=[TestCaseStep(action="Do something", expected=None)])
    prompt = _build_task_prompt(tc)
    assert "Expected result" not in prompt


def test_extract_url_from_preconditions():
    tc = _tc(preconditions=[TestCaseStep(action="Open https://example.com/login")])
    assert _extract_url(tc) == "https://example.com/login"


def test_extract_url_from_steps_if_no_precondition_url():
    tc = _tc(steps=[TestCaseStep(action="Navigate to https://app.example.com/dashboard")])
    assert _extract_url(tc) == "https://app.example.com/dashboard"


def test_extract_url_returns_none_when_no_url():
    tc = _tc(steps=[TestCaseStep(action="Click the button")])
    assert _extract_url(tc) is None
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && source venv/bin/activate
pytest tests/test_runner_service.py -v
```

Expected: `ImportError` — `runner_service` not found.

- [ ] **Step 3: Create backend/app/services/runner_service.py**

```python
from __future__ import annotations

import re

import httpx

from app.core.config import settings
from app.schemas.runner import RunnerRunResponse, RunnerScreenshot, RunnerStartRequest
from app.schemas.testcase import NormalizedTestCase
from app.services.testit_workitem_service import fetch_and_normalize_work_item

_URL_RE = re.compile(r'https?://[^\s)\]}>"\']+')


def _extract_url(testcase: NormalizedTestCase) -> str | None:
    for step in testcase.preconditions:
        m = _URL_RE.search(step.action or "")
        if m:
            return m.group(0)
    for step in testcase.steps:
        m = _URL_RE.search(step.action or "")
        if m:
            return m.group(0)
    return None


def _build_task_prompt(testcase: NormalizedTestCase) -> str:
    lines = [
        "You are a QA engineer executing a manual test case in a web browser.",
        "Follow each step exactly. After completing all steps, report whether",
        "the test passed, failed, or is blocked (cannot proceed due to a missing",
        "precondition or environment issue).",
        "",
        f"Test case: {testcase.title or 'Untitled'}",
    ]

    if testcase.preconditions:
        lines.append("")
        lines.append("Preconditions:")
        for step in testcase.preconditions:
            lines.append(f"- {step.action}")

    if testcase.steps:
        lines.append("")
        lines.append("Steps:")
        for i, step in enumerate(testcase.steps, 1):
            lines.append(f"{i}. {step.action}")
            if step.expected:
                lines.append(f"   Expected result: {step.expected}")
            if step.test_data:
                lines.append(f"   Test data: {step.test_data}")

    lines.append("")
    lines.append("Report: passed / failed / blocked, with a short summary of what you observed.")
    return "\n".join(lines)


async def run_test_case(body: RunnerStartRequest) -> RunnerRunResponse:
    fetch_result = await fetch_and_normalize_work_item(body.work_item_id)
    testcase = NormalizedTestCase(**fetch_result.normalized_testcase)

    task = _build_task_prompt(testcase)
    start_url = _extract_url(testcase)

    payload: dict = {"test_case_id": body.work_item_id, "task": task}
    if start_url:
        payload["start_url"] = start_url

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.RUNNER_URL}/run",
            json=payload,
            timeout=float(settings.RUNNER_TIMEOUT_SEC),
        )
        response.raise_for_status()
        data = response.json()

    screenshot_paths: list[str] = data.get("artifacts", {}).get("screenshot_paths", [])
    screenshots = [
        RunnerScreenshot(path=p, url=f"/api/runner/screenshot?path={p}")
        for p in screenshot_paths
    ]

    return RunnerRunResponse(
        status=data["status"],
        summary=data.get("summary", ""),
        steps_count=data.get("steps_count", 0),
        errors=data.get("errors", []),
        screenshots=screenshots,
        duration_sec=data.get("duration_sec", 0.0),
        run_id=data.get("run_id"),
    )
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_runner_service.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/runner_service.py backend/tests/test_runner_service.py
git commit -m "feat(backend): add runner_service — prompt builder + runner HTTP client"
```

---

## Task 7: Add runner routes (backend)

**Files:**
- Modify: `backend/app/api/routes.py`

- [ ] **Step 1: Add imports to routes.py**

At the top of `backend/app/api/routes.py`, add:

```python
import pathlib
from fastapi.responses import FileResponse
from app.schemas.runner import RunnerStartRequest, RunnerRunResponse
from app.services import runner_service
```

- [ ] **Step 2: Add POST /api/runner/run route**

Append to `backend/app/api/routes.py`:

```python
@router.post("/runner/run", response_model=RunnerRunResponse)
async def runner_run(body: RunnerStartRequest) -> RunnerRunResponse:
    try:
        return await runner_service.run_test_case(body)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Runner timeout — test took too long")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Runner error: {exc.response.text[:300]}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Runner unavailable: {exc}")
    except (TestItNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except TestItConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
```

Also add `import httpx` near the top of the file if not already present.

- [ ] **Step 3: Add GET /api/runner/screenshot route**

```python
@router.get("/runner/screenshot")
async def runner_screenshot(path: str) -> FileResponse:
    runs_dir = settings.RUNNER_RUNS_DIR
    if not runs_dir:
        raise HTTPException(status_code=503, detail="Screenshot serving not configured (RUNNER_RUNS_DIR not set)")

    runs_root = pathlib.Path(runs_dir).resolve()
    target = pathlib.Path(path).resolve()

    if not str(target).startswith(str(runs_root)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not target.exists():
        raise HTTPException(status_code=404, detail="Screenshot not found")

    return FileResponse(str(target))
```

Add `from app.core.config import settings` if not already imported (it isn't — add it).

- [ ] **Step 4: Verify backend compiles**

```bash
cd backend && source venv/bin/activate
python -c "from app.api.routes import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Smoke-test the route exists**

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/api/runner/run \
  -H "Content-Type: application/json" \
  -d '{"work_item_id":"0"}'
```

Expected: `404` or `503` (not 422/500) — route exists, TestIT responds normally.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routes.py
git commit -m "feat(backend): add /api/runner/run and /api/runner/screenshot routes"
```

---

## Task 8: Frontend — types and API client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add types to frontend/src/types.ts**

Append at the end of the file:

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

- [ ] **Step 2: Add runTestCase to frontend/src/api.ts**

Add to the `api` object:

```typescript
runTestCase: (work_item_id: string) =>
  post<RunnerRunResponse>('/runner/run', { work_item_id }),
```

Also add the import at the top of `api.ts`:
```typescript
import type { ..., RunnerRunResponse } from './types'
```
(add `RunnerRunResponse` to the existing import list)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat(frontend): add runner types and API client"
```

---

## Task 9: Create RunnerView.tsx

**Files:**
- Create: `frontend/src/components/RunnerView.tsx`

- [ ] **Step 1: Create frontend/src/components/RunnerView.tsx**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Loader2, MonitorPlay, X, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { api } from '../api'
import type { RunnerRunResponse, RunnerStatus } from '../types'

const STATUS_CONFIG: Record<RunnerStatus, { label: string; pillClass: string; Icon: typeof CheckCircle2 }> = {
  passed:  { label: 'PASSED',  pillClass: 'pill-ok',   Icon: CheckCircle2 },
  failed:  { label: 'FAILED',  pillClass: 'pill-err',  Icon: XCircle },
  blocked: { label: 'BLOCKED', pillClass: 'pill-warn', Icon: AlertTriangle },
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}м ${s}с` : `${s}с`
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}м ${s}с` : `${s}с`
}

export function RunnerView() {
  const [testItId, setTestItId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RunnerRunResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function startTimer() {
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => () => stopTimer(), [])

  async function handleRun() {
    const id = testItId.trim()
    if (!id) return
    setLoading(true)
    setResult(null)
    setError(null)
    startTimer()
    try {
      const data = await api.runTestCase(id)
      setResult(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
      stopTimer()
    }
  }

  function handleReset() {
    setResult(null)
    setError(null)
    setTestItId('')
  }

  const cfg = result ? STATUS_CONFIG[result.status] : null

  return (
    <div className="workspace-inner">
      <div className="workspace-col" style={{ maxWidth: 680 }}>

        {/* Header */}
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MonitorPlay size={18} strokeWidth={1.75} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Browser Runner</span>
          </div>
        </div>

        {/* Input */}
        <div className="source-card" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">TestIT ID</label>
            <input
              className="text-input"
              placeholder="6109"
              value={testItId}
              onChange={e => setTestItId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && handleRun()}
              disabled={loading}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleRun}
            disabled={loading || !testItId.trim()}
          >
            {loading ? <Loader2 size={14} className="spin" /> : 'Запустить'}
          </button>
          {(result || error) && (
            <button className="btn btn-ghost" onClick={handleReset}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="result-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Loader2 size={20} className="spin" style={{ flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Агент работает…</div>
              <div className="tx-muted" style={{ fontSize: 13 }}>{formatElapsed(elapsed)}</div>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="result-card result-card-err">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Ошибка запуска</div>
            <div style={{ fontSize: 13 }}>{error}</div>
          </div>
        )}

        {/* Result state */}
        {result && !loading && cfg && (
          <>
            <div className="result-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <cfg.Icon size={18} />
                <span className={`pill ${cfg.pillClass}`} style={{ fontSize: 13, fontWeight: 700 }}>
                  {cfg.label}
                </span>
                <span className="tx-muted" style={{ fontSize: 13, marginLeft: 'auto' }}>
                  {result.steps_count} шагов · {formatDuration(result.duration_sec)}
                </span>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>{result.summary}</div>

              {result.errors.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Ошибки</div>
                  {result.errors.map((e, i) => (
                    <div key={i} className="tx-muted" style={{ fontSize: 13, marginBottom: 2 }}>• {e}</div>
                  ))}
                </div>
              )}
            </div>

            {result.screenshots.length > 0 && (
              <div className="result-card">
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
                  Скриншоты ({result.screenshots.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {result.screenshots.map((s, i) => (
                    <img
                      key={i}
                      src={s.url}
                      alt={`Шаг ${i + 1}`}
                      style={{ width: 120, height: 72, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)' }}
                      onClick={() => setLightboxSrc(s.url)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Lightbox */}
      {lightboxSrc && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, cursor: 'zoom-out',
          }}
          onClick={() => setLightboxSrc(null)}
        >
          <img src={lightboxSrc} alt="Screenshot" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add missing CSS classes to frontend/src/index.css**

Check if `.result-card`, `.result-card-err`, `.tx-muted`, `.text-input`, `.field-label`, `.btn`, `.btn-primary`, `.btn-ghost`, `.source-card` exist. If any are missing add:

```css
.result-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 12px;
}
.result-card-err {
  border-color: var(--bad-border);
  background: var(--bad-bg);
}
.tx-muted { color: var(--tx-muted); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/RunnerView.tsx frontend/src/index.css
git commit -m "feat(frontend): add RunnerView component"
```

---

## Task 10: Wire Sidebar + App routing

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update Sidebar.tsx to accept activeTool + onToolChange**

Replace the Sidebar component:

```tsx
import { ChevronLeft, ChevronRight, FileCheck2, MonitorPlay, Sparkles, Zap, Settings } from 'lucide-react'

type Tool = 'review' | 'runner'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  activeTool: Tool
  onToolChange: (tool: Tool) => void
}

export function Sidebar({ collapsed, onToggle, activeTool, onToolChange }: SidebarProps) {
  return (
    <aside className={`sidebar${collapsed ? ' sb-collapsed' : ''}`}>
      <div className="sb-logo">
        <div className="sb-mark"><span>QA</span></div>
        <div className="sb-brand">
          <span className="sb-brand-name">QA AI Tools</span>
          <span className="sb-brand-sub">AI Review Workspace</span>
        </div>
      </div>
      <div className="sb-section">
        <span className="sb-section-label">Инструменты</span>
      </div>
      <nav className="sb-nav">
        <div
          className={`sb-item${activeTool === 'review' ? ' sb-item-active' : ''}`}
          onClick={() => onToolChange('review')}
          style={{ cursor: 'pointer' }}
        >
          <div className="sb-icon"><FileCheck2 size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">Ревью и улучшение</span>
            <span className="sb-sub">тест-кейсов</span>
          </div>
        </div>
        <div
          className={`sb-item${activeTool === 'runner' ? ' sb-item-active' : ''}`}
          onClick={() => onToolChange('runner')}
          style={{ cursor: 'pointer' }}
        >
          <div className="sb-icon"><MonitorPlay size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">Browser Runner</span>
            <span className="sb-sub">запуск тест-кейсов</span>
          </div>
        </div>
        <div className="sb-item sb-item-soon">
          <div className="sb-icon"><Sparkles size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">Генерация</span>
            <span className="sb-sub">тест-кейсов</span>
          </div>
          <span className="sb-badge">Скоро</span>
        </div>
        <div className="sb-item sb-item-soon">
          <div className="sb-icon"><Zap size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">Генерация</span>
            <span className="sb-sub">api-тестов</span>
          </div>
          <span className="sb-badge">Скоро</span>
        </div>
      </nav>
      <div className="sb-divider" />
      <div className="sb-bottom">
        <div className="sb-item sb-item-soon">
          <div className="sb-icon"><Settings size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy"><span className="sb-title">Настройки</span></div>
          <span className="sb-badge">Скоро</span>
        </div>
        <button type="button" className="sb-item" onClick={onToggle}>
          <div className="sb-icon">
            {collapsed ? <ChevronRight size={16} strokeWidth={1.75} /> : <ChevronLeft size={16} strokeWidth={1.75} />}
          </div>
          <div className="sb-copy"><span className="sb-title">Свернуть</span></div>
        </button>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Update App.tsx to add tool state and render RunnerView**

Add `tool` state and `RunnerView` import:

```tsx
import { RunnerView } from './components/RunnerView'
```

Add state after existing state declarations:
```tsx
const [activeTool, setActiveTool] = useState<'review' | 'runner'>('review')
```

Update all `<Sidebar>` usages to pass the new props:
```tsx
<Sidebar
  collapsed={sidebarCollapsed}
  onToggle={() => setSidebarCollapsed(v => !v)}
  activeTool={activeTool}
  onToolChange={tool => { setActiveTool(tool); setFetchResult(null); setFetchError(null) }}
/>
```

Add runner branch to the main return. When `activeTool === 'runner'`, render:
```tsx
if (activeTool === 'runner') {
  return (
    <>
      <ProgressBar active={false} />
      <div className="app">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(v => !v)}
          activeTool={activeTool}
          onToolChange={tool => { setActiveTool(tool); setFetchResult(null); setFetchError(null) }}
        />
        <main className="workspace">
          <RunnerView />
        </main>
      </div>
    </>
  )
}
```

Insert this block before the existing `if (fetchResult)` check.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Test in browser**

Open http://localhost:5173, click "Browser Runner" in sidebar, verify RunnerView renders with the input field.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add Browser Runner nav item and tool routing"
```

---

## Task 11: End-to-end smoke test

- [ ] **Step 1: Start runner**

```bash
cd runner && source .venv/bin/activate
./start.sh
curl http://localhost:8008/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 2: Restart backend**

```bash
cd backend && pkill -f "uvicorn app.main:app" || true
source venv/bin/activate
uvicorn app.main:app --port 8000 --reload &
sleep 2
curl http://localhost:8000/api/runner/run -X POST \
  -H "Content-Type: application/json" \
  -d '{"work_item_id":"REPLACE_WITH_REAL_ID"}' | python3 -m json.tool
```

Expected: JSON with `status`, `summary`, `screenshots`.

- [ ] **Step 3: Test screenshot serving**

```bash
# Use a path from the response screenshots[0].path
curl -o /tmp/test.png "http://localhost:8000/api/runner/screenshot?path=REPLACE_WITH_PATH"
file /tmp/test.png
```

Expected: `PNG image data`

- [ ] **Step 4: Test full UI flow**

Open http://localhost:5173 → "Browser Runner" → enter a real TestIT ID → "Запустить" → wait → verify result card shows status + screenshots.

- [ ] **Step 5: Commit spec update**

```bash
git add docs/superpowers/specs/2026-06-05-browser-runner-tool-design.md \
        docs/superpowers/plans/2026-06-05-browser-runner-tool.md
git commit -m "docs: update browser runner spec and plan"
```

---

## Self-Review Checklist

- [x] **runner/ copy** — Task 1 covers copying + fixing stale load_dotenv path
- [x] **llm_factory multi-provider** — Task 2: deepseek/openai/claude/ollama
- [x] **main.py update** — Task 3: replaces hardcoded create_llm
- [x] **backend config** — Task 4: RUNNER_URL, RUNNER_TIMEOUT_SEC, RUNNER_RUNS_DIR
- [x] **backend schemas** — Task 5: RunnerStartRequest, RunnerRunResponse, RunnerScreenshot
- [x] **runner_service** — Task 6: prompt builder, URL extractor, httpx call
- [x] **routes** — Task 7: POST /runner/run, GET /runner/screenshot with path traversal guard
- [x] **frontend types + api** — Task 8
- [x] **RunnerView** — Task 9: idle/loading/result/lightbox
- [x] **Sidebar + App routing** — Task 10
- [x] **Type consistency** — `RunnerRunResponse` used identically in schemas/runner.py and types.ts; `RunnerStartRequest.work_item_id` matches `api.runTestCase(work_item_id)` and the route body
- [x] **No placeholders** — all steps have complete code
