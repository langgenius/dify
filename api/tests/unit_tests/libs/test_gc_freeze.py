import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from configs import dify_config
from configs.deploy import DeploymentConfig
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


def test_freeze_startup_objects_is_off_unless_configured() -> None:
    # Shorter full collections come with more of them; deployments opt in for the shorter pauses.
    assert DeploymentConfig.model_fields["GC_FREEZE_AFTER_STARTUP"].default is False


_STARTUP_HOOKS = {
    "gunicorn-post-worker-init": """\
        import runpy
        gunicorn_conf = runpy.run_path("gunicorn.conf.py")

        def start():
            gunicorn_conf["post_worker_init"](object())
    """,
    "celery-worker-ready": """\
        from celery.signals import worker_ready
        import extensions.ext_celery

        def start():
            worker_ready.send(sender=object())
    """,
}


@pytest.mark.parametrize("hook", sorted(_STARTUP_HOOKS))
def test_cycles_created_after_a_startup_hook_are_still_collected(hook: str) -> None:
    # A real hook in a child process, so freezing never touches the test runner's heap.
    script = textwrap.dedent(_STARTUP_HOOKS[hook]) + textwrap.dedent("""\
        import gc
        import weakref

        class Probe:
            pass

        held_at_startup = Probe()
        start()
        assert gc.get_freeze_count() > 0, "the hook did not freeze the startup objects"
        assert not any(obj is held_at_startup for obj in gc.get_objects())

        created_later = Probe()
        created_later.cycle = created_later
        created_later_ref = weakref.ref(created_later)
        del created_later
        gc.collect()
        assert created_later_ref() is None, "a cycle created after startup was not collected"
    """)
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).parents[3],
        env={**os.environ, "PYTHONPATH": str(Path(__file__).parents[3]), "GC_FREEZE_AFTER_STARTUP": "true"},
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
