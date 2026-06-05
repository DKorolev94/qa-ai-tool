#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/.runner.pid"
STOPPED=0

stop_pid() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return 1
  fi
  if kill -0 "$pid" 2>/dev/null; then
    echo "Stopping browser-use-runner: pid=$pid"
    kill "$pid" 2>/dev/null || true
    for _ in {1..30}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        STOPPED=1
        return 0
      fi
      sleep 0.2
    done
    echo "Process did not stop gracefully, sending SIGKILL: pid=$pid"
    kill -9 "$pid" 2>/dev/null || true
    STOPPED=1
  fi
}

if [[ -f "$PID_FILE" ]]; then
  stop_pid "$(cat "$PID_FILE" || true)" || true
  rm -f "$PID_FILE"
fi

while read -r pid; do
  [[ -n "$pid" ]] || continue
  stop_pid "$pid" || true
done < <(pgrep -f 'uvicorn main:app' || true)

if [[ "$STOPPED" == "1" ]]; then
  echo "browser-use-runner stopped"
else
  echo "browser-use-runner is not running"
fi
