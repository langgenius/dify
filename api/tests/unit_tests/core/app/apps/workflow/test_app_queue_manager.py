from __future__ import annotations

from collections.abc import Callable
from unittest.mock import Mock, patch

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.execution_coordinator import AppExecutionState
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import (
    QueueMessageEndEvent,
    QueuePingEvent,
    QueueStopEvent,
    QueueWorkflowPausedEvent,
)


class TestWorkflowAppQueueManager:
    def test_publish_stop_events_trigger_stop(self):
        manager = WorkflowAppQueueManager(
            task_id="task",
            user_id="user",
            invoke_from=InvokeFrom.DEBUGGER,
            app_mode="workflow",
        )

        with (
            patch.object(manager, "_is_stopped", return_value=True) as is_stopped,
            patch.object(manager, "stop_listen") as stop_listen,
        ):
            manager._publish(QueueMessageEndEvent(llm_result=None), PublishFrom.APPLICATION_MANAGER)

        stop_listen.assert_called_once()
        is_stopped.assert_not_called()

    def test_publish_non_stop_event_does_not_raise(self):
        manager = WorkflowAppQueueManager(
            task_id="task",
            user_id="user",
            invoke_from=InvokeFrom.DEBUGGER,
            app_mode="workflow",
        )

        manager._publish(QueuePingEvent(), PublishFrom.TASK_PIPELINE)

    def test_publish_pause_event_marks_listener_as_paused(self):
        manager = WorkflowAppQueueManager(
            task_id="task",
            user_id="user",
            invoke_from=InvokeFrom.DEBUGGER,
            app_mode="workflow",
        )
        manager.stop_listen = Mock()

        manager._publish(QueueWorkflowPausedEvent(), PublishFrom.APPLICATION_MANAGER)

        manager.stop_listen.assert_called_once_with(execution_state=AppExecutionState.PAUSED)

    def test_listener_close_does_not_abort_unfinished_execution(self):
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as queue_redis,
            patch("core.app.apps.execution_coordinator.redis_client") as execution_redis,
            patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
        ):
            queue_redis.get.return_value = None
            manager = WorkflowAppQueueManager(
                task_id="task",
                user_id="user",
                invoke_from=InvokeFrom.DEBUGGER,
                app_mode="workflow",
            )
            manager.publish(QueuePingEvent(), PublishFrom.TASK_PIPELINE)
            listener = manager.listen()

            assert isinstance(next(listener).event, QueuePingEvent)
            listener.close()

            assert manager.execution_state is AppExecutionState.RUNNING
            execution_redis.setex.assert_not_called()
            graph_engine_manager.return_value.send_stop_command.assert_not_called()
            manager._execution_coordinator.mark_terminal()

    def test_execution_timeout_aborts_graph_before_stop_event(self, config_overrides: Callable[..., None]):
        # #39602: WorkflowAppQueueManager follows WORKFLOW_MAX_EXECUTION_TIME,
        # not APP_MAX_EXECUTION_TIME. Setting WORKFLOW_MAX_EXECUTION_TIME=0
        # is the right knob to trip the watchdog for a workflow run.
        config_overrides(WORKFLOW_MAX_EXECUTION_TIME=0)
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as queue_redis,
            patch("core.app.apps.execution_coordinator.redis_client") as execution_redis,
            patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
        ):
            queue_redis.get.return_value = None
            manager = WorkflowAppQueueManager(
                task_id="task",
                user_id="user",
                invoke_from=InvokeFrom.DEBUGGER,
                app_mode="workflow",
            )
            manager.publish(QueuePingEvent(), PublishFrom.TASK_PIPELINE)

            messages = list(manager.listen())

            assert any(isinstance(message.event, QueueStopEvent) for message in messages)
            execution_redis.setex.assert_called_once_with("generate_task_stopped:task", 600, 1)
            graph_engine_manager.return_value.send_stop_command.assert_called_once_with(
                "task",
                reason="App execution exceeded 0 seconds",
            )

    def test_terminal_event_does_not_abort_completed_execution(self):
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as queue_redis,
            patch("core.app.apps.execution_coordinator.redis_client") as execution_redis,
            patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
        ):
            queue_redis.get.return_value = None
            manager = WorkflowAppQueueManager(
                task_id="task",
                user_id="user",
                invoke_from=InvokeFrom.DEBUGGER,
                app_mode="workflow",
            )
            manager.publish(QueueMessageEndEvent(llm_result=None), PublishFrom.APPLICATION_MANAGER)

            _ = list(manager.listen())

            execution_redis.setex.assert_not_called()
            graph_engine_manager.return_value.send_stop_command.assert_not_called()

    def test_pause_completes_listener_without_aborting_resumable_execution(self):
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as queue_redis,
            patch("core.app.apps.execution_coordinator.redis_client") as execution_redis,
            patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
        ):
            queue_redis.get.return_value = None
            manager = WorkflowAppQueueManager(
                task_id="task",
                user_id="user",
                invoke_from=InvokeFrom.DEBUGGER,
                app_mode="workflow",
            )
            manager.publish(
                QueueWorkflowPausedEvent(reasons=[], outputs={}, paused_nodes=["human-input"]),
                PublishFrom.APPLICATION_MANAGER,
            )

            messages = list(manager.listen())

            assert len(messages) == 1
            assert isinstance(messages[0].event, QueueWorkflowPausedEvent)
            assert manager.execution_state is AppExecutionState.PAUSED
            execution_redis.setex.assert_not_called()
            graph_engine_manager.return_value.send_stop_command.assert_not_called()

    def test_workflow_pause_does_not_abort_execution(self):
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as queue_redis,
            patch("core.app.apps.execution_coordinator.redis_client") as execution_redis,
            patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
        ):
            queue_redis.get.return_value = None
            manager = WorkflowAppQueueManager(
                task_id="task",
                user_id="user",
                invoke_from=InvokeFrom.DEBUGGER,
                app_mode="workflow",
            )
            manager.publish(QueueWorkflowPausedEvent(), PublishFrom.APPLICATION_MANAGER)
            listener = manager.listen()

            assert isinstance(next(listener).event, QueueWorkflowPausedEvent)
            listener.close()

            assert manager.execution_state is AppExecutionState.PAUSED
            execution_redis.setex.assert_not_called()
            graph_engine_manager.return_value.send_stop_command.assert_not_called()

    def test_listen_timeout_uses_workflow_max_execution_time(self, config_overrides: Callable[..., None]):
        # #39602: a workflow run must follow WORKFLOW_MAX_EXECUTION_TIME,
        # not the chat-style APP_MAX_EXECUTION_TIME default.
        config_overrides(WORKFLOW_MAX_EXECUTION_TIME=3600, APP_MAX_EXECUTION_TIME=1200)
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client"),
            patch("core.app.apps.execution_coordinator.redis_client"),
        ):
            manager = WorkflowAppQueueManager(
                task_id="task",
                user_id="user",
                invoke_from=InvokeFrom.DEBUGGER,
                app_mode="workflow",
            )

        assert manager._listen_timeout == 3600
        assert manager._execution_coordinator._timeout_seconds == 3600

    def test_listen_timeout_falls_back_when_workflow_setting_equals_app(self, config_overrides: Callable[..., None]):
        # When WORKFLOW_MAX_EXECUTION_TIME is left at its APP_MAX_EXECUTION_TIME
        # default we should still expose the workflow knob (not a stale value).
        config_overrides(WORKFLOW_MAX_EXECUTION_TIME=1800, APP_MAX_EXECUTION_TIME=1200)
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client"),
            patch("core.app.apps.execution_coordinator.redis_client"),
        ):
            manager = WorkflowAppQueueManager(
                task_id="task",
                user_id="user",
                invoke_from=InvokeFrom.DEBUGGER,
                app_mode="workflow",
            )

        assert manager._listen_timeout == 1800
        assert manager._execution_coordinator._timeout_seconds == 1800
