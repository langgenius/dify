import runpy
import signal
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from gevent import events as gevent_events

from extensions import workflow_warm_shutdown


@pytest.fixture
def gunicorn_config() -> dict[str, object]:
    original_subscribers = list(gevent_events.subscribers)
    config_path = Path(__file__).parents[2] / "gunicorn.conf.py"
    try:
        return runpy.run_path(str(config_path))
    finally:
        gevent_events.subscribers[:] = original_subscribers


def test_post_worker_init_drains_workflows_before_gunicorn_sigterm(
    monkeypatch: pytest.MonkeyPatch,
    gunicorn_config: dict[str, object],
) -> None:
    calls: list[str] = []
    original_handler = MagicMock(side_effect=lambda *_: calls.append("gunicorn"))
    installed_handlers: dict[signal.Signals, object] = {}
    siginterrupt = MagicMock()
    begin_shutdown = MagicMock(side_effect=lambda **_: calls.append("workflow"))
    worker = MagicMock()

    monkeypatch.setattr(signal, "getsignal", lambda _signum: original_handler)
    monkeypatch.setattr(signal, "signal", lambda signum, handler: installed_handlers.__setitem__(signum, handler))
    monkeypatch.setattr(signal, "siginterrupt", siginterrupt)
    monkeypatch.setattr(workflow_warm_shutdown.dify_config, "WORKFLOW_HANDOFF_ENABLED", True)
    monkeypatch.setattr(workflow_warm_shutdown, "begin_workflow_warm_shutdown", begin_shutdown)

    post_worker_init = gunicorn_config["post_worker_init"]
    assert callable(post_worker_init)
    post_worker_init(worker)
    installed_handler = installed_handlers[signal.SIGTERM]
    assert callable(installed_handler)
    installed_handler(signal.SIGTERM, None)

    assert calls == ["workflow", "gunicorn"]
    begin_shutdown.assert_called_once_with(source="Gunicorn API worker")
    original_handler.assert_called_once_with(signal.SIGTERM, None)
    siginterrupt.assert_called_once_with(signal.SIGTERM, False)


def test_post_worker_init_preserves_gunicorn_sigterm_when_drain_setup_fails(
    monkeypatch: pytest.MonkeyPatch,
    gunicorn_config: dict[str, object],
) -> None:
    original_handler = MagicMock()
    installed_handlers: dict[signal.Signals, object] = {}
    worker = MagicMock()

    monkeypatch.setattr(signal, "getsignal", lambda _signum: original_handler)
    monkeypatch.setattr(signal, "signal", lambda signum, handler: installed_handlers.__setitem__(signum, handler))
    monkeypatch.setattr(signal, "siginterrupt", MagicMock())
    monkeypatch.setattr(workflow_warm_shutdown.dify_config, "WORKFLOW_HANDOFF_ENABLED", True)
    monkeypatch.setattr(
        workflow_warm_shutdown,
        "begin_workflow_warm_shutdown",
        MagicMock(side_effect=RuntimeError("drain setup failed")),
    )

    post_worker_init = gunicorn_config["post_worker_init"]
    assert callable(post_worker_init)
    post_worker_init(worker)
    installed_handler = installed_handlers[signal.SIGTERM]
    assert callable(installed_handler)
    installed_handler(signal.SIGTERM, None)

    worker.log.exception.assert_called_once_with("Failed to start workflow draining during Gunicorn SIGTERM")
    original_handler.assert_called_once_with(signal.SIGTERM, None)


def test_post_worker_init_is_noop_when_handoff_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
    gunicorn_config: dict[str, object],
) -> None:
    install_handler = MagicMock()
    monkeypatch.setattr(signal, "signal", install_handler)
    monkeypatch.setattr(workflow_warm_shutdown.dify_config, "WORKFLOW_HANDOFF_ENABLED", False)

    post_worker_init = gunicorn_config["post_worker_init"]
    assert callable(post_worker_init)
    post_worker_init(MagicMock())

    install_handler.assert_not_called()
