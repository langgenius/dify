from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.loop.entities import LoopNodeData


class LoopNode(BaseNode):
    """
    Loop Node.
    """
    _node_data_cls = LoopNodeData
    _node_type = NodeType.LOOP

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run the node.
        """