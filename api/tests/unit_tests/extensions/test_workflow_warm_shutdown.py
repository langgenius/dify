import logging
from unittest.mock import MagicMock, call

import pytest

from extensions import workflow_warm_shutdown


def test_worker_shutting_down_skips_non_warm_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    get_task_ids = MagicMock(return_value=("task-a",))
    manager_cls = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_ids", get_task_ids)
    monkeypatch.setattr(workflow_warm_shutdown, "GraphEngineManager", manager_cls)

    workflow_warm_shutdown._on_worker_shutting_down(how="cold")

    get_task_ids.assert_not_called()
    manager_cls.assert_not_called()


def test_worker_shutting_down_sends_stop_commands_for_warm_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = MagicMock()
    manager_cls = MagicMock(return_value=manager)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_ids", lambda: ("task-a", "task-b"))
    monkeypatch.setattr(workflow_warm_shutdown, "GraphEngineManager", manager_cls)
    monkeypatch.setattr(workflow_warm_shutdown, "redis_client", object())

    workflow_warm_shutdown._on_worker_shutting_down(how="warm")

    assert manager.send_stop_command.call_args_list == [
        call("task-a", reason=workflow_warm_shutdown.WORKFLOW_WARM_SHUTDOWN_ABORT_REASON),
        call("task-b", reason=workflow_warm_shutdown.WORKFLOW_WARM_SHUTDOWN_ABORT_REASON),
    ]


def test_worker_shutting_down_continues_after_stop_command_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = MagicMock()
    manager.send_stop_command.side_effect = [RuntimeError("boom"), None]
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_ids", lambda: ("task-a", "task-b"))
    monkeypatch.setattr(workflow_warm_shutdown, "GraphEngineManager", MagicMock(return_value=manager))
    monkeypatch.setattr(workflow_warm_shutdown, "redis_client", object())

    workflow_warm_shutdown._on_worker_shutting_down(how="warm")

    assert manager.send_stop_command.call_count == 2


def test_worker_shutdown_logs_when_all_tracked_tasks_ended(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger=workflow_warm_shutdown.logger.name)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_ids", lambda: ())

    workflow_warm_shutdown._on_worker_shutdown()

    assert "after all tracked workflow tasks ended" in caplog.text


def test_worker_shutdown_logs_remaining_tracked_tasks(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger=workflow_warm_shutdown.logger.name)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_ids", lambda: ("task-a", "task-b"))

    workflow_warm_shutdown._on_worker_shutdown()

    assert "with 2 workflow task(s) still active after warm shutdown wait" in caplog.text
