from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.queue_entities import (
    QueueNodeFinishedEvent,
    QueueNodeStartedEvent,
    QueueTextChunkEvent,
    QueueWorkflowFinishedEvent,
    QueueWorkflowStartedEvent,
)
from core.workflow.callbacks.base_workflow_callback import BaseWorkflowCallback
from core.workflow.entities.node_entities import NodeType
from models.workflow import Workflow, WorkflowNodeExecution, WorkflowRun


class WorkflowEventTriggerCallback(BaseWorkflowCallback):

    def __init__(self, queue_manager: AppQueueManager, workflow: Workflow):
        self._queue_manager = queue_manager
        self._streamable_node_ids = self._fetch_streamable_node_ids(workflow.graph)

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

    def on_node_text_chunk(self, node_id: str, text: str) -> None:
        """
        Publish text chunk
        """
        if node_id in self._streamable_node_ids:
            self._queue_manager.publish(
                QueueTextChunkEvent(
                    text=text
                ), PublishFrom.APPLICATION_MANAGER
            )

    def _fetch_streamable_node_ids(self, graph: dict) -> list[str]:
        """
        Fetch streamable node ids
        When the Workflow type is chat, only the nodes before END Node are LLM or Direct Answer can be streamed output
        When the Workflow type is workflow, only the nodes before END Node (only Plain Text mode) are LLM can be streamed output

        :param graph: workflow graph
        :return:
        """
        streamable_node_ids = []
        end_node_ids = []
        for node_config in graph.get('nodes'):
            if node_config.get('type') == NodeType.END.value:
                if node_config.get('data', {}).get('outputs', {}).get('type', '') == 'plain-text':
                    end_node_ids.append(node_config.get('id'))

        for edge_config in graph.get('edges'):
            if edge_config.get('target') in end_node_ids:
                streamable_node_ids.append(edge_config.get('source'))

        return streamable_node_ids
