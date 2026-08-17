from __future__ import annotations

import hashlib
import os
import re
import shutil
import time
import uuid
from pathlib import Path

RUNNER_DIR = Path(__file__).resolve().parent
CACHE_DIR = Path(os.environ.get('RUNNER_CACHE_DIR', str(RUNNER_DIR / 'cache')))
# 0 (default) = cache never expires on its own — only busts on cache_key change
# (modifiedDate/locale/device). A cached recording can otherwise replay
# indefinitely against a page that changed without the test case being edited.
CACHE_TTL_HOURS = float(os.environ.get('RUNNER_CACHE_TTL_HOURS') or 0)


def _sanitize_component(value: str) -> str:
	# Same allowlist as main.create_run_dir — blocks path traversal ('..', '/')
	# through test_case_id/cache_key, which come straight from the request body.
	# cache_key embeds free-text locale (e.g. "ru RU" vs "ru_RU"), so two distinct
	# raw values can sanitize to the same string — a hash of the original value
	# disambiguates them instead of silently sharing one cache entry.
	cleaned = re.sub(r'[^a-zA-Z0-9_.-]+', '_', value).strip('._-') or '_'
	digest = hashlib.sha1(value.encode()).hexdigest()[:8]
	return f'{cleaned}-{digest}'


def cache_path(test_case_id: str, cache_key: str) -> Path:
	return CACHE_DIR / _sanitize_component(test_case_id) / _sanitize_component(cache_key) / 'history.json'


def load_cached(test_case_id: str, cache_key: str) -> Path | None:
	path = cache_path(test_case_id, cache_key)
	if not path.is_file():
		return None
	if CACHE_TTL_HOURS > 0:
		age_hours = (time.time() - path.stat().st_mtime) / 3600
		if age_hours > CACHE_TTL_HOURS:
			return None
	return path


def save_cached(test_case_id: str, cache_key: str, history_json_path: Path) -> None:
	final_path = cache_path(test_case_id, cache_key)
	final_path.parent.mkdir(parents=True, exist_ok=True)
	tmp_path = final_path.with_name(f'{final_path.name}.{uuid.uuid4().hex[:8]}.tmp')
	shutil.copyfile(history_json_path, tmp_path)
	os.replace(tmp_path, final_path)
