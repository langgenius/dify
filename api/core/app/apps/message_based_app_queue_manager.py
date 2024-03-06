from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueMessage,
)


class MessageBasedAppQueueManager(AppQueueManager):
    def __init__(self, task_id: str,
                 user_id: str,
                 invoke_from: InvokeFrom,
                 conversation_id: str,
                 app_mode: str,
                 message_id: str) -> None:
        super().__init__(task_id, user_id, invoke_from)

        self._conversation_id = str(conversation_id)
        self._app_mode = app_mode
        self._message_id = str(message_id)

    def construct_queue_message(self, event: AppQueueEvent) -> QueueMessage:
        return QueueMessage(
            task_id=self._task_id,
            message_id=self._message_id,
            conversation_id=self._conversation_id,
            app_mode=self._app_mode,
            event=event
        )
