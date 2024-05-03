from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseIterationNode
from core.workflow.nodes.loop.entities import LoopNodeData


class LoopNode(BaseIterationNode):
    """
    Loop Node.
    """
    _node_data_cls = LoopNodeData
    _node_type = NodeType.LOOP

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run the node.
        """

    def _get_next_iteration_start_id(self, variable_loop: VariablePool) -> NodeRunResult | str:
        """
        Get next iteration start node id based on the graph.
        """