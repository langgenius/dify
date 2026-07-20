from unittest.mock import patch

import pytest

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueTextChunkEvent
from models.model import AppMode


def _message_queue_manager(app_mode: str) -> MessageBasedAppQueueManager:
    with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
        mock_redis.setex.return_value = True
        return MessageBasedAppQueueManager(
            task_id="task-1",
            user_id="user-1",
            invoke_from=InvokeFrom.DEBUGGER,
            conversation_id="conversation-1",
            app_mode=app_mode,
            message_id="message-1",
        )


def _workflow_queue_manager(app_mode: str) -> WorkflowAppQueueManager:
    with patch("core.app.apps.base_app_queue_manager.redis_client") as mock_redis:
        mock_redis.setex.return_value = True
        return WorkflowAppQueueManager(
            task_id="task-1",
            user_id="user-1",
            invoke_from=InvokeFrom.DEBUGGER,
            app_mode=app_mode,
        )


def test_message_queue_does_not_raise_legacy_stop_for_advanced_chat() -> None:
    manager = _message_queue_manager(AppMode.ADVANCED_CHAT.value)

    with patch.object(manager, "_is_stopped", return_value=True):
        manager.publish(QueueTextChunkEvent(text="chunk"), PublishFrom.APPLICATION_MANAGER)


def test_workflow_queue_does_not_read_legacy_stop_flag() -> None:
    manager = _workflow_queue_manager(AppMode.WORKFLOW.value)

    with patch.object(manager, "_is_stopped", return_value=True) as is_stopped:
        manager.publish(QueueTextChunkEvent(text="chunk"), PublishFrom.APPLICATION_MANAGER)

    is_stopped.assert_not_called()


def test_message_queue_keeps_legacy_stop_for_non_graphengine_chat() -> None:
    manager = _message_queue_manager(AppMode.CHAT.value)

    with patch.object(manager, "_is_stopped", return_value=True):
        with pytest.raises(GenerateTaskStoppedError):
            manager.publish(QueueTextChunkEvent(text="chunk"), PublishFrom.APPLICATION_MANAGER)
