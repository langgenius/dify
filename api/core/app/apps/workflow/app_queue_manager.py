from typing import TYPE_CHECKING, override

if TYPE_CHECKING:
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch

from services.dify_builder.native_testing.observation_adapters import NativeObservationGuard
from services.dify_builder.native_testing.observation_stream import (
    project_native_queue_event,
    require_native_observation,
)

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
    def __init__(
        self,
        task_id: str,
        user_id: str,
        invoke_from: InvokeFrom,
        app_mode: str,
        *,
        native_observation: NativeObservationGuard | None = None,
        native_host: "NativeHostLaunch | None" = None,
    ):
        require_native_observation(guard=native_observation)
        if native_host is not None:
            from services.dify_builder.native_testing.runtime import validate_projection_host

            validate_projection_host(host=native_host, guard=native_observation, task_id=task_id, user_id=user_id)
        self.native_host = native_host
        self.native_observation = native_observation
        super().__init__(task_id, user_id, invoke_from)

        self._app_mode = app_mode

    @override
    def publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        if self.native_observation is None:
            return super().publish(event, pub_from)
        with self.native_observation.persistence_scope():
            event = project_native_queue_event(
                guard=self.native_observation, event=event, native_host=self.native_host, queue=self
            )
            super().publish(event, pub_from)

    @override
    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom):
        """
        Publish event to queue
        :param event:
        :param pub_from:
        :return:
        """
        if self.native_observation is not None:
            event = project_native_queue_event(
                guard=self.native_observation, event=event, native_host=self.native_host, queue=self
            )
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
