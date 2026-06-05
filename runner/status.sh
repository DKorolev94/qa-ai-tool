#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/.runner.pid"
PORT="${BROWSER_USE_RUNNER_PORT:-8008}"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" || true)"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "browser-use-runner: running pid=$PID"
    curl -fsS "http://localhost:$PORT/health" || true
    echo
    exit 0
  fi
  echo "browser-use-runner: stale pid file"
  rm -f "$PID_FILE"
fi

if pgrep -f 'uvicorn main:app' >/dev/null; then
  echo "browser-use-runner: running without pid file"
  pgrep -af 'uvicorn main:app'
  curl -fsS "http://localhost:$PORT/health" || true
  echo
  exit 0
fi

echo "browser-use-runner: stopped"
exit 3
