#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BROWSER_USE_DIR="${BROWSER_USE_DIR:-$SCRIPT_DIR/.venv}"
PYTHON_BIN="${PYTHON_BIN:-$SCRIPT_DIR/.venv/bin/python}"
PID_FILE="$SCRIPT_DIR/.runner.pid"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "browser-use-runner is already running: pid=$OLD_PID"
    echo "health: http://localhost:${BROWSER_USE_RUNNER_PORT:-8008}/health"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
elif [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

HOST="${BROWSER_USE_RUNNER_HOST:-0.0.0.0}"
PORT="${BROWSER_USE_RUNNER_PORT:-8008}"

echo $$ > "$PID_FILE"

export PYTHONDONTWRITEBYTECODE=1
export PYTHONPATH="$SCRIPT_DIR${PYTHONPATH:+:$PYTHONPATH}"
exec "$PYTHON_BIN" -m uvicorn main:app --host "$HOST" --port "$PORT"
