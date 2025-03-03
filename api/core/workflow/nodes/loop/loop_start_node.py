from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.loop.entities import LoopStartNodeData
from models.workflow import WorkflowNodeExecutionStatus


class LoopStartNode(BaseNode):
    """
    Loop Start Node.
    """

    _node_data_cls = LoopStartNodeData
    _node_type = NodeType.LOOP_START

    def _run(self) -> NodeRunResult:
        """
        Run the node.
        """
        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED)
