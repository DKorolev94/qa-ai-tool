# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Dev (without Docker)

```bash
# Backend
cd backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# browser-use-runner
cd browser-use-runner && uv sync && uv run uvicorn main:app --host 0.0.0.0 --port 8008 --reload

# Frontend
cd frontend && npm install && npm run dev
```

### Makefile shortcuts

```bash
make dev       # start all services (backend :8000, browser-use-runner :8008, frontend :3000)
make stop      # kill all
make restart   # stop + dev
make status    # check ports
make logs-backend
make logs-runner
```

### Docker

```bash
docker compose up --build          # dev mode (hot-reload, bind mounts)
docker compose -f docker-compose.yml up --build  # prod mode (built frontend, nginx)
docker compose down
```

### Tests (backend only — browser-use-runner has no tests)

```bash
cd backend && python -m pytest
cd backend && python -m pytest tests/test_llm_client.py
cd backend && python -m pytest tests/test_llm_client.py -k test_name
```

Pytest config: `backend/pytest.ini` — `python_classes = *Tests *Suite`, `testpaths = tests`. Asyncio mode is NOT enabled in backend (it is in browser-use-runner via `pyproject.toml`).

## Architecture

Three services:

```
backend/              FastAPI :8000  — TestIT proxy, LLM review/improve pipeline
browser-use-runner/   FastAPI :8008  — browser-use AI web agent runner
frontend/             Vite+React :3000 — UI
```

### Backend pipeline

Review/improve flow:

1. **Parse**: raw text → `testit_parser.py` or `testit_workitem_mapper.py` → `NormalizedTestCase`
2. **LLM**: `llm_client.py` uses `instructor` library for structured JSON output (not raw OpenAI SDK). Two calls: `analyze_testcase_with_llm` → `ReviewResult`, `improve_testcase_with_llm` → `ImproveResult`
3. **Postprocess**: `testcase_postprocessor.py` fixes/validates LLM output; `testcase_diff.py` builds a diff

Key modules:
- `app/core/llm_client.py` — all LLM calls (review, improve, parse)
- `app/core/prompt_builder.py` — assembles prompts from `.md` files
- `app/core/review_config.py` — hardcoded rule/profile/source config (no DB)
- `app/integrations/testit_client.py` — TestIT REST API client
- `app/services/runner_service.py` — proxy/WebSocket bridge to browser-use-runner

### Prompts as files

Rules and prompts live in `backend/app/core/prompts/` as `.md` files. Each rule file has two sections: detection logic (used for review) and `## Как исправлять` (used for improve). `prompt_builder.py` strips the fix section for review calls and strips the detection section for improve calls.

Active rules: `title`, `description`, `preconditions`, `steps`, `postconditions`, `priority`, `expected_results`, `test_data`, `tags`, `atomicity`, `independence`, `reproducibility`.

### browser-use-runner

Standalone FastAPI app using `browser-use` (git dependency from `main` branch). Runs AI browser agents. Results stored in `runs/` directory with structured subfolders (`raw/`, `logs/`, `ui/`, `metrics/`, `media/screenshots/`). Live streaming via WebSocket. Package manager: `uv` (not pip).

### .env loading hierarchy

- **Root `.env`** — primary config, used by both backend and browser-use-runner
- `backend/.env` — overrides (loaded second)
- `browser-use-runner/.env` — local overrides (loaded with `override=True`)
- `LLM_MODEL` → backend LLM; `RUNNER_LLM_MODEL` → runner LLM (falls back to `LLM_MODEL` if unset)
- In Docker: `RUNNER_URL` auto-set to `http://browser-use-runner:8008`; locally needs `RUNNER_RUNS_DIR` (absolute path to `browser-use-runner/runs/`) for screenshot serving

### Package managers

- `backend/`: `pip` + `requirements.txt` (Python 3.10+)
- `browser-use-runner/`: `uv` + `pyproject.toml` + `uv.lock` (Python 3.11+)
- `frontend/`: `npm` + `package.json` (Node 18+)