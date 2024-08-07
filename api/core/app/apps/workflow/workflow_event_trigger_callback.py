from typing import Any, Optional

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueNodeFailedEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.workflow.callbacks.base_workflow_callback import WorkflowCallback
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeType
from models.workflow import Workflow


class WorkflowEventTriggerCallback(WorkflowCallback):

    def __init__(self, queue_manager: AppQueueManager, workflow: Workflow):
        self._queue_manager = queue_manager

    def on_workflow_run_started(self) -> None:
        """
        Workflow run started
        """
        self._queue_manager.publish(
            QueueWorkflowStartedEvent(),
            PublishFrom.APPLICATION_MANAGER
        )

    def on_workflow_run_succeeded(self) -> None:
        """
        Workflow run succeeded
        """
        self._queue_manager.publish(
            QueueWorkflowSucceededEvent(),
            PublishFrom.APPLICATION_MANAGER
        )

    def on_workflow_run_failed(self, error: str) -> None:
        """
        Workflow run failed
        """
        self._queue_manager.publish(
            QueueWorkflowFailedEvent(
                error=error
            ),
            PublishFrom.APPLICATION_MANAGER
        )

    def on_workflow_node_execute_started(self, node_id: str,
                                         node_type: NodeType,
                                         node_data: BaseNodeData,
                                         node_run_index: int = 1,
                                         predecessor_node_id: Optional[str] = None) -> None:
        """
        Workflow node execute started
        """
        self._queue_manager.publish(
            QueueNodeStartedEvent(
                node_id=node_id,
                node_type=node_type,
                node_data=node_data,
                node_run_index=node_run_index,
                predecessor_node_id=predecessor_node_id
            ),
            PublishFrom.APPLICATION_MANAGER
        )

    def on_workflow_node_execute_succeeded(self, node_id: str,
                                           node_type: NodeType,
                                           node_data: BaseNodeData,
                                           inputs: Optional[dict] = None,
                                           process_data: Optional[dict] = None,
                                           outputs: Optional[dict] = None,
                                           execution_metadata: Optional[dict] = None) -> None:
        """
        Workflow node execute succeeded
        """
        self._queue_manager.publish(
            QueueNodeSucceededEvent(
                node_id=node_id,
                node_type=node_type,
                node_data=node_data,
                inputs=inputs,
                process_data=process_data,
                outputs=outputs,
                execution_metadata=execution_metadata
            ),
            PublishFrom.APPLICATION_MANAGER
        )

    def on_workflow_node_execute_failed(self, node_id: str,
                                        node_type: NodeType,
                                        node_data: BaseNodeData,
                                        error: str,
                                        inputs: Optional[dict] = None,
                                        outputs: Optional[dict] = None,
                                        process_data: Optional[dict] = None) -> None:
        """
        Workflow node execute failed
        """
        self._queue_manager.publish(
            QueueNodeFailedEvent(
                node_id=node_id,
                node_type=node_type,
                node_data=node_data,
                inputs=inputs,
                outputs=outputs,
                process_data=process_data,
                error=error
            ),
            PublishFrom.APPLICATION_MANAGER
        )

    def on_node_text_chunk(self, node_id: str, text: str, metadata: Optional[dict] = None) -> None:
        """
        Publish text chunk
        """
        self._queue_manager.publish(
            QueueTextChunkEvent(
                text=text,
                metadata={
                    "node_id": node_id,
                    **metadata
                }
            ), PublishFrom.APPLICATION_MANAGER
        )

    def on_workflow_iteration_started(self, 
                                      node_id: str,
                                      node_type: NodeType,
                                      node_run_index: int = 1,
                                      node_data: Optional[BaseNodeData] = None,
                                      inputs: dict = None,
                                      predecessor_node_id: Optional[str] = None,
                                      metadata: Optional[dict] = None) -> None:
        """
        Publish iteration started
        """
        self._queue_manager.publish(
            QueueIterationStartEvent(
                node_id=node_id,
                node_type=node_type,
                node_run_index=node_run_index,
                node_data=node_data,
                inputs=inputs,
                predecessor_node_id=predecessor_node_id,
                metadata=metadata
            ),
            PublishFrom.APPLICATION_MANAGER
        )

    def on_workflow_iteration_next(self, node_id: str, 
                                   node_type: NodeType,
                                   index: int, 
                                   node_run_index: int,
                                   output: Optional[Any]) -> None:
        """
        Publish iteration next
        """
        self._queue_manager.publish(
            QueueIterationNextEvent(
                node_id=node_id,
                node_type=node_type,
                index=index,
                node_run_index=node_run_index,
                output=output
            ),
            PublishFrom.APPLICATION_MANAGER
        )

    def on_workflow_iteration_completed(self, node_id: str, 
                                        node_type: NodeType,
                                        node_run_index: int,
                                        outputs: dict) -> None:
        """
        Publish iteration completed
        """
        self._queue_manager.publish(
            QueueIterationCompletedEvent(
                node_id=node_id,
                node_type=node_type,
                node_run_index=node_run_index,
                outputs=outputs
            ),
            PublishFrom.APPLICATION_MANAGER
        )
        
    def on_event(self, event: AppQueueEvent) -> None:
        """
        Publish event
        """
        pass
