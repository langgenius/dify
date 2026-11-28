import runpy
from pathlib import Path

import pytest
from gevent import events as gevent_events

from libs import gc_freeze


def test_worker_freezes_startup_objects_once_the_application_is_loaded(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(gc_freeze, "freeze_startup_objects", lambda: calls.append("freeze"))
    subscribers_before = list(gevent_events.subscribers)
    try:
        gunicorn_conf = runpy.run_path(str(Path(__file__).parents[2] / "gunicorn.conf.py"))
    finally:
        gevent_events.subscribers[:] = subscribers_before
    assert calls == []

    gunicorn_conf["post_worker_init"](object())

    assert calls == ["freeze"]
