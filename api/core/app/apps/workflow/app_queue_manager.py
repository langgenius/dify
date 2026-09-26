from typing import override

from configs import dify_config
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.execution_coordinator import AppExecutionState
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
        # #39602: a workflow run must follow WORKFLOW_MAX_EXECUTION_TIME
        # (configurable per app), not the chat-style APP_MAX_EXECUTION_TIME
        # default. Pass it explicitly so the AppExecutionCoordinator uses the
        # right cap from the moment the queue manager is constructed.
        super().__init__(
            task_id,
            user_id,
            invoke_from,
            listen_timeout=dify_config.WORKFLOW_MAX_EXECUTION_TIME,
        )

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

        if isinstance(event, QueueWorkflowPausedEvent):
            self.stop_listen(execution_state=AppExecutionState.PAUSED)
        elif isinstance(
            event,
            QueueStopEvent
            | QueueErrorEvent
            | QueueMessageEndEvent
            | QueueWorkflowSucceededEvent
            | QueueWorkflowFailedEvent
            | QueueWorkflowPartialSuccessEvent,
        ):
            self.stop_listen(execution_state=AppExecutionState.TERMINAL)
