import logging
from unittest.mock import MagicMock

import pytest

from core.app.apps.workflow.active_workflow_tasks import reset_active_workflow_tasks
from core.app.apps.workflow.command_channels import CelerySignalCommandChannel
from extensions import workflow_warm_shutdown
from graphon.graph_engine.entities.commands import AbortCommand


@pytest.fixture(autouse=True)
def reset_warm_shutdown_state() -> None:
    reset_active_workflow_tasks()
    workflow_warm_shutdown.reset_celery_warm_shutdown_state()
    yield
    reset_active_workflow_tasks()
    workflow_warm_shutdown.reset_celery_warm_shutdown_state()


def test_worker_shutting_down_skips_non_warm_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    set_abort = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown, "set_celery_warm_shutdown_abort_command", set_abort)

    workflow_warm_shutdown._on_worker_shutting_down(how="cold")

    set_abort.assert_not_called()


def test_worker_shutting_down_sets_abort_command_for_warm_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    set_abort = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown, "set_celery_warm_shutdown_abort_command", set_abort)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_count", lambda: 2)

    workflow_warm_shutdown._on_worker_shutting_down(how="warm")

    set_abort.assert_called_once_with()


def test_warm_shutdown_sets_abort_command() -> None:
    workflow_warm_shutdown.set_celery_warm_shutdown_abort_command()
    commands = CelerySignalCommandChannel().fetch_commands()

    assert len(commands) == 1
    assert isinstance(commands[0], AbortCommand)
    assert commands[0].reason == workflow_warm_shutdown.WORKFLOW_WARM_SHUTDOWN_ABORT_REASON
    assert CelerySignalCommandChannel().fetch_commands() == commands


def test_warm_shutdown_abort_command_stays_available_for_late_channels() -> None:
    workflow_warm_shutdown.set_celery_warm_shutdown_abort_command(reason="worker shutdown")

    commands = CelerySignalCommandChannel().fetch_commands()

    assert len(commands) == 1
    assert isinstance(commands[0], AbortCommand)
    assert commands[0].reason == "worker shutdown"


def test_worker_shutdown_logs_when_all_workflow_runs_ended(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger=workflow_warm_shutdown.logger.name)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_count", lambda: 0)

    workflow_warm_shutdown._on_worker_shutdown()

    assert "after all tracked workflow runs ended" in caplog.text


def test_worker_shutdown_logs_remaining_workflow_runs(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger=workflow_warm_shutdown.logger.name)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_count", lambda: 2)

    workflow_warm_shutdown._on_worker_shutdown()

    assert "with 2 workflow run(s) still active after warm shutdown wait" in caplog.text


def test_setup_connects_shutdown_handlers(monkeypatch: pytest.MonkeyPatch) -> None:
    connect_shutting_down = MagicMock()
    connect_shutdown = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutting_down, "connect", connect_shutting_down)
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutdown, "connect", connect_shutdown)

    workflow_warm_shutdown.setup_workflow_warm_shutdown_handler()

    connect_shutting_down.assert_called_once()
    connect_shutdown.assert_called_once()


def test_setup_resets_stale_abort_command(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutting_down, "connect", MagicMock())
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutdown, "connect", MagicMock())

    workflow_warm_shutdown.set_celery_warm_shutdown_abort_command(reason="stale")
    workflow_warm_shutdown.setup_workflow_warm_shutdown_handler()

    assert CelerySignalCommandChannel().fetch_commands() == []
