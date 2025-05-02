from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.iteration.entities import IterationStartNodeData
from models.workflow import WorkflowNodeExecutionStatus


class IterationStartNode(BaseNode[IterationStartNodeData]):
    """
    Iteration Start Node.
    """

    _node_data_cls = IterationStartNodeData
    _node_type = NodeType.ITERATION_START

    def _run(self) -> NodeRunResult:
        """
        Run the node.
        """
        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED)
