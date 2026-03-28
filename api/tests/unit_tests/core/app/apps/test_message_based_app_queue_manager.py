from unittest.mock import Mock, patch

import pytest

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueErrorEvent, QueueMessageEndEvent, QueueStopEvent


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
