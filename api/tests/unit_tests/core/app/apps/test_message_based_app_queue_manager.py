from unittest.mock import Mock, patch

import pytest

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import (
    QueueErrorEvent,
    QueueMessageEndEvent,
    QueueStopEvent,
    QueueWorkflowMaintenancePausedEvent,
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

    @pytest.mark.parametrize(
        "pause_event",
        [QueueWorkflowPausedEvent(), QueueWorkflowMaintenancePausedEvent()],
    )
    def test_pause_events_finish_the_local_execution_segment(self, pause_event):
        with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
            mock_redis.setex.return_value = True
            manager = MessageBasedAppQueueManager(
                task_id="t1",
                user_id="u1",
                invoke_from=InvokeFrom.SERVICE_API,
                conversation_id="c1",
                app_mode="advanced-chat",
                message_id="m1",
            )

        manager.stop_listen = Mock()
        manager._is_stopped = Mock(return_value=False)

        manager._publish(pause_event, PublishFrom.APPLICATION_MANAGER)

        manager.stop_listen.assert_called_once_with(
            execution_terminal=not isinstance(pause_event, QueueWorkflowMaintenancePausedEvent)
        )

    def test_maintenance_pause_does_not_leave_a_stale_abort_command(self):
        with (
            patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis,
            patch("core.app.apps.base_app_queue_manager.GraphEngineManager") as graph_engine_manager,
        ):
            mock_redis.setex.return_value = True
            mock_redis.get.return_value = None
            manager = MessageBasedAppQueueManager(
                task_id="t1",
                user_id="u1",
                invoke_from=InvokeFrom.SERVICE_API,
                conversation_id="c1",
                app_mode="advanced-chat",
                message_id="m1",
            )

            pause_event = QueueWorkflowMaintenancePausedEvent()
            manager.publish(pause_event, PublishFrom.APPLICATION_MANAGER)
            listener = manager.listen()
            message = next(listener)
            manager.mark_execution_terminal()
            messages = [message, *listener]

            assert len(messages) == 1
            assert messages[0].event is pause_event
            graph_engine_manager.return_value.send_stop_command.assert_not_called()
