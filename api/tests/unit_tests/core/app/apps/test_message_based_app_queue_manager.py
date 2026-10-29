import threading
from collections.abc import Iterator
from unittest.mock import Mock, patch

import pytest

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.execution_coordinator import AppExecutionState
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueAdvancedChatMessageEndEvent,
    QueueErrorEvent,
    QueueMessageEndEvent,
    QueueStopEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)


@pytest.fixture
def chatflow_manager() -> Iterator[MessageBasedAppQueueManager]:
    manager = MessageBasedAppQueueManager(
        task_id="t1",
        user_id="u1",
        invoke_from=InvokeFrom.DEBUGGER,
        conversation_id="c1",
        app_mode="advanced-chat",
        message_id="m1",
    )
    try:
        yield manager
    finally:
        watchdog = manager._execution_coordinator._watchdog
        if watchdog is not None:
            watchdog.cancel()
            watchdog.join(timeout=1)


class TestMessageBasedAppQueueManager:
    @pytest.mark.parametrize(
        "event",
        [
            QueueWorkflowSucceededEvent(outputs={"answer": "done"}),
            QueueWorkflowPartialSuccessEvent(exceptions_count=1),
            QueueWorkflowFailedEvent(error="node failed", exceptions_count=1),
        ],
        ids=["succeeded", "partial-success", "failed"],
    )
    def test_workflow_terminal_event_cancels_watchdog_and_finishes_listener(
        self, chatflow_manager: MessageBasedAppQueueManager, event: AppQueueEvent
    ) -> None:
        manager = chatflow_manager
        manager.publish(QueueWorkflowStartedEvent(), PublishFrom.APPLICATION_MANAGER)
        listener = manager.listen()
        assert isinstance(next(listener).event, QueueWorkflowStartedEvent)
        watchdog = manager._execution_coordinator._watchdog
        assert isinstance(watchdog, threading.Timer)
        assert watchdog.is_alive()
        assert not watchdog.finished.is_set()

        manager.publish(event, PublishFrom.APPLICATION_MANAGER)

        assert manager.execution_state is AppExecutionState.TERMINAL
        assert manager._execution_coordinator._watchdog is None
        assert watchdog.finished.is_set()
        watchdog.join(timeout=1)
        assert not watchdog.is_alive()
        assert [message.event for message in listener] == [event]
        assert manager._q.empty()

    def test_workflow_start_and_response_detach_keep_execution_running(
        self, chatflow_manager: MessageBasedAppQueueManager
    ) -> None:
        manager = chatflow_manager
        manager.publish(QueueWorkflowStartedEvent(), PublishFrom.APPLICATION_MANAGER)
        listener = manager.listen()

        assert isinstance(next(listener).event, QueueWorkflowStartedEvent)
        assert manager.execution_state is AppExecutionState.RUNNING
        watchdog = manager._execution_coordinator._watchdog
        assert isinstance(watchdog, threading.Timer)
        assert watchdog.is_alive()
        assert not watchdog.finished.is_set()

        listener.close()

        assert manager.execution_state is AppExecutionState.RUNNING
        assert manager._execution_coordinator._watchdog is watchdog
        assert watchdog.is_alive()
        assert not watchdog.finished.is_set()

    def test_publish_stops_on_terminal_events(self) -> None:
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

    def test_publish_raises_when_stopped(self) -> None:
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

    def test_publish_enqueues_message_end(self) -> None:
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

    def test_publish_pause_event_marks_listener_as_paused(self) -> None:
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

    def test_pause_state_is_preserved_when_advanced_chat_message_ends(
        self, chatflow_manager: MessageBasedAppQueueManager
    ) -> None:
        manager = chatflow_manager
        with (
            patch("core.app.apps.execution_coordinator.redis_client") as execution_redis,
            patch("core.app.apps.execution_coordinator.send_abort_command") as send_abort_command,
        ):
            manager.publish(QueueWorkflowStartedEvent(), PublishFrom.APPLICATION_MANAGER)
            listener = manager.listen()
            assert isinstance(next(listener).event, QueueWorkflowStartedEvent)
            watchdog = manager._execution_coordinator._watchdog
            assert isinstance(watchdog, threading.Timer)
            assert watchdog.is_alive()
            assert not watchdog.finished.is_set()

            manager.publish(
                QueueWorkflowPausedEvent(reasons=[], outputs={}, paused_nodes=["human-input"]),
                PublishFrom.APPLICATION_MANAGER,
            )
            manager.publish(QueueAdvancedChatMessageEndEvent(), PublishFrom.TASK_PIPELINE)
            messages = list(listener)

            assert isinstance(messages[0].event, QueueWorkflowPausedEvent)
            assert manager.execution_state is AppExecutionState.PAUSED
            assert manager._execution_coordinator._watchdog is None
            assert watchdog.finished.is_set()
            watchdog.join(timeout=1)
            assert not watchdog.is_alive()
            execution_redis.setex.assert_not_called()
            send_abort_command.assert_not_called()
