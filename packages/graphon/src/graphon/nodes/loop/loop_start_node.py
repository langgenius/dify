from typing import override

from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.node_events.base import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.nodes.loop.entities import LoopStartNodeData


class LoopStartNode(Node[LoopStartNodeData]):
    """Loop Start Node."""

    node_type = BuiltinNodeTypes.LOOP_START

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        """Run the node."""
        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED)
