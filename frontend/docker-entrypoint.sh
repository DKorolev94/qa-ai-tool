#!/bin/sh
set -e

HASH_FILE="node_modules/.package-lock.sha1"
CURRENT_HASH=$(sha1sum package-lock.json | cut -d' ' -f1)

if [ ! -f "$HASH_FILE" ] || [ "$CURRENT_HASH" != "$(cat "$HASH_FILE")" ]; then
  echo "Dependencies changed, running npm ci..."
  npm ci
  echo "$CURRENT_HASH" > "$HASH_FILE"
else
  echo "Dependencies up to date."
fi

exec "$@"
