from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.queue_entities import (
    QueueNodeFinishedEvent,
    QueueNodeStartedEvent,
    QueueTextChunkEvent,
    QueueWorkflowFinishedEvent,
    QueueWorkflowStartedEvent,
)
from core.workflow.callbacks.base_workflow_callback import BaseWorkflowCallback
from models.workflow import WorkflowNodeExecution, WorkflowRun


class WorkflowEventTriggerCallback(BaseWorkflowCallback):

    def __init__(self, queue_manager: AppQueueManager):
        self._queue_manager = queue_manager

    def on_workflow_run_started(self, workflow_run: WorkflowRun) -> None:
        """
        Workflow run started
        """
        self._queue_manager.publish(
            QueueWorkflowStartedEvent(workflow_run_id=workflow_run.id),
            PublishFrom.APPLICATION_MANAGER
        )

    def on_workflow_run_finished(self, workflow_run: WorkflowRun) -> None:
        """
        Workflow run finished
        """
        self._queue_manager.publish(
            QueueWorkflowFinishedEvent(workflow_run_id=workflow_run.id),
            PublishFrom.APPLICATION_MANAGER
        )

    def on_workflow_node_execute_started(self, workflow_node_execution: WorkflowNodeExecution) -> None:
        """
        Workflow node execute started
        """
        self._queue_manager.publish(
            QueueNodeStartedEvent(workflow_node_execution_id=workflow_node_execution.id),
            PublishFrom.APPLICATION_MANAGER
        )

    def on_workflow_node_execute_finished(self, workflow_node_execution: WorkflowNodeExecution) -> None:
        """
        Workflow node execute finished
        """
        self._queue_manager.publish(
            QueueNodeFinishedEvent(workflow_node_execution_id=workflow_node_execution.id),
            PublishFrom.APPLICATION_MANAGER
        )


    def on_text_chunk(self, text: str) -> None:
        """
        Publish text chunk
        """
        self._queue_manager.publish(
            QueueTextChunkEvent(
                text=text
            ), PublishFrom.APPLICATION_MANAGER
        )
