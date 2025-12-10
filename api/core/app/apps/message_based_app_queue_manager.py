import time

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
from core.moderation.moderation_coordinator import ModerationCoordinator


class MessageBasedAppQueueManager(AppQueueManager):
    def __init__(
        self, task_id: str, user_id: str, invoke_from: InvokeFrom, conversation_id: str, app_mode: str, message_id: str
    ):
        super().__init__(task_id, user_id, invoke_from)

        self._conversation_id = str(conversation_id)
        self._app_mode = app_mode
        self._message_id = str(message_id)

    def set_moderation_coordinator(self, moderation_coordinator: ModerationCoordinator | None):
        self.moderation_coordinator: ModerationCoordinator | None = moderation_coordinator

    def stop_when_ready(self, poll_ms=50):
        if self.moderation_coordinator is not None:
            while not self.moderation_coordinator.ready_to_close():
                time.sleep(poll_ms / 1000.0)

        self.stop_listen()

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

        if isinstance(event, QueueMessageEndEvent | QueueAdvancedChatMessageEndEvent):
            self.stop_when_ready()
        elif isinstance(event, QueueStopEvent | QueueErrorEvent):
            self.stop_listen()

        if pub_from == PublishFrom.APPLICATION_MANAGER and self._is_stopped():
            raise GenerateTaskStoppedError()
