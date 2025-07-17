from collections.abc import Mapping
from typing import Any, Optional

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.enums import ErrorStrategy, NodeType
from core.workflow.nodes.iteration.entities import IterationStartNodeData


class IterationStartNode(BaseNode):
    """
    Iteration Start Node.
    """

    _node_type = NodeType.ITERATION_START

    node_data: IterationStartNodeData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self.node_data = IterationStartNodeData(**data)

    def get_error_strategy(self) -> Optional[ErrorStrategy]:
        return self.node_data.error_strategy

    def get_retry_config(self) -> RetryConfig:
        return self.node_data.retry_config

    def get_title(self) -> str:
        return self.node_data.title

    def get_description(self) -> Optional[str]:
        return self.node_data.desc

    def get_default_value_dict(self) -> dict[str, Any]:
        return self.node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self.node_data

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        """
        Run the node.
        """
        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED)
