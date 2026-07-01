import logging
from unittest.mock import MagicMock, call

import pytest

from extensions import workflow_warm_shutdown


def _run_thread_target_immediately(target, args):
    target(*args)
    return 1


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
    redis = MagicMock()
    create_redis = MagicMock(return_value=redis)
    start_thread = MagicMock(side_effect=_run_thread_target_immediately)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_ids", lambda: ("task-a", "task-b"))
    monkeypatch.setattr(workflow_warm_shutdown, "GraphEngineManager", manager_cls)
    monkeypatch.setattr(workflow_warm_shutdown, "create_redis_client", create_redis)
    monkeypatch.setattr(workflow_warm_shutdown, "_start_native_thread", start_thread)

    workflow_warm_shutdown._on_worker_shutting_down(how="warm")

    assert manager.send_stop_command.call_args_list == [
        call("task-a", reason=workflow_warm_shutdown.WORKFLOW_WARM_SHUTDOWN_ABORT_REASON),
        call("task-b", reason=workflow_warm_shutdown.WORKFLOW_WARM_SHUTDOWN_ABORT_REASON),
    ]
    manager_cls.assert_called_once_with(redis)
    create_redis.assert_called_once_with()
    redis.close.assert_called_once_with()
    start_thread.assert_called_once()


def test_worker_shutting_down_continues_after_stop_command_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = MagicMock()
    manager.send_stop_command.side_effect = [RuntimeError("boom"), None]
    redis = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_ids", lambda: ("task-a", "task-b"))
    monkeypatch.setattr(workflow_warm_shutdown, "GraphEngineManager", MagicMock(return_value=manager))
    monkeypatch.setattr(workflow_warm_shutdown, "create_redis_client", MagicMock(return_value=redis))
    monkeypatch.setattr(workflow_warm_shutdown, "_start_native_thread", _run_thread_target_immediately)

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
