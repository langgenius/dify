from unittest.mock import Mock, patch

from core.app.apps.execution_coordinator import AppExecutionCoordinator, AppExecutionState


def test_listener_close_does_not_abort_running_attempt() -> None:
    on_timeout = Mock()
    with (
        patch("core.app.apps.execution_coordinator.redis_client") as redis_client,
        patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
    ):
        coordinator = AppExecutionCoordinator(task_id="task", on_timeout=on_timeout, timeout_seconds=1200)

        coordinator.listener_closed(segment_completed=False)
        coordinator.listener_closed(segment_completed=False)

    assert coordinator.state is AppExecutionState.RUNNING
    redis_client.setex.assert_not_called()
    graph_engine_manager.return_value.send_stop_command.assert_not_called()
    on_timeout.assert_not_called()


def test_paused_attempt_ignores_listener_close_and_timeout() -> None:
    on_timeout = Mock()
    with (
        patch("core.app.apps.execution_coordinator.redis_client") as redis_client,
        patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
    ):
        coordinator = AppExecutionCoordinator(task_id="task", on_timeout=on_timeout, timeout_seconds=0)
        coordinator.mark_paused()

        coordinator.start_watchdog()
        coordinator.listener_closed(segment_completed=False)

    assert coordinator.state is AppExecutionState.PAUSED
    redis_client.setex.assert_not_called()
    graph_engine_manager.return_value.send_stop_command.assert_not_called()
    on_timeout.assert_not_called()


def test_watchdog_aborts_and_notifies_response_pipeline() -> None:
    on_timeout = Mock()
    with (
        patch("core.app.apps.execution_coordinator.redis_client") as redis_client,
        patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
    ):
        coordinator = AppExecutionCoordinator(task_id="task", on_timeout=on_timeout, timeout_seconds=0)

        coordinator.listener_closed(segment_completed=False)
        coordinator.start_watchdog()

    assert coordinator.state is AppExecutionState.ABORTING
    redis_client.setex.assert_called_once_with("generate_task_stopped:task", 600, 1)
    graph_engine_manager.return_value.send_stop_command.assert_called_once_with(
        "task",
        reason="App execution exceeded 0 seconds",
    )
    on_timeout.assert_called_once_with("App execution exceeded 0 seconds")


def test_pausing_started_attempt_cancels_watchdog() -> None:
    on_timeout = Mock()
    watchdog = Mock()
    with patch("core.app.apps.execution_coordinator.threading.Timer", return_value=watchdog):
        coordinator = AppExecutionCoordinator(task_id="task", on_timeout=on_timeout, timeout_seconds=1200)

        coordinator.start_watchdog()
        coordinator.mark_paused()

    watchdog.start.assert_called_once()
    watchdog.cancel.assert_called_once()
    assert coordinator.state is AppExecutionState.PAUSED


def test_stop_flag_failure_does_not_block_graph_stop(caplog) -> None:
    on_timeout = Mock()
    with (
        patch("core.app.apps.execution_coordinator.redis_client") as redis_client,
        patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
    ):
        redis_client.setex.side_effect = RuntimeError("redis write failed")
        coordinator = AppExecutionCoordinator(task_id="task", on_timeout=on_timeout, timeout_seconds=1200)

        coordinator.request_abort("test abort")

    graph_engine_manager.return_value.send_stop_command.assert_called_once_with(
        "task",
        reason="test abort",
    )
    assert "Failed to set stop flag for app execution task=task" in caplog.text
