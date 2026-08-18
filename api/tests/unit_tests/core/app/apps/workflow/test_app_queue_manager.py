from __future__ import annotations

from unittest.mock import patch

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueMessageEndEvent, QueuePingEvent, QueueStopEvent


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

    def test_listener_close_aborts_unfinished_execution(self):
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as redis_client,
            patch("core.app.apps.base_app_queue_manager.GraphEngineManager") as graph_engine_manager,
        ):
            redis_client.get.return_value = None
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

            graph_engine_manager.return_value.send_stop_command.assert_called_once_with(
                "task",
                reason="Client response stream closed before app execution completed",
            )

    def test_execution_timeout_aborts_graph_before_stop_event(self):
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as redis_client,
            patch("core.app.apps.base_app_queue_manager.GraphEngineManager") as graph_engine_manager,
            patch("core.app.apps.base_app_queue_manager.dify_config.APP_MAX_EXECUTION_TIME", 0),
        ):
            redis_client.get.return_value = None
            manager = WorkflowAppQueueManager(
                task_id="task",
                user_id="user",
                invoke_from=InvokeFrom.DEBUGGER,
                app_mode="workflow",
            )
            manager.publish(QueuePingEvent(), PublishFrom.TASK_PIPELINE)

            messages = list(manager.listen())

            assert any(isinstance(message.event, QueueStopEvent) for message in messages)
            graph_engine_manager.return_value.send_stop_command.assert_called_once_with(
                "task",
                reason="App execution exceeded 0 seconds",
            )

    def test_terminal_event_does_not_abort_completed_execution(self):
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as redis_client,
            patch("core.app.apps.base_app_queue_manager.GraphEngineManager") as graph_engine_manager,
        ):
            redis_client.get.return_value = None
            manager = WorkflowAppQueueManager(
                task_id="task",
                user_id="user",
                invoke_from=InvokeFrom.DEBUGGER,
                app_mode="workflow",
            )
            manager.publish(QueueMessageEndEvent(llm_result=None), PublishFrom.APPLICATION_MANAGER)

            _ = list(manager.listen())

            graph_engine_manager.return_value.send_stop_command.assert_not_called()
