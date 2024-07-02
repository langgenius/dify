from typing import Any

from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseIterationNode
from core.workflow.nodes.loop.entities import LoopNodeData, LoopState
from core.workflow.utils.condition.entities import Condition


class LoopNode(BaseIterationNode):
    """
    Loop Node.
    """
    _node_data_cls = LoopNodeData
    _node_type = NodeType.LOOP

    def _run(self, variable_pool: VariablePool) -> LoopState:
        return super()._run(variable_pool)

    def _get_next_iteration(self, variable_loop: VariablePool) -> NodeRunResult | str:
        """
        Get next iteration start node id based on the graph.
        """
        pass

    @classmethod
    def get_conditions(cls, node_config: dict[str, Any]) -> list[Condition]:
        """
        Get conditions.
        """
        node_id = node_config.get('id')
        if not node_id:
            return []

        # TODO waiting for implementation
        return [Condition(
            variable_selector=[node_id, 'index'],
            comparison_operator="≤",
            value_type="value_selector",
            value_selector=[]
        )]
