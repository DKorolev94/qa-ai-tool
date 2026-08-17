# QA AI Tool

AI-powered test case review and improvement tool. Integrates with TestIT, uses any OpenAI-compatible LLM endpoint.

## Features

- Single test case review and improvement, with a diff view before applying changes back to TestIT
- Bulk review: submit a list of TestIT work item IDs, run the review pipeline over all of them as one tracked job, retry failed items individually
- AI browser agent runner: execute a test case as a live browser session, with streaming logs and screenshots

## Architecture

| Service | Port | Description |
|---|---|---|
| `backend` | 8000 | FastAPI, TestIT proxy, LLM review/improve pipeline |
| `browser-use-runner` | 8008 | FastAPI, AI browser agent runner |
| `frontend` | 3000 | Vite + React UI |

---

## Quick Start (Docker)

**Requirements:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Linux / macOS / Windows)

```bash
# 1. Clone
git clone git@github.com:DKorolev94/qa-ai-tool.git && cd qa-ai-tool

# 2. Configure
cp .env.example .env
# Edit .env, set at minimum: LLM_API_KEY, LLM_MODEL, TESTIT_BASE_URL, TESTIT_PRIVATE_TOKEN

# 3. Start dev (hot-reload, bind mounts, works on Linux + macOS incl. Apple Silicon)
docker compose up --build

# 4. Open
open http://localhost:3000
```

```bash
# Prod mode (built frontend, named volumes)
docker compose -f docker-compose.prod.yml up --build

# Stop
docker compose down
```

> **Apple Silicon note:** `platform: linux/amd64` is already set for `browser-use-runner` in both compose files. Rosetta handles the emulation automatically.

---

## Quick Start (local, no Docker)

**Requirements:** Python 3.10+, Node.js 18+, uv (`pip install uv`)

```bash
# All services at once (uses Makefile)
make dev

# Or individually:

# Backend
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# browser-use-runner
cd browser-use-runner && uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8008 --reload

# Frontend
cd frontend && npm install && npm run dev
```

```bash
make stop      # kill all local services
make restart   # stop + start
make status    # check ports
```

---

## Environment Variables

Copy `.env.example` to `.env` in the project root and fill in the values.

### Required

| Variable | Example | Description |
|---|---|---|
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint |
| `LLM_API_KEY` | `sk-...` | API key (`ollama` for local Ollama) |
| `LLM_MODEL` | `gpt-4o-mini` | Model for review/improve (needs structured JSON output) |
| `RUNNER_LLM_MODEL` | `gpt-4o` | Model for browser agent (strong reasoning recommended) |
| `TESTIT_BASE_URL` | `https://testit.example.com` | TestIT instance URL |
| `TESTIT_PRIVATE_TOKEN` | `your_token` | TestIT private token |

No project ID to configure — each test case's project is read from TestIT itself, and drafts/results are saved back into that same project.

Everything else (timeouts, preflight, temperature, browser runner tuning) has working defaults, see `.env.example`.

### LLM provider examples

```bash
# OpenAI
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini

# DeepSeek
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

# Ollama (local, outside Docker)
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=gemma3:4b

# Ollama inside Docker (Linux)
LLM_BASE_URL=http://host.docker.internal:11434/v1
# Also add to docker-compose.yml under browser-use-runner:
#   extra_hosts: ["host.docker.internal:host-gateway"]
```
