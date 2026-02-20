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


class MessageBasedAppQueueManager(AppQueueManager):
    def __init__(
        self, task_id: str, user_id: str, invoke_from: InvokeFrom, conversation_id: str, app_mode: str, message_id: str
    ):
        super().__init__(task_id, user_id, invoke_from)

        self._conversation_id = str(conversation_id)
        self._app_mode = app_mode
        self._message_id = str(message_id)

        # Terminal event delay to prevent race condition (fixes #31611)
        self._terminal_event_delay = 0.05

    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom):
        """
        Publish event to queue with improved synchronization.

        This method includes a small delay before stopping to prevent race conditions
        where messages could be lost during queue shutdown (fixes #31611).
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
            event, QueueStopEvent | QueueErrorEvent | QueueMessageEndEvent | QueueAdvancedChatMessageEndEvent
        ):
            # Add delay to allow concurrent publishes to complete
            # This prevents the race condition where:
            # 1. Thread A is about to publish a LLMChunkEvent
            # 2. Thread B publishes MessageEndEvent and calls stop_listen()
            # 3. Thread A's message never gets processed
            time.sleep(self._terminal_event_delay)

            # Wait for queue to be reasonably empty before stopping
            self._wait_for_queue_flush(timeout=1.0)

            self.stop_listen()

        if pub_from == PublishFrom.APPLICATION_MANAGER and self._is_stopped():
            raise GenerateTaskStoppedError()

    def _wait_for_queue_flush(self, timeout: float = 1.0):
        """
        Wait for the queue to be flushed (or timeout).

        This gives the consumer a chance to process pending messages (fixes #31611).
        """
        start_time = time.time()
        check_interval = 0.01  # 10ms

        while time.time() - start_time < timeout:
            # Check if queue is empty or nearly empty
            if self._q.qsize() <= 1:  # Allow for the terminal event itself
                break
            time.sleep(check_interval)
