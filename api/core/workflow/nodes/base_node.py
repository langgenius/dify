from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from enum import Enum
from typing import Any, Optional

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.callbacks.base_workflow_callback import WorkflowCallback
from core.workflow.entities.base_node_data_entities import BaseIterationState, BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool


class UserFrom(Enum):
    """
    User from
    """
    ACCOUNT = "account"
    END_USER = "end-user"

    @classmethod
    def value_of(cls, value: str) -> "UserFrom":
        """
        Value of
        :param value: value
        :return:
        """
        for item in cls:
            if item.value == value:
                return item
        raise ValueError(f"Invalid value: {value}")


class BaseNode(ABC):
    _node_data_cls: type[BaseNodeData]
    _node_type: NodeType

    tenant_id: str
    app_id: str
    workflow_id: str
    user_id: str
    user_from: UserFrom
    invoke_from: InvokeFrom
    
    workflow_call_depth: int

    node_id: str
    node_data: BaseNodeData
    node_run_result: Optional[NodeRunResult] = None

    callbacks: Sequence[WorkflowCallback]

    is_answer_previous_node: bool = False

    def __init__(self, tenant_id: str,
                 app_id: str,
                 workflow_id: str,
                 user_id: str,
                 user_from: UserFrom,
                 invoke_from: InvokeFrom,
                 config: Mapping[str, Any],
                 callbacks: Sequence[WorkflowCallback] | None = None,
                 workflow_call_depth: int = 0) -> None:
        self.tenant_id = tenant_id
        self.app_id = app_id
        self.workflow_id = workflow_id
        self.user_id = user_id
        self.user_from = user_from
        self.invoke_from = invoke_from
        self.workflow_call_depth = workflow_call_depth

        # TODO: May need to check if key exists.
        self.node_id = config["id"]
        if not self.node_id:
            raise ValueError("Node ID is required.")

        self.node_data = self._node_data_cls(**config.get("data", {}))
        self.callbacks = callbacks or []

    @abstractmethod
    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run node
        :param variable_pool: variable pool
        :return:
        """
        raise NotImplementedError

    def run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run node entry
        :param variable_pool: variable pool
        :return:
        """
        result = self._run(
            variable_pool=variable_pool
        )

        self.node_run_result = result
        return result

    def publish_text_chunk(self, text: str, value_selector: list[str] = None) -> None:
        """
        Publish text chunk
        :param text: chunk text
        :param value_selector: value selector
        :return:
        """
        if self.callbacks:
            for callback in self.callbacks:
                callback.on_node_text_chunk(
                    node_id=self.node_id,
                    text=text,
                    metadata={
                        "node_type": self.node_type,
                        "is_answer_previous_node": self.is_answer_previous_node,
                        "value_selector": value_selector
                    }
                )

    @classmethod
    def extract_variable_selector_to_variable_mapping(cls, config: dict):
        """
        Extract variable selector to variable mapping
        :param config: node config
        :return:
        """
        node_data = cls._node_data_cls(**config.get("data", {}))
        return cls._extract_variable_selector_to_variable_mapping(node_data)

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        return {}

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        """
        Get default config of node.
        :param filters: filter by node config parameters.
        :return:
        """
        return {}

    @property
    def node_type(self) -> NodeType:
        """
        Get node type
        :return:
        """
        return self._node_type

class BaseIterationNode(BaseNode):
    @abstractmethod
    def _run(self, variable_pool: VariablePool) -> BaseIterationState:
        """
        Run node
        :param variable_pool: variable pool
        :return:
        """
        raise NotImplementedError

    def run(self, variable_pool: VariablePool) -> BaseIterationState:
        """
        Run node entry
        :param variable_pool: variable pool
        :return:
        """
        return self._run(variable_pool=variable_pool)

    def get_next_iteration(self, variable_pool: VariablePool, state: BaseIterationState) -> NodeRunResult | str:
        """
        Get next iteration start node id based on the graph.
        :param graph: graph
        :return: next node id
        """
        return self._get_next_iteration(variable_pool, state)
    
    @abstractmethod
    def _get_next_iteration(self, variable_pool: VariablePool, state: BaseIterationState) -> NodeRunResult | str:
        """
        Get next iteration start node id based on the graph.
        :param graph: graph
        :return: next node id
        """
        raise NotImplementedError
