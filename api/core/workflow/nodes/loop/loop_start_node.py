from collections.abc import Mapping
from typing import Any

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.loop.entities import LoopStartNodeData


class LoopStartNode(BaseNode):
    """
    Loop Start Node.
    """

    _node_type = NodeType.LOOP_START

    node_data: LoopStartNodeData

    def from_dict(self, data: Mapping[str, Any]) -> None:
        self.node_data = LoopStartNodeData(**data)

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        """
        Run the node.
        """
        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED)
