from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.loop.entities import LoopEndNodeData


class LoopEndNode(BaseNode[LoopEndNodeData]):
    """
    Loop End Node.
    """

    _node_data_cls = LoopEndNodeData
    _node_type = NodeType.LOOP_END

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        """
        Run the node.
        """
        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED)
