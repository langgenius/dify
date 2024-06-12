from abc import ABC, abstractmethod
from typing import Any, Optional

from core.app.entities.queue_entities import AppQueueEvent
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeType


class BaseWorkflowCallback(ABC):
    @abstractmethod
    def on_workflow_run_started(self) -> None:
        """
        Workflow run started
        """
        raise NotImplementedError

    @abstractmethod
    def on_workflow_run_succeeded(self) -> None:
        """
        Workflow run succeeded
        """
        raise NotImplementedError

    @abstractmethod
    def on_workflow_run_failed(self, error: str) -> None:
        """
        Workflow run failed
        """
        raise NotImplementedError

    @abstractmethod
    def on_workflow_node_execute_started(self, node_id: str,
                                         node_type: NodeType,
                                         node_data: BaseNodeData,
                                         node_run_index: int = 1,
                                         predecessor_node_id: Optional[str] = None) -> None:
        """
        Workflow node execute started
        """
        raise NotImplementedError

    @abstractmethod
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
        raise NotImplementedError

    @abstractmethod
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
        raise NotImplementedError

    @abstractmethod
    def on_node_text_chunk(self, node_id: str, text: str, metadata: Optional[dict] = None) -> None:
        """
        Publish text chunk
        """
        raise NotImplementedError
    
    @abstractmethod
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
        raise NotImplementedError

    @abstractmethod
    def on_workflow_iteration_next(self, node_id: str, 
                                   node_type: NodeType,
                                   index: int, 
                                   node_run_index: int,
                                   output: Optional[Any],
                                   ) -> None:
        """
        Publish iteration next
        """
        raise NotImplementedError

    @abstractmethod
    def on_workflow_iteration_completed(self, node_id: str, 
                                        node_type: NodeType,
                                        node_run_index: int,
                                        outputs: dict) -> None:
        """
        Publish iteration completed
        """
        raise NotImplementedError

    @abstractmethod
    def on_event(self, event: AppQueueEvent) -> None:
        """
        Publish event
        """
        raise NotImplementedError
