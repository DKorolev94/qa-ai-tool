BACKEND_LOG      := backend/logs/uvicorn.log
RUNNER_LOG       := browser-use-runner/logs/runner.log
STAGEHAND_LOG    := stagehand-runner/logs/runner.log

PORT_BACKEND     := 8000
PORT_RUNNER      := 8008
PORT_STAGEHAND   := 8009
PORT_FRONTEND    := 3000

NODE_BIN         := $(shell command -v node 2>/dev/null || find "$(HOME)/.vscode-server/bin" -mindepth 2 -maxdepth 2 -type f -name node -print -quit)

kill_port = lsof -t -i :$(1) 2>/dev/null | xargs -r kill 2>/dev/null || true

.PHONY: dev stop restart status logs-backend logs-runner logs-stagehand help \
        docker-dev docker-prod docker-stop docker-restart

## Start all services
dev:
	@$(MAKE) -s _start_backend
	@$(MAKE) -s _start_stagehand
	@$(MAKE) -s _start_runner
	@$(MAKE) -s _start_frontend
	@echo ""
	@echo "  Backend        → http://localhost:$(PORT_BACKEND)  (api docs: /docs)"
	@echo "  Stagehand      → http://localhost:$(PORT_STAGEHAND)"
	@echo "  Audit runner   → http://localhost:$(PORT_RUNNER)"
	@echo "  Frontend       → http://localhost:$(PORT_FRONTEND)"
	@echo ""
	@echo "  make stop    — stop all"
	@echo "  make status  — check status"

## Stop all services
stop:
	@$(call kill_port,$(PORT_BACKEND)); echo "Backend        stopped"
	@$(call kill_port,$(PORT_STAGEHAND)); echo "Stagehand      stopped"
	@cd browser-use-runner && ./stop.sh
	@$(call kill_port,$(PORT_FRONTEND)); echo "Frontend       stopped"

## Restart all services
restart: stop dev

## Show running status
status:
	@printf "Backend        "; lsof -t -i :$(PORT_BACKEND) > /dev/null 2>&1 \
	  && echo "✓ http://localhost:$(PORT_BACKEND)" || echo "✗ stopped"
	@printf "Stagehand      "; lsof -t -i :$(PORT_STAGEHAND) > /dev/null 2>&1 \
	  && echo "✓ http://localhost:$(PORT_STAGEHAND)" || echo "✗ stopped"
	@printf "Audit runner   "; lsof -t -i :$(PORT_RUNNER) > /dev/null 2>&1 \
	  && echo "✓ http://localhost:$(PORT_RUNNER)" || echo "✗ stopped"
	@printf "Frontend       "; lsof -t -i :$(PORT_FRONTEND) > /dev/null 2>&1 \
	  && echo "✓ http://localhost:$(PORT_FRONTEND)" || echo "✗ stopped"

## Tail backend log
logs-backend:
	tail -f $(BACKEND_LOG)

## Tail runner (audit) log
logs-runner:
	tail -f $(RUNNER_LOG)

## Tail stagehand log
logs-stagehand:
	tail -f $(STAGEHAND_LOG)

## Docker dev: hot-reload, bind mounts (Linux + macOS)
docker-dev:
	docker compose up --build

## Docker prod: built frontend via nginx, named volumes
docker-prod:
	docker compose -f docker-compose.prod.yml up --build

## Docker: stop all containers
docker-stop:
	docker compose down

## Docker: restart dev
docker-restart: docker-stop docker-dev

## Show this help
help:
	@grep -E '^## ' Makefile | sed 's/^## /  /'

# ── Internal ──────────────────────────────────────────────────────────────────

_start_backend:
	@if lsof -t -i :$(PORT_BACKEND) > /dev/null 2>&1; then \
	  echo "Backend        already running"; \
	else \
	  mkdir -p backend/logs; \
	  setsid sh -c 'cd backend && . venv/bin/activate && \
	    exec uvicorn app.main:app --host 0.0.0.0 --port $(PORT_BACKEND)' \
	    >> $(BACKEND_LOG) 2>&1 & \
	  echo "Backend        started → http://localhost:$(PORT_BACKEND)"; \
	fi

_start_stagehand:
	@if lsof -t -i :$(PORT_STAGEHAND) > /dev/null 2>&1; then \
	  echo "Stagehand      already running"; \
	elif [ -z "$(NODE_BIN)" ]; then \
	  echo "Stagehand      failed: Linux node not found"; \
	else \
	  mkdir -p stagehand-runner/logs; \
	  setsid sh -c 'cd stagehand-runner && exec "$(NODE_BIN)" dist/index.js' \
	    > stagehand-runner/logs/runner.log 2>&1 & \
	  echo "Stagehand      started → http://localhost:$(PORT_STAGEHAND)"; \
	fi

_start_runner:
	@if lsof -t -i :$(PORT_RUNNER) > /dev/null 2>&1; then \
	  echo "Audit runner   already running"; \
	else \
	  mkdir -p browser-use-runner/logs; \
	  setsid browser-use-runner/start.sh >> browser-use-runner/logs/runner.log 2>&1 & \
	  echo "Audit runner   started → http://localhost:$(PORT_RUNNER)"; \
	fi

_start_frontend:
	@if lsof -t -i :$(PORT_FRONTEND) > /dev/null 2>&1; then \
	  echo "Frontend       already running"; \
	elif [ -z "$(NODE_BIN)" ]; then \
	  echo "Frontend       failed: Linux node not found"; \
	else \
	  mkdir -p frontend/logs; \
	  setsid sh -c 'cd frontend && exec "$(NODE_BIN)" node_modules/vite/bin/vite.js --host 0.0.0.0 --port $(PORT_FRONTEND)' \
	    > frontend/logs/npm.log 2>&1 & \
	  echo "Frontend       started → http://localhost:$(PORT_FRONTEND)"; \
	fi
