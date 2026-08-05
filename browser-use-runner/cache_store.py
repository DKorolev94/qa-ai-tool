from __future__ import annotations

import os
import shutil
from pathlib import Path

RUNNER_DIR = Path(__file__).resolve().parent
CACHE_DIR = Path(os.environ.get('RUNNER_CACHE_DIR', str(RUNNER_DIR / 'cache')))


def cache_path(test_case_id: str, cache_key: str) -> Path:
	return CACHE_DIR / test_case_id / cache_key / 'history.json'


def load_cached(test_case_id: str, cache_key: str) -> Path | None:
	path = cache_path(test_case_id, cache_key)
	return path if path.is_file() else None


def save_cached(test_case_id: str, cache_key: str, history_json_path: Path) -> None:
	final_path = cache_path(test_case_id, cache_key)
	final_path.parent.mkdir(parents=True, exist_ok=True)
	tmp_path = final_path.with_name(final_path.name + '.tmp')
	shutil.copyfile(history_json_path, tmp_path)
	os.replace(tmp_path, final_path)
