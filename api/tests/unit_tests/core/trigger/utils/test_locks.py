"""Tests for core.trigger.utils.locks — Redis lock key builders."""

from __future__ import annotations

from core.trigger.utils.locks import build_trigger_refresh_lock_key, build_trigger_refresh_lock_keys


class TestBuildTriggerRefreshLockKey:
    def test_correct_format(self):
        key = build_trigger_refresh_lock_key("tenant-1", "sub-1")

        assert key == "trigger_provider_refresh_lock:tenant-1_sub-1"


class TestBuildTriggerRefreshLockKeys:
    def test_maps_over_pairs(self):
        pairs = [("t1", "s1"), ("t2", "s2")]

        keys = build_trigger_refresh_lock_keys(pairs)

        assert len(keys) == 2
        assert keys[0] == "trigger_provider_refresh_lock:t1_s1"
        assert keys[1] == "trigger_provider_refresh_lock:t2_s2"
