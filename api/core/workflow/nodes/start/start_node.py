from typing import Optional

from core.workflow.entities.node_entities import NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.start.entities import StartNodeData


class StartNode(BaseNode):
    _node_data_cls = StartNodeData
    node_type = NodeType.START

    def _run(self, variable_pool: Optional[VariablePool] = None,
             run_args: Optional[dict] = None) -> dict:
        """
        Run node
        :param variable_pool: variable pool
        :param run_args: run args
        :return:
        """
        pass

