from core.app.app_queue_manager import AppQueueManager, PublishFrom
from core.workflow.callbacks.base_callback import BaseWorkflowCallback
from models.workflow import WorkflowRun, WorkflowNodeExecution


class WorkflowEventTriggerCallback(BaseWorkflowCallback):

    def __init__(self, queue_manager: AppQueueManager):
        self._queue_manager = queue_manager

    def on_workflow_run_started(self, workflow_run: WorkflowRun) -> None:
        """
        Workflow run started
        """
        self._queue_manager.publish_workflow_started(
            workflow_run_id=workflow_run.id,
            pub_from=PublishFrom.TASK_PIPELINE
        )

    def on_workflow_run_finished(self, workflow_run: WorkflowRun) -> None:
        """
        Workflow run finished
        """
        self._queue_manager.publish_workflow_finished(
            workflow_run_id=workflow_run.id,
            pub_from=PublishFrom.TASK_PIPELINE
        )

    def on_workflow_node_execute_started(self, workflow_node_execution: WorkflowNodeExecution) -> None:
        """
        Workflow node execute started
        """
        self._queue_manager.publish_node_started(
            workflow_node_execution_id=workflow_node_execution.id,
            pub_from=PublishFrom.TASK_PIPELINE
        )

    def on_workflow_node_execute_finished(self, workflow_node_execution: WorkflowNodeExecution) -> None:
        """
        Workflow node execute finished
        """
        self._queue_manager.publish_node_finished(
            workflow_node_execution_id=workflow_node_execution.id,
            pub_from=PublishFrom.TASK_PIPELINE
        )
