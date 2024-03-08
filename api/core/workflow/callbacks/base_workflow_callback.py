from abc import ABC, abstractmethod
from typing import Optional

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
                                        error: str) -> None:
        """
        Workflow node execute failed
        """
        raise NotImplementedError

    @abstractmethod
    def on_node_text_chunk(self, node_id: str, text: str) -> None:
        """
        Publish text chunk
        """
        raise NotImplementedError
