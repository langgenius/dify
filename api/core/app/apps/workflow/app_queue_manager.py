from typing import override

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueErrorEvent,
    QueueMessageEndEvent,
    QueueStopEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowSucceededEvent,
    WorkflowQueueMessage,
)


class WorkflowAppQueueManager(AppQueueManager):
    def __init__(self, task_id: str, user_id: str, invoke_from: InvokeFrom, app_mode: str):
        super().__init__(task_id, user_id, invoke_from)

        self._app_mode = app_mode

    @override
    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom):
        """
        Publish event to queue
        :param event:
        :param pub_from:
        :return:
        """
        message = WorkflowQueueMessage(task_id=self._task_id, app_mode=self._app_mode, event=event)

        self._q.put(message)

        # A pause ends only the current listener segment; the workflow stays PAUSED and
        # resumes with the same task ID. Without this marker, listen() cleanup calls
        # _abort_execution(), whose stop flag and abort command can stop the resumed run.
        # This is a compatibility workaround: cancellation policy belongs to the execution
        # owner, not the response-stream listener.
        if isinstance(
            event,
            QueueStopEvent
            | QueueErrorEvent
            | QueueMessageEndEvent
            | QueueWorkflowSucceededEvent
            | QueueWorkflowFailedEvent
            | QueueWorkflowPausedEvent
            | QueueWorkflowPartialSuccessEvent,
        ):
            self.stop_listen(execution_terminal=True)
