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
    workflow_warm_shutdown._celery_warm_shutdown_started.clear()
    yield
    reset_active_workflow_tasks()
    workflow_warm_shutdown._celery_warm_shutdown_started.clear()


def _create_warm_shutdown_command_channel() -> CelerySignalCommandChannel:
    return CelerySignalCommandChannel(
        shutdown_state_getter=workflow_warm_shutdown.celery_warm_shutdown_started,
        abort_reason=workflow_warm_shutdown.WORKFLOW_WARM_SHUTDOWN_ABORT_REASON,
    )


def test_worker_shutting_down_skips_non_warm_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    mark_shutdown = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown, "mark_celery_warm_shutdown_started", mark_shutdown)

    workflow_warm_shutdown._on_worker_shutting_down(how="cold")

    mark_shutdown.assert_not_called()


def test_worker_shutting_down_marks_warm_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    mark_shutdown = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown, "mark_celery_warm_shutdown_started", mark_shutdown)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_count", lambda: 2)

    workflow_warm_shutdown._on_worker_shutting_down(how="warm")

    mark_shutdown.assert_called_once_with()


def test_warm_shutdown_state_tracks_started_flag() -> None:
    assert workflow_warm_shutdown.celery_warm_shutdown_started() is False

    workflow_warm_shutdown.mark_celery_warm_shutdown_started()

    assert workflow_warm_shutdown.celery_warm_shutdown_started() is True


def test_setup_configures_warm_shutdown_command_channel(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutting_down, "connect", MagicMock())
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutdown, "connect", MagicMock())

    workflow_warm_shutdown.setup_workflow_warm_shutdown_handler()
    workflow_warm_shutdown.mark_celery_warm_shutdown_started()

    commands = _create_warm_shutdown_command_channel().fetch_commands()

    assert len(commands) == 1
    assert isinstance(commands[0], AbortCommand)
    assert commands[0].reason == workflow_warm_shutdown.WORKFLOW_WARM_SHUTDOWN_ABORT_REASON


def test_warm_shutdown_command_stays_available_for_late_channels(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutting_down, "connect", MagicMock())
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutdown, "connect", MagicMock())

    workflow_warm_shutdown.setup_workflow_warm_shutdown_handler()
    workflow_warm_shutdown.mark_celery_warm_shutdown_started()

    first_channel = _create_warm_shutdown_command_channel()
    late_channel = _create_warm_shutdown_command_channel()

    assert len(first_channel.fetch_commands()) == 1
    assert len(late_channel.fetch_commands()) == 1


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


def test_setup_preserves_warm_shutdown_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutting_down, "connect", MagicMock())
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutdown, "connect", MagicMock())

    workflow_warm_shutdown.mark_celery_warm_shutdown_started()
    workflow_warm_shutdown.setup_workflow_warm_shutdown_handler()

    commands = _create_warm_shutdown_command_channel().fetch_commands()

    assert workflow_warm_shutdown.celery_warm_shutdown_started() is True
    assert len(commands) == 1
