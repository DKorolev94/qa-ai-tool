import json

import pytest

import cache_store


@pytest.fixture(autouse=True)
def _isolated_cache_dir(tmp_path, monkeypatch):
	monkeypatch.setattr(cache_store, 'CACHE_DIR', tmp_path)


def test_cache_path_builds_expected_layout(tmp_path):
	path = cache_store.cache_path('6110', '2026-07-03T10:13:18.472Z')
	assert path == tmp_path / '6110' / '2026-07-03T10:13:18.472Z' / 'history.json'


def test_load_cached_returns_none_when_missing():
	assert cache_store.load_cached('6110', '2026-07-03') is None


def test_save_then_load_roundtrip(tmp_path):
	source = tmp_path / 'source_history.json'
	source.write_text(json.dumps({'history': []}))

	cache_store.save_cached('6110', '2026-07-03', source)

	cached = cache_store.load_cached('6110', '2026-07-03')
	assert cached is not None
	assert json.loads(cached.read_text()) == {'history': []}


def test_save_overwrites_existing_entry(tmp_path):
	source_v1 = tmp_path / 'v1.json'
	source_v1.write_text(json.dumps({'history': ['old']}))
	source_v2 = tmp_path / 'v2.json'
	source_v2.write_text(json.dumps({'history': ['new']}))

	cache_store.save_cached('6110', '2026-07-03', source_v1)
	cache_store.save_cached('6110', '2026-07-03', source_v2)

	cached = cache_store.load_cached('6110', '2026-07-03')
	assert json.loads(cached.read_text()) == {'history': ['new']}


def test_save_creates_parent_directories(tmp_path):
	source = tmp_path / 'source.json'
	source.write_text('{}')
	assert not (tmp_path / 'new-test-case').exists()

	cache_store.save_cached('new-test-case', '2026-01-01', source)

	assert cache_store.load_cached('new-test-case', '2026-01-01') is not None
