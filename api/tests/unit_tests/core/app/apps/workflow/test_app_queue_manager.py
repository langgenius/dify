from __future__ import annotations

import errno
from unittest.mock import patch

import pytest

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
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
        manager._is_stopped = lambda: True

        with pytest.raises(GenerateTaskStoppedError):
            manager._publish(QueueMessageEndEvent(llm_result=None), PublishFrom.APPLICATION_MANAGER)

    def test_publish_non_stop_event_does_not_raise(self):
        manager = WorkflowAppQueueManager(
            task_id="task",
            user_id="user",
            invoke_from=InvokeFrom.DEBUGGER,
            app_mode="workflow",
        )

        manager._publish(QueuePingEvent(), PublishFrom.TASK_PIPELINE)

    def test_publish_continues_when_stop_flag_check_hits_broken_pipe(self):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            mock_redis.get.side_effect = BrokenPipeError(errno.EPIPE, "Broken pipe")
            manager = WorkflowAppQueueManager(
                task_id="task",
                user_id="user",
                invoke_from=InvokeFrom.DEBUGGER,
                app_mode="workflow",
            )

            manager._publish(QueuePingEvent(), PublishFrom.APPLICATION_MANAGER)

        assert manager._q.qsize() == 1
