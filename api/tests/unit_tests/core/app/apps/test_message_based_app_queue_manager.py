from unittest.mock import Mock, patch

import pytest

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.execution_coordinator import AppExecutionState
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import (
    QueueAdvancedChatMessageEndEvent,
    QueueErrorEvent,
    QueueMessageEndEvent,
    QueueStopEvent,
    QueueWorkflowPausedEvent,
)


class TestMessageBasedAppQueueManager:
    def test_publish_stops_on_terminal_events(self):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            manager = MessageBasedAppQueueManager(
                task_id="t1",
                user_id="u1",
                invoke_from=InvokeFrom.SERVICE_API,
                conversation_id="c1",
                app_mode="chat",
                message_id="m1",
            )

        manager.stop_listen = Mock()
        manager._is_stopped = Mock(return_value=False)

        manager._publish(QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL), Mock())
        manager.stop_listen.assert_called_once()

    def test_publish_raises_when_stopped(self):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            manager = MessageBasedAppQueueManager(
                task_id="t1",
                user_id="u1",
                invoke_from=InvokeFrom.SERVICE_API,
                conversation_id="c1",
                app_mode="chat",
                message_id="m1",
            )

        manager._is_stopped = Mock(return_value=True)

        with pytest.raises(GenerateTaskStoppedError):
            manager._publish(QueueErrorEvent(error=ValueError("boom")), PublishFrom.APPLICATION_MANAGER)

    def test_publish_enqueues_message_end(self):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            manager = MessageBasedAppQueueManager(
                task_id="t1",
                user_id="u1",
                invoke_from=InvokeFrom.SERVICE_API,
                conversation_id="c1",
                app_mode="chat",
                message_id="m1",
            )

        manager._is_stopped = Mock(return_value=False)
        manager.stop_listen = Mock()

        manager._publish(QueueMessageEndEvent(), PublishFrom.TASK_PIPELINE)

        assert manager._q.qsize() == 1

    def test_publish_pause_event_marks_listener_as_paused(self):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            manager = MessageBasedAppQueueManager(
                task_id="t1",
                user_id="u1",
                invoke_from=InvokeFrom.DEBUGGER,
                conversation_id="c1",
                app_mode="advanced-chat",
                message_id="m1",
            )
        manager.stop_listen = Mock()
        manager._is_stopped = Mock(return_value=False)

        manager._publish(QueueWorkflowPausedEvent(), PublishFrom.APPLICATION_MANAGER)

        manager.stop_listen.assert_called_once_with(execution_state=AppExecutionState.PAUSED)

    def test_pause_state_is_preserved_when_advanced_chat_message_ends(self):
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as queue_redis,
            patch("core.app.apps.execution_coordinator.redis_client") as execution_redis,
            patch("core.app.apps.execution_coordinator.GraphEngineManager") as graph_engine_manager,
        ):
            queue_redis.get.return_value = None
            manager = MessageBasedAppQueueManager(
                task_id="t1",
                user_id="u1",
                invoke_from=InvokeFrom.DEBUGGER,
                conversation_id="c1",
                app_mode="advanced-chat",
                message_id="m1",
            )

            manager.publish(
                QueueWorkflowPausedEvent(reasons=[], outputs={}, paused_nodes=["human-input"]),
                PublishFrom.APPLICATION_MANAGER,
            )
            manager.publish(QueueAdvancedChatMessageEndEvent(), PublishFrom.TASK_PIPELINE)
            messages = list(manager.listen())

            assert isinstance(messages[0].event, QueueWorkflowPausedEvent)
            assert manager.execution_state is AppExecutionState.PAUSED
            execution_redis.setex.assert_not_called()
            graph_engine_manager.return_value.send_stop_command.assert_not_called()
