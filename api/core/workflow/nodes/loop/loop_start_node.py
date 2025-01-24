from collections.abc import Mapping, Sequence
from typing import Any

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.loop.entities import LoopNodeData, LoopStartNodeData
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

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls, graph_config: Mapping[str, Any], node_id: str, node_data: LoopNodeData
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        return {}
