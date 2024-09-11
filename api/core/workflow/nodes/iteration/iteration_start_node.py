from collections.abc import Mapping, Sequence
from typing import Any

from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.iteration.entities import IterationNodeData, IterationStartNodeData
from models.workflow import WorkflowNodeExecutionStatus


class IterationStartNode(BaseNode):
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

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls, graph_config: Mapping[str, Any], node_id: str, node_data: IterationNodeData
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        return {}
