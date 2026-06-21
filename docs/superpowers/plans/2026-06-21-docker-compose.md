# Docker Compose Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Containerise all four services so any team member can run `docker compose up --build` and open the tool at http://localhost:3000.

**Architecture:** Approach B — `docker-compose.yml` (base/prod: nginx frontend) + `docker-compose.override.yml` (dev: vite hot-reload, bind-mounts). Each service gets its own Dockerfile. Browser runners use the official Microsoft Playwright images to avoid manual Chromium dependency installation.

**Tech Stack:** Docker Compose v2, Python 3.12/3.11, Node.js 20, Playwright v1.60.0, nginx:alpine, uv (Python pkg manager).

## Global Constraints

- Docker Compose v2 syntax (no `version:` key required)
- Playwright image tag must match installed package version: `v1.60.0-noble`
- All services read `env_file: .env` from project root; inter-service URLs are overridden via `environment:` in compose (never in `.env`)
- `RUNNER_URL` must be `http://stagehand-runner:8009` in compose
- `AUDIT_RUNNER_URL` must be `http://browser-use-runner:8008` in compose
- Named volumes `stagehand_runs` and `browser_runs` persist data between container restarts
- Dev override bind-mounts `./stagehand-runner/runs` and `./browser-use-runner/runs` so screenshots are visible in IDE

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `backend/Dockerfile` | Python 3.12 slim image |
| Create | `backend/.dockerignore` | Exclude venv, cache, logs |
| Create | `stagehand-runner/Dockerfile` | Playwright Node image, tsc build |
| Create | `stagehand-runner/.dockerignore` | Exclude node_modules, dist, runs |
| Create | `browser-use-runner/Dockerfile` | Python 3.11 + uv + Playwright Chromium |
| Create | `browser-use-runner/.dockerignore` | Exclude .venv, runs, logs |
| Create | `frontend/Dockerfile` | Multi-stage: build→nginx (prod), dev stage |
| Create | `frontend/nginx.conf` | SPA + /api proxy + WS upgrade |
| Create | `frontend/.dockerignore` | Exclude node_modules, dist |
| Modify | `frontend/vite.config.ts` | Read proxy target from `VITE_BACKEND_URL` env |
| Create | `docker-compose.yml` | All 4 services, prod frontend (nginx) |
| Create | `docker-compose.override.yml` | Dev: vite, bind-mounts, --reload |

---

### Task 1: .dockerignore files

**Files:**
- Create: `backend/.dockerignore`
- Create: `stagehand-runner/.dockerignore`
- Create: `browser-use-runner/.dockerignore`
- Create: `frontend/.dockerignore`

**Interfaces:**
- Produces: nothing — consumed implicitly by every subsequent `docker build`

- [ ] **Step 1: Create backend/.dockerignore**

```
__pycache__/
*.pyc
*.pyo
venv/
.venv/
logs/
.env
.pytest_cache/
tests/
```

- [ ] **Step 2: Create stagehand-runner/.dockerignore**

```
node_modules/
dist/
runs/
logs/
.env
*.log
```

- [ ] **Step 3: Create browser-use-runner/.dockerignore**

```
__pycache__/
*.pyc
.venv/
runs/
logs/
.env
.runner.pid
```

- [ ] **Step 4: Create frontend/.dockerignore**

```
node_modules/
dist/
.env
```

- [ ] **Step 5: Commit**

```bash
git add backend/.dockerignore stagehand-runner/.dockerignore browser-use-runner/.dockerignore frontend/.dockerignore
git commit -m "chore: add .dockerignore files for all services"
```

---

### Task 2: backend Dockerfile

**Files:**
- Create: `backend/Dockerfile`

**Interfaces:**
- Produces: image with `uvicorn app.main:app` on port 8000, working dir `/app`

- [ ] **Step 1: Create backend/Dockerfile**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Build and verify**

Run from project root:
```bash
docker build -t qa-backend ./backend
```
Expected: build completes, no errors. Final line: `Successfully tagged qa-backend:latest` (or similar).

- [ ] **Step 3: Smoke-test the image starts**

```bash
docker run --rm -e LLM_API_KEY=test -e TESTIT_BASE_URL=http://x -e TESTIT_PRIVATE_TOKEN=x -p 18000:8000 qa-backend &
sleep 3
curl -s http://localhost:18000/health || curl -s http://localhost:18000/docs | head -5
docker stop $(docker ps -q --filter ancestor=qa-backend) 2>/dev/null || true
```
Expected: HTTP response received (200 or HTML from /docs).

- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile
git commit -m "feat(docker): add backend Dockerfile"
```

---

### Task 3: stagehand-runner Dockerfile

**Files:**
- Create: `stagehand-runner/Dockerfile`

**Interfaces:**
- Produces: image with `node dist/index.js` on port 8009, Chromium available via Playwright, `STAGEHAND_RUNS_DIR=/app/runs`

- [ ] **Step 1: Create stagehand-runner/Dockerfile**

```dockerfile
FROM mcr.microsoft.com/playwright:v1.60.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
ENV STAGEHAND_RUNS_DIR=/app/runs
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Build and verify**

```bash
docker build -t qa-stagehand ./stagehand-runner
```
Expected: build completes. TypeScript compilation succeeds (no tsc errors printed).

- [ ] **Step 3: Smoke-test the image starts**

```bash
docker run --rm \
  -e LLM_API_KEY=test \
  -e STAGEHAND_PORT=8009 \
  -e STAGEHAND_LLM_MODEL=gpt-4o \
  -p 18009:8009 qa-stagehand &
sleep 4
curl -s http://localhost:18009/runs
docker stop $(docker ps -q --filter ancestor=qa-stagehand) 2>/dev/null || true
```
Expected: `{"runs":[]}` returned from `/runs`.

- [ ] **Step 4: Commit**

```bash
git add stagehand-runner/Dockerfile
git commit -m "feat(docker): add stagehand-runner Dockerfile"
```

---

### Task 4: browser-use-runner Dockerfile

**Files:**
- Create: `browser-use-runner/Dockerfile`

**Interfaces:**
- Produces: image with `uvicorn main:app` on port 8008, Chromium installed, working dir `/app`

Note: this image takes ~5-10 min to build first time (downloads Chromium + browser-use from git).

- [ ] **Step 1: Create browser-use-runner/Dockerfile**

```dockerfile
FROM python:3.11-slim
WORKDIR /app

# git required for browser-use git dependency; curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

# Install Python dependencies (uses uv.lock for reproducibility)
COPY pyproject.toml uv.lock ./
RUN uv sync --all-extras --frozen

# Install Chromium + OS-level dependencies for Playwright
RUN uv run playwright install chromium --with-deps

COPY . .
ENV PYTHONPATH=/app
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8008"]
```

- [ ] **Step 2: Build and verify**

```bash
docker build -t qa-browser-runner ./browser-use-runner
```
Expected: build completes. `playwright install chromium --with-deps` installs Chromium without errors.

- [ ] **Step 3: Smoke-test the image starts**

```bash
docker run --rm \
  -e LLM_API_KEY=test \
  -e LLM_BASE_URL=https://api.openai.com/v1 \
  -p 18008:8008 qa-browser-runner &
sleep 4
curl -s -o /dev/null -w "%{http_code}" http://localhost:18008/docs
docker stop $(docker ps -q --filter ancestor=qa-browser-runner) 2>/dev/null || true
```
Expected: `200` printed.

- [ ] **Step 4: Commit**

```bash
git add browser-use-runner/Dockerfile
git commit -m "feat(docker): add browser-use-runner Dockerfile"
```

---

### Task 5: frontend Dockerfile + nginx + vite.config change

**Files:**
- Create: `frontend/Dockerfile`
- Create: `frontend/nginx.conf`
- Modify: `frontend/vite.config.ts` line with `target:`

**Interfaces:**
- Produces (prod target): nginx image serving `/usr/share/nginx/html`, proxying `/api/*` to `http://backend:8000`
- Produces (dev target): vite dev server on port 3000 with hot-reload

- [ ] **Step 1: Modify frontend/vite.config.ts**

Current content in proxy block:
```typescript
target: 'http://localhost:8000',
```

Change to:
```typescript
target: process.env.VITE_BACKEND_URL || 'http://localhost:8000',
```

Full file after change:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:8000',
        ws: true,
        changeOrigin: false,
      },
    },
  },
})
```

- [ ] **Step 2: Create frontend/nginx.conf**

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # Proxy API + WebSocket to backend
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 3: Create frontend/Dockerfile**

```dockerfile
# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Production stage (nginx) ─────────────────────────────────────────────────
FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

