"""Tests for core.trigger.utils.locks — Redis lock key builders."""

from __future__ import annotations

from core.trigger.utils.locks import build_trigger_refresh_lock_key


class TestBuildTriggerRefreshLockKey:
    def test_correct_format(self):
        key = build_trigger_refresh_lock_key("tenant-1", "sub-1")

        assert key == "trigger_provider_refresh_lock:tenant-1_sub-1"
