"""
Tests verifying that load_yaml_file_cached and get_position_map use unbounded
caches (functools.cache / lru_cache(maxsize=None)).

Background: both functions previously used @lru_cache(maxsize=128), which allowed
LRU eviction under load. Evicted entries triggered file re-opens, exhausting OS
file descriptors during high-concurrency benchmarks.

Fix: switch to functools.cache (equivalent to lru_cache(maxsize=None)) so that
static config files are read exactly once per process lifetime.
"""

from __future__ import annotations

import concurrent.futures
import threading
from pathlib import Path
from textwrap import dedent
from unittest.mock import patch

from core.helper.position_helper import get_position_map, get_tool_position_map
from core.tools.utils.yaml_utils import _load_yaml_file, load_yaml_file_cached

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_position_yaml(directory: Path, entries: list[str], file_name: str = "_position.yaml") -> Path:
    """Write a minimal _position.yaml into *directory* and return the file path."""
    directory.mkdir(parents=True, exist_ok=True)
    content = "\n".join(f"- {e}" for e in entries)
    f = directory / file_name
    f.write_text(content, encoding="utf-8")
    return f


# ---------------------------------------------------------------------------
# 1. Cache is unbounded (maxsize=None)
# ---------------------------------------------------------------------------


class TestCacheIsUnbounded:
    """The caches must be unlimited so LRU eviction can never happen."""

    def test_load_yaml_file_cached_maxsize_is_none(self):
        assert load_yaml_file_cached.cache_info().maxsize is None

    def test_get_position_map_maxsize_is_none(self):
        assert get_position_map.cache_info().maxsize is None

    def test_get_tool_position_map_maxsize_is_none(self):
        assert get_tool_position_map.cache_info().maxsize is None


# ---------------------------------------------------------------------------
# 2. No eviction: a file cached early stays cached after many other paths load
# ---------------------------------------------------------------------------


class TestNoEvictionUnderLoad:
    """
    With the old maxsize=128, reading 129 distinct paths would evict the first.
    With maxsize=None that must never happen.
    """

    def test_yaml_cache_retains_entry_after_many_other_paths(self, tmp_path: Path):
        load_yaml_file_cached.cache_clear()

        # Write and cache the "sentinel" file first.
        sentinel = tmp_path / "sentinel.yaml"
        sentinel.write_text("sentinel: true\n", encoding="utf-8")
        load_yaml_file_cached(str(sentinel))
        assert load_yaml_file_cached.cache_info().currsize == 1

        # Now fill the cache with 200 additional unique paths (well over the old 128 limit).
        extra_dir = tmp_path / "extra"
        extra_dir.mkdir()
        for i in range(200):
            f = extra_dir / f"extra_{i}.yaml"
            f.write_text(f"index: {i}\n", encoding="utf-8")
            load_yaml_file_cached(str(f))

        # The sentinel must still be in the cache (no eviction).
        hits_before = load_yaml_file_cached.cache_info().hits
        result = load_yaml_file_cached(str(sentinel))
        hits_after = load_yaml_file_cached.cache_info().hits

        assert result == {"sentinel": True}
        assert hits_after == hits_before + 1, "sentinel entry was evicted — cache is not unbounded"

    def test_position_map_retains_entry_after_many_folders(self, tmp_path: Path):
        get_position_map.cache_clear()
        load_yaml_file_cached.cache_clear()

        # Write and cache a sentinel position map.
        sentinel_dir = tmp_path / "sentinel_folder"
        _write_position_yaml(sentinel_dir, ["alpha", "beta", "gamma"])
        get_position_map(str(sentinel_dir))
        assert get_position_map.cache_info().currsize == 1

        # Load 200 more folders — more than the old 128-slot limit.
        for i in range(200):
            d = tmp_path / f"provider_{i}"
            _write_position_yaml(d, [f"tool_{i}_a", f"tool_{i}_b"])
            get_position_map(str(d))

        hits_before = get_position_map.cache_info().hits
        result = get_position_map(str(sentinel_dir))
        hits_after = get_position_map.cache_info().hits

        assert result == {"alpha": 0, "beta": 1, "gamma": 2}
        assert hits_after == hits_before + 1, "position_map entry was evicted — cache is not unbounded"


# ---------------------------------------------------------------------------
# 3. Each file is read from disk exactly once
# ---------------------------------------------------------------------------


class TestFileReadOnce:
    """After the first load, subsequent calls must not touch the filesystem."""

    def test_yaml_file_read_exactly_once(self, tmp_path: Path):
        load_yaml_file_cached.cache_clear()

        target = tmp_path / "once.yaml"
        target.write_text("key: value\n", encoding="utf-8")

        open_call_count = 0
        real_load = _load_yaml_file

        def counting_load(*, file_path: str):
            nonlocal open_call_count
            open_call_count += 1
            return real_load(file_path=file_path)

        with patch("core.tools.utils.yaml_utils._load_yaml_file", side_effect=counting_load):
            load_yaml_file_cached.cache_clear()
            for _ in range(10):
                load_yaml_file_cached(str(target))

        # The patch intercepts the first call; subsequent calls are served from cache.
        assert open_call_count == 1, f"File was read {open_call_count} times, expected 1"

    def test_position_map_read_exactly_once(self, tmp_path: Path):
        get_position_map.cache_clear()
        load_yaml_file_cached.cache_clear()

        folder = tmp_path / "once_folder"
        _write_position_yaml(folder, ["x", "y", "z"])

        open_call_count = 0
        real_load = _load_yaml_file

        def counting_load(*, file_path: str):
            nonlocal open_call_count
            open_call_count += 1
            return real_load(file_path=file_path)

        with patch("core.tools.utils.yaml_utils._load_yaml_file", side_effect=counting_load):
            load_yaml_file_cached.cache_clear()
            get_position_map.cache_clear()
            for _ in range(10):
                get_position_map(str(folder))

        assert open_call_count == 1, f"Position file was read {open_call_count} times, expected 1"


