from __future__ import annotations

from unittest.mock import patch

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueMessageEndEvent, QueuePingEvent


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
