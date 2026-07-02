import logging
from unittest.mock import MagicMock

import pytest

from extensions import workflow_warm_shutdown


def test_worker_shutting_down_skips_non_warm_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    send_abort = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown, "send_celery_warm_shutdown_abort_commands", send_abort)

    workflow_warm_shutdown._on_worker_shutting_down(how="cold")

    send_abort.assert_not_called()


def test_worker_shutting_down_sets_abort_command_for_warm_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    send_abort = MagicMock(return_value=2)
    monkeypatch.setattr(workflow_warm_shutdown, "send_celery_warm_shutdown_abort_commands", send_abort)

    workflow_warm_shutdown._on_worker_shutting_down(how="warm")

    send_abort.assert_called_once_with()


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
