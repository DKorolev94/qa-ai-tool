BACKEND_LOG  := backend/logs/uvicorn.log
RUNNER_LOG   := browser-use-runner/logs/runner.log

PORT_BACKEND  := 8000
PORT_RUNNER   := 8008
PORT_FRONTEND := 5173

# Kill process listening on a given port (safe no-op if nothing listening)
kill_port = lsof -t -i :$(1) 2>/dev/null | xargs -r kill 2>/dev/null || true

.PHONY: dev stop restart status logs-backend logs-runner help

## Start all services
dev:
	@$(MAKE) -s _start_backend
	@$(MAKE) -s _start_runner
	@$(MAKE) -s _start_frontend
	@echo ""
	@echo "  Backend   → http://localhost:$(PORT_BACKEND)  (api docs: /docs)"
	@echo "  Runner    → http://localhost:$(PORT_RUNNER)"
	@echo "  Frontend  → http://localhost:$(PORT_FRONTEND)"
	@echo ""
	@echo "  make stop    — stop all"
	@echo "  make status  — check status"

## Stop all services
stop:
	@$(CALL kill_port,$(PORT_BACKEND)); echo "Backend   stopped"
	@cd browser-use-runner && ./stop.sh
	@$(CALL kill_port,$(PORT_FRONTEND)); echo "Frontend  stopped"

## Restart all services
restart: stop dev

## Show running status
status:
	@printf "Backend   "; lsof -t -i :$(PORT_BACKEND) > /dev/null 2>&1 \
	  && echo "✓ http://localhost:$(PORT_BACKEND)" || echo "✗ stopped"
	@printf "Runner    "; lsof -t -i :$(PORT_RUNNER) > /dev/null 2>&1 \
	  && echo "✓ http://localhost:$(PORT_RUNNER)" || echo "✗ stopped"
	@printf "Frontend  "; lsof -t -i :$(PORT_FRONTEND) > /dev/null 2>&1 \
	  && echo "✓ http://localhost:$(PORT_FRONTEND)" || echo "✗ stopped"

## Tail backend log
logs-backend:
	tail -f $(BACKEND_LOG)

## Tail runner log
logs-runner:
	tail -f $(RUNNER_LOG)

## Show this help
help:
	@grep -E '^## ' Makefile | sed 's/^## /  /'

# ── Internal ──────────────────────────────────────────────────────────────────

_start_backend:
	@if lsof -t -i :$(PORT_BACKEND) > /dev/null 2>&1; then \
	  echo "Backend   already running"; \
	else \
	  mkdir -p backend/logs; \
	  (cd backend && source venv/bin/activate && \
	    uvicorn app.main:app --host 0.0.0.0 --port $(PORT_BACKEND) \
	    >> logs/uvicorn.log 2>&1) & \
	  echo "Backend   started → http://localhost:$(PORT_BACKEND)"; \
	fi

_start_runner:
	@cd browser-use-runner && ./start.sh

_start_frontend:
	@if lsof -t -i :$(PORT_FRONTEND) > /dev/null 2>&1; then \
	  echo "Frontend  already running"; \
	else \
	  (cd frontend && npm run dev > /dev/null 2>&1) & \
	  echo "Frontend  started → http://localhost:$(PORT_FRONTEND)"; \
	fi
