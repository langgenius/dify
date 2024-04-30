from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.iteration.entities import IterationNodeData


class IterationNode(BaseNode):
    """
    Loop Node.
    """
    _node_data_cls = IterationNodeData
    _node_type = NodeType.ITERATION

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run the node.
        """