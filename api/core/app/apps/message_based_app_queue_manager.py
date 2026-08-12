from typing import override

from configs import dify_config
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    MessageQueueMessage,
    QueueAdvancedChatMessageEndEvent,
    QueueErrorEvent,
    QueueMessageEndEvent,
    QueueStopEvent,
    QueueWorkflowPausedEvent,
)
from models.model import AppMode


class MessageBasedAppQueueManager(AppQueueManager):
    def __init__(
        self, task_id: str, user_id: str, invoke_from: InvokeFrom, conversation_id: str, app_mode: str, message_id: str
    ):
        super().__init__(task_id, user_id, invoke_from)

        self._conversation_id = str(conversation_id)
        self._app_mode = app_mode
        self._message_id = str(message_id)

    @property
    @override
    def _listen_timeout(self) -> int:
        if self._app_mode == AppMode.ADVANCED_CHAT.value:
            return dify_config.WORKFLOW_MAX_EXECUTION_TIME
        return dify_config.APP_MAX_EXECUTION_TIME

    @override
    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom):
        """
        Publish event to queue
        :param event:
        :param pub_from:
        :return:
        """
        message = MessageQueueMessage(
            task_id=self._task_id,
            message_id=self._message_id,
            conversation_id=self._conversation_id,
            app_mode=self._app_mode,
            event=event,
        )

        self._q.put(message)

        if isinstance(
            event,
            QueueStopEvent
            | QueueErrorEvent
            | QueueMessageEndEvent
            | QueueAdvancedChatMessageEndEvent
            | QueueWorkflowPausedEvent,
        ):
            self.stop_listen(execution_terminal=True)

        if pub_from == PublishFrom.APPLICATION_MANAGER and self._is_stopped():
            if self._app_mode == AppMode.ADVANCED_CHAT.value:
                return
            raise GenerateTaskStoppedError()