# ── Dev stage (vite hot-reload) ──────────────────────────────────────────────
FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host"]
```

- [ ] **Step 4: Build prod target and verify**

```bash
docker build -t qa-frontend-prod --target prod ./frontend
```
Expected: builds successfully, final image based on nginx:alpine.

- [ ] **Step 5: Smoke-test prod image**

```bash
docker run --rm -p 18080:80 qa-frontend-prod &
sleep 2
curl -s http://localhost:18080 | grep -c "<div id="
docker stop $(docker ps -q --filter ancestor=qa-frontend-prod) 2>/dev/null || true
```
Expected: `1` (the React app root div is present in the HTML).

- [ ] **Step 6: Build dev target and verify**

```bash
docker build -t qa-frontend-dev --target dev ./frontend
```
Expected: builds successfully.

- [ ] **Step 7: Commit**

```bash
git add frontend/Dockerfile frontend/nginx.conf frontend/vite.config.ts
git commit -m "feat(docker): add frontend Dockerfile, nginx config; read proxy target from env"
```

---

### Task 6: docker-compose.yml (base / prod)

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: all four Dockerfiles from Tasks 2-5
- Produces: `docker compose -f docker-compose.yml up` brings up all services; frontend at `:3000`, API docs at `:8000/docs`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
services:
  backend:
    build: ./backend
    env_file: .env
    environment:
      RUNNER_URL: http://stagehand-runner:8009
      AUDIT_RUNNER_URL: http://browser-use-runner:8008
    ports:
      - "8000:8000"
    networks: [qa-net]

  stagehand-runner:
    build: ./stagehand-runner
    env_file: .env
    ports:
      - "8009:8009"
    volumes:
      - stagehand_runs:/app/runs
    networks: [qa-net]

  browser-use-runner:
    build: ./browser-use-runner
    env_file: .env
    ports:
      - "8008:8008"
    volumes:
      - browser_runs:/app/runs
    networks: [qa-net]

  frontend:
    build:
      context: ./frontend
      target: prod
    ports:
      - "3000:80"
    depends_on:
      - backend
    networks: [qa-net]

networks:
  qa-net:

volumes:
  stagehand_runs:
  browser_runs:
```

- [ ] **Step 2: Validate compose config**

```bash
docker compose -f docker-compose.yml config
```
Expected: merged YAML printed with no errors.

- [ ] **Step 3: Build all images**

```bash
docker compose -f docker-compose.yml build
```
Expected: all 4 images build without errors.

- [ ] **Step 4: Start and verify**

```bash
docker compose -f docker-compose.yml up -d
sleep 10
curl -s http://localhost:3000 | grep -c "<div id="
curl -s http://localhost:8000/docs | grep -c "swagger"
docker compose -f docker-compose.yml down
```
Expected: both curl commands return `1`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(docker): add docker-compose.yml for all services"
```

---

### Task 7: docker-compose.override.yml (dev)

**Files:**
- Create: `docker-compose.override.yml`

**Interfaces:**
- Consumes: `docker-compose.yml` from Task 6
- Produces: `docker compose up` uses vite dev server, bind-mounts source, backend has `--reload`

- [ ] **Step 1: Create docker-compose.override.yml**

```yaml
services:
  backend:
    volumes:
      - ./backend:/app
    command:
      - uvicorn
      - app.main:app
      - --host
      - "0.0.0.0"
      - --port
      - "8000"
      - --reload

  stagehand-runner:
    volumes:
      - ./stagehand-runner/runs:/app/runs

  browser-use-runner:
    volumes:
      - ./browser-use-runner/runs:/app/runs

  frontend:
    build:
      context: ./frontend
      target: dev
    ports:
      - "3000:3000"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    environment:
      VITE_BACKEND_URL: http://backend:8000
```

- [ ] **Step 2: Validate merged config**

```bash
docker compose config
```
Expected: frontend shows `target: dev`, backend command contains `--reload`, no errors.

- [ ] **Step 3: Build and start dev stack**

```bash
docker compose up --build -d
sleep 15
curl -s http://localhost:3000 | grep -c "<div id="
curl -s http://localhost:8000/docs | grep -c "swagger"
docker compose down
```
Expected: both curl commands return `1`.

- [ ] **Step 4: Verify hot-reload works (manual)**

```bash
docker compose up -d
# Edit any file in frontend/src/ — browser should update without rebuild
docker compose down
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.override.yml
git commit -m "feat(docker): add docker-compose.override.yml for dev workflow"
```

---

### Task 8: README update

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces: team members can follow README to get the tool running from scratch

- [ ] **Step 1: Add Docker section to README.md**

Find the existing quickstart/setup section and add or replace with:

```markdown
## Quick Start (Docker)

**Requirements:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Linux/macOS/Windows)

```bash
# 1. Clone
git clone <repo-url> && cd qa-ai-tool

# 2. Configure
cp .env.example .env
# Edit .env: set LLM_API_KEY, TESTIT_BASE_URL, TESTIT_PRIVATE_TOKEN

# 3. Start (dev mode — hot-reload, bind-mounts)
docker compose up --build

# 4. Open
# http://localhost:3000
```

**Prod mode** (built frontend, no source mounts):
```bash
docker compose -f docker-compose.yml up --build
```

**Stop:**
```bash
docker compose down
```

**Screenshots and run history** persist in Docker named volumes between restarts.  
In dev mode they are also visible at `stagehand-runner/runs/` and `browser-use-runner/runs/`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Docker quick start to README"
```
