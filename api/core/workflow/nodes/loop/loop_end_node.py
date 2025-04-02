from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.loop.entities import LoopEndNodeData
from models.workflow import WorkflowNodeExecutionStatus


class LoopEndNode(BaseNode[LoopEndNodeData]):
    """
    Loop End Node.
    """

    _node_data_cls = LoopEndNodeData
    _node_type = NodeType.LOOP_END

    def _run(self) -> NodeRunResult:
        """
        Run the node.
        """
        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED)