# ---------------------------------------------------------------------------
# 4. Concurrent access — no descriptor leak after the cache warms up
# ---------------------------------------------------------------------------


class TestConcurrentAccess:
    """
    Simulate N threads all hitting load_yaml_file_cached simultaneously for the
    same path (cold start). After the storm settles, every subsequent call must
    be a cache hit — no further file opens.
    """

    def test_concurrent_reads_all_hit_cache_afterward(self, tmp_path: Path):
        load_yaml_file_cached.cache_clear()

        target = tmp_path / "concurrent.yaml"
        target.write_text("concurrent: true\n", encoding="utf-8")

        THREADS = 50
        barrier = threading.Barrier(THREADS)
        results: list[dict] = []
        errors: list[Exception] = []

        def worker():
            try:
                barrier.wait()  # all threads start at the same time
                results.append(load_yaml_file_cached(str(target)))
            except Exception as exc:
                errors.append(exc)

        with concurrent.futures.ThreadPoolExecutor(max_workers=THREADS) as pool:
            futures = [pool.submit(worker) for _ in range(THREADS)]
            concurrent.futures.wait(futures)

        assert not errors, f"Errors during concurrent access: {errors}"
        assert len(results) == THREADS
        assert all(r == {"concurrent": True} for r in results)

        # After the initial concurrent storm, all further calls must be cache hits.
        hits_before = load_yaml_file_cached.cache_info().hits
        for _ in range(20):
            load_yaml_file_cached(str(target))
        hits_after = load_yaml_file_cached.cache_info().hits
        assert hits_after == hits_before + 20

    def test_concurrent_position_map_reads_are_consistent(self, tmp_path: Path):
        get_position_map.cache_clear()
        load_yaml_file_cached.cache_clear()

        folder = tmp_path / "concurrent_pos"
        _write_position_yaml(folder, ["first", "second", "third"])

        THREADS = 50
        barrier = threading.Barrier(THREADS)
        results: list[dict] = []
        errors: list[Exception] = []

        def worker():
            try:
                barrier.wait()
                results.append(get_position_map(str(folder)))
            except Exception as exc:
                errors.append(exc)

        with concurrent.futures.ThreadPoolExecutor(max_workers=THREADS) as pool:
            futures = [pool.submit(worker) for _ in range(THREADS)]
            concurrent.futures.wait(futures)

        assert not errors, f"Errors during concurrent position map access: {errors}"
        assert len(results) == THREADS
        expected = {"first": 0, "second": 1, "third": 2}
        assert all(r == expected for r in results), "Concurrent reads returned inconsistent results"


# ---------------------------------------------------------------------------
# 5. Correctness: cache returns the right data
# ---------------------------------------------------------------------------


class TestCacheCorrectnessAfterFix:
    """Sanity-check that the cached results are semantically correct."""

    def test_yaml_cached_value_matches_direct_read(self, tmp_path: Path):
        load_yaml_file_cached.cache_clear()

        f = tmp_path / "data.yaml"
        f.write_text(
            dedent("""\
            name: dify
            version: 1
            tags:
              - ai
              - llm
        """),
            encoding="utf-8",
        )

        cached = load_yaml_file_cached(str(f))
        direct = _load_yaml_file(file_path=str(f))
        assert cached == direct
        assert cached == {"name": "dify", "version": 1, "tags": ["ai", "llm"]}

    def test_position_map_cached_value_correct(self, tmp_path: Path):
        get_position_map.cache_clear()
        load_yaml_file_cached.cache_clear()

        folder = tmp_path / "pos_correct"
        _write_position_yaml(folder, ["google", "openai", "anthropic"])

        result = get_position_map(str(folder))
        assert result == {"google": 0, "openai": 1, "anthropic": 2}

    def test_position_map_skips_non_string_and_blank_entries(self, tmp_path: Path):
        get_position_map.cache_clear()
        load_yaml_file_cached.cache_clear()

        folder = tmp_path / "pos_mixed"
        f = folder / "_position.yaml"
        folder.mkdir()
        # Includes a numeric entry (9999) and blank lines — must be ignored.
        f.write_text(
            dedent("""\
            - valid_one
            - 9999
            -
            - valid_two
            -
        """),
            encoding="utf-8",
        )

        result = get_position_map(str(folder))
        assert "9999" not in result  # numeric entries stripped by isinstance check
        assert result == {"valid_one": 0, "valid_two": 1}

    def test_position_map_missing_file_returns_empty(self, tmp_path: Path):
        get_position_map.cache_clear()
        load_yaml_file_cached.cache_clear()

        empty_folder = tmp_path / "no_yaml_here"
        empty_folder.mkdir()

        result = get_position_map(str(empty_folder))
        assert result == {}

    def test_cache_info_tracks_hits_and_misses_correctly(self, tmp_path: Path):
        load_yaml_file_cached.cache_clear()

        f = tmp_path / "track.yaml"
        f.write_text("x: 1\n", encoding="utf-8")

        info_before = load_yaml_file_cached.cache_info()

        load_yaml_file_cached(str(f))  # miss
        load_yaml_file_cached(str(f))  # hit
        load_yaml_file_cached(str(f))  # hit

        info_after = load_yaml_file_cached.cache_info()
        assert info_after.misses == info_before.misses + 1
        assert info_after.hits == info_before.hits + 2
