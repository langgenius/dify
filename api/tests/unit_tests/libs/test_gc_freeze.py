import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from configs import dify_config
from libs import gc_freeze


def test_freeze_startup_objects_takes_live_objects_out_of_collections() -> None:
    # Unfreezing in pytest would undo the session's collection-time freeze for every later test.
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            textwrap.dedent("""\
                import gc
                from configs import dify_config
                from libs.gc_freeze import freeze_startup_objects

                dify_config.GC_FREEZE_AFTER_STARTUP = True
                gc.collect()
                gc.freeze()
                held = [[] for _ in range(100)]
                before = gc.get_freeze_count()
                freeze_startup_objects()
                assert gc.get_freeze_count() >= before + len(held)
                assert not any(obj is held for obj in gc.get_objects())
                gc.unfreeze()
                assert any(obj is held for obj in gc.get_objects())
            """),
        ],
        cwd=Path(__file__).parents[3],
        env={**os.environ, "PYTHONPATH": str(Path(__file__).parents[3])},
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr


def test_freeze_startup_objects_collects_before_it_freezes(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(gc_freeze.gc, "collect", lambda: calls.append("collect"))
    monkeypatch.setattr(gc_freeze.gc, "freeze", lambda: calls.append("freeze"))
    monkeypatch.setattr(dify_config, "GC_FREEZE_AFTER_STARTUP", True)

    gc_freeze.freeze_startup_objects()

    assert calls == ["collect", "freeze"]


def test_freeze_startup_objects_can_be_turned_off(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(gc_freeze.gc, "collect", lambda: calls.append("collect"))
    monkeypatch.setattr(gc_freeze.gc, "freeze", lambda: calls.append("freeze"))
    monkeypatch.setattr(dify_config, "GC_FREEZE_AFTER_STARTUP", False)

    gc_freeze.freeze_startup_objects()

    assert calls == []
