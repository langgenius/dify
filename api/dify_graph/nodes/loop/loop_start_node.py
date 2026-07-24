from dify_graph.enums import NodeType, WorkflowNodeExecutionStatus
from dify_graph.node_events import NodeRunResult
from dify_graph.nodes.base.node import Node
from dify_graph.nodes.loop.entities import LoopStartNodeData


class LoopStartNode(Node[LoopStartNodeData]):
    """
    Loop Start Node.
    """

    node_type = NodeType.LOOP_START

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        """
        Run the node.
        """
        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED)
