# Docker Compose Setup — Design Spec

**Date:** 2026-06-21  
**Goal:** Package all services for easy local deployment by team members on Linux / macOS / Windows (Docker Desktop).

---

## Context

Four services compose the tool:

| Service | Stack | Port |
|---------|-------|------|
| `backend` | Python 3.12 / FastAPI | 8000 |
| `stagehand-runner` | Node.js 20 / TypeScript + Playwright | 8009 |
| `browser-use-runner` | Python 3.11 / FastAPI + Playwright | 8008 |
| `frontend` | React / Vite | 3000 |

Frontend calls backend via `/api` prefix (no hardcoded host). Vite proxies `/api → localhost:8000` in local dev. In Docker prod, nginx handles this proxy.

---

## Approach: docker-compose.yml + docker-compose.override.yml

- `docker-compose.yml` — base: all services, **nginx** serves built frontend
- `docker-compose.override.yml` — dev overrides: **vite** dev server, volume mounts, `--reload`

```
docker compose up                        # dev (override auto-applied)
docker compose -f docker-compose.yml up # prod (nginx, no mounts)
```

---

## Architecture

```
Browser
  └── frontend :3000
        /api/*  →  backend:8000   (nginx proxy OR vite proxy)
        ws://   →  backend:8000   (WebSocket upgrade)

backend:8000 (FastAPI)
  ├── → stagehand-runner:8009
  └── → browser-use-runner:8008

stagehand-runner:8009   (Node.js + Playwright Chromium)
browser-use-runner:8008 (Python + Playwright Chromium)
```

Internal service communication uses Docker Compose service names as hostnames.

---

## Files

### Dockerfiles

**`backend/Dockerfile`**
- Base: `python:3.12-slim`
- `pip install -r requirements.txt`
- CMD: `uvicorn app.main:app --host 0.0.0.0 --port 8000`

**`stagehand-runner/Dockerfile`**
- Base: `mcr.microsoft.com/playwright:v1.60.0-noble` (Node.js 20 + Chromium pre-installed)
- `npm ci --omit=dev`
- `npm run build` (tsc)
- CMD: `node dist/index.js`

**`browser-use-runner/Dockerfile`**
- Base: `mcr.microsoft.com/playwright/python:v1.60.0-noble` (Python 3.11 + Chromium pre-installed)
- Install `uv`, then `uv sync --all-extras`
- CMD: `uvicorn main:app --host 0.0.0.0 --port 8008`

**`frontend/Dockerfile`** — multi-stage
- Stage `build`: `node:20-alpine`, `npm ci`, `npm run build`
- Stage `prod`: `nginx:alpine`, copy `/dist`, copy `nginx.conf`
- Stage `dev`: `node:20-alpine`, `npm ci`, CMD `npm run dev -- --host`

### Nginx config

**`frontend/nginx.conf`**
- Serve `/usr/share/nginx/html` (built Vite output)
- `location /api/` → `proxy_pass http://backend:8000`
- WebSocket upgrade headers for WS connections
- `location /` → `try_files $uri /index.html` (SPA fallback)

### Compose files

**`docker-compose.yml`** (base / prod)
- All 4 services
- `env_file: .env` on each service
- `environment` overrides for inter-service URLs:
  - `RUNNER_URL=http://stagehand-runner:8009`
  - `AUDIT_RUNNER_URL=http://browser-use-runner:8008`
- Named volumes: `stagehand_runs`, `browser_runs`
- Single network `qa-net`
- Frontend: build target `prod`, port `3000:80`

**`docker-compose.override.yml`** (dev)
- `frontend`: build target `dev`, port `3000:3000`, volume mount `./frontend:/app`, env `VITE_BACKEND_URL=http://backend:8000`
- `backend`: volume mount `./backend:/app`, command adds `--reload`
- `stagehand-runner`: volume mount `./stagehand-runner/runs:/app/runs`
- `browser-use-runner`: volume mount `./browser-use-runner/runs:/app/runs`

### Code change

**`frontend/vite.config.ts`** — proxy target reads from env:
```ts
target: process.env.VITE_BACKEND_URL || 'http://localhost:8000',
```
This keeps local dev working unchanged; Docker dev sets `VITE_BACKEND_URL=http://backend:8000`.

### .dockerignore files

Each service gets `.dockerignore` excluding:
- `node_modules/`, `venv/`, `.venv/`, `__pycache__/`, `dist/`
- `runs/`, `logs/`, `.env`

---

## Environment Variables

Team members copy `.env.example` → `.env` and fill in:
- `LLM_API_KEY` (required)
- `TESTIT_BASE_URL`, `TESTIT_PRIVATE_TOKEN` (required for TestIT features)

All other values have defaults. Docker service URLs (`RUNNER_URL`, `AUDIT_RUNNER_URL`) are overridden in compose — team members do not need to change them.

---

## Volumes

| Volume | Mounted at | Purpose |
|--------|-----------|---------|
| `stagehand_runs` | `/app/runs` in stagehand-runner | Screenshots, run records |
| `browser_runs` | `/app/runs` in browser-use-runner | Audit run records |

In dev override, host paths `./stagehand-runner/runs` and `./browser-use-runner/runs` are bind-mounted instead (so screenshots are visible in IDE).

---

## User Workflow

```bash
# 1. Clone
git clone <repo> && cd qa-ai-tool

# 2. Configure
cp .env.example .env
# edit .env: set LLM_API_KEY, TESTIT_* vars

# 3. Run (dev)
docker compose up --build

# 4. Open
# http://localhost:3000
```

For prod (no source mounts, built frontend):
```bash
docker compose -f docker-compose.yml up --build
```

---

## Out of Scope

- CI/CD pipeline
- HTTPS / TLS termination
- Multi-user auth on the tool itself
- Pushing images to a registry
