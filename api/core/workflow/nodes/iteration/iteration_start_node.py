from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.iteration.entities import IterationStartNodeData


class IterationStartNode(Node[IterationStartNodeData]):
    """
    Iteration Start Node.
    """

    node_type = NodeType.ITERATION_START

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        """
        Run the node.
        """
        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED)
