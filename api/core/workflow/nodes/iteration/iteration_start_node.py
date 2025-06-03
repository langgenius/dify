from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.iteration.entities import IterationStartNodeData


class IterationStartNode(BaseNode[IterationStartNodeData]):
    """
    Iteration Start Node.
    """

    _node_data_cls = IterationStartNodeData
    _node_type = NodeType.ITERATION_START

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        """
        Run the node.
        """
        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED)
