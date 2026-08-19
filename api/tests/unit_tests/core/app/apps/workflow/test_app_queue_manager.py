from __future__ import annotations

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

    def test_execution_timeout_aborts_graph_before_stop_event(self):
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as queue_redis,
            patch("core.app.apps.execution_coordinator.redis_client") as execution_redis,
            patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
            patch("core.app.apps.execution_coordinator.dify_config.APP_MAX_EXECUTION_TIME", 0),
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
