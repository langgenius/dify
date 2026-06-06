import logging
from typing import override

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
)

logger = logging.getLogger(__name__)
WF_STOP_DIAG_MARKER = "WF_STOP_DIAG_7B9C2F"


class MessageBasedAppQueueManager(AppQueueManager):
    def __init__(
        self, task_id: str, user_id: str, invoke_from: InvokeFrom, conversation_id: str, app_mode: str, message_id: str
    ):
        super().__init__(task_id, user_id, invoke_from)

        self._conversation_id = str(conversation_id)
        self._app_mode = app_mode
        self._message_id = str(message_id)

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

        logger.warning(
            "%s message_queue_publish task_id=%s message_id=%s event=%s pub_from=%s",
            WF_STOP_DIAG_MARKER,
            self._task_id,
            self._message_id,
            type(event).__name__,
            pub_from,
        )
        self._q.put(message)

        if isinstance(
            event, QueueStopEvent | QueueErrorEvent | QueueMessageEndEvent | QueueAdvancedChatMessageEndEvent
        ):
            self.stop_listen()

        if pub_from == PublishFrom.APPLICATION_MANAGER and self._is_stopped():
            logger.warning(
                "%s message_queue_raise_stopped task_id=%s message_id=%s event=%s",
                WF_STOP_DIAG_MARKER,
                self._task_id,
                self._message_id,
                type(event).__name__,
            )
            raise GenerateTaskStoppedError()
