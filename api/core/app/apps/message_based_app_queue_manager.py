from typing import override

from configs import dify_config
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.execution_coordinator import AppExecutionState
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
        # #39602: Advanced Chat runs a workflow under the hood, so it must
        # follow WORKFLOW_MAX_EXECUTION_TIME rather than the chat-style
        # APP_MAX_EXECUTION_TIME default. Other message-based app modes
        # (basic chat, completion, agent chat) keep the chat default.
        listen_timeout = (
            dify_config.WORKFLOW_MAX_EXECUTION_TIME
            if app_mode == AppMode.ADVANCED_CHAT.value
            else dify_config.APP_MAX_EXECUTION_TIME
        )
        super().__init__(task_id, user_id, invoke_from, listen_timeout=listen_timeout)

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

        self._q.put(message)

        if isinstance(event, QueueWorkflowPausedEvent):
            self.stop_listen(execution_state=AppExecutionState.PAUSED)
        elif isinstance(
            event, QueueStopEvent | QueueErrorEvent | QueueMessageEndEvent | QueueAdvancedChatMessageEndEvent
        ):
            execution_state = (
                AppExecutionState.PAUSED
                if self.execution_state is AppExecutionState.PAUSED
                else AppExecutionState.TERMINAL
            )
            self.stop_listen(execution_state=execution_state)

        if pub_from == PublishFrom.APPLICATION_MANAGER and self._is_stopped():
            if self._app_mode == AppMode.ADVANCED_CHAT.value:
                return
            raise GenerateTaskStoppedError()
