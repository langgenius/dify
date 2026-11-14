import gc

import pytest

from configs import dify_config
from libs import gc_freeze


def test_freeze_startup_objects_takes_live_objects_out_of_collections() -> None:
    held_for_the_process = [{"index": index} for index in range(100)]
    frozen_before = gc.get_freeze_count()
    try:
        gc_freeze.freeze_startup_objects()

        assert gc.get_freeze_count() >= frozen_before + len(held_for_the_process)
        assert not any(tracked is held_for_the_process for tracked in gc.get_objects())
    finally:
        gc.unfreeze()

    assert any(tracked is held_for_the_process for tracked in gc.get_objects())


def test_freeze_startup_objects_collects_before_it_freezes(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(gc_freeze.gc, "collect", lambda: calls.append("collect"))
    monkeypatch.setattr(gc_freeze.gc, "freeze", lambda: calls.append("freeze"))

    gc_freeze.freeze_startup_objects()

    assert calls == ["collect", "freeze"]


def test_freeze_startup_objects_can_be_turned_off(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(gc_freeze.gc, "collect", lambda: calls.append("collect"))
    monkeypatch.setattr(gc_freeze.gc, "freeze", lambda: calls.append("freeze"))
    monkeypatch.setattr(dify_config, "GC_FREEZE_AFTER_STARTUP", False)

    gc_freeze.freeze_startup_objects()

    assert calls == []
