from collections.abc import Mapping, Sequence
from typing import Any, cast

from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.end.entities import EndNodeData
from models.workflow import WorkflowNodeExecutionStatus


class EndNode(BaseNode):
    _node_data_cls = EndNodeData
    _node_type = NodeType.END

    def _run(self) -> NodeRunResult:
        """
        Run node
        :return:
        """
        node_data = self.node_data
        node_data = cast(EndNodeData, node_data)
        output_variables = node_data.outputs

        outputs = {}
        for variable_selector in output_variables:
            value = self.graph_runtime_state.variable_pool.get_any(variable_selector.value_selector)
            outputs[variable_selector.variable] = value

        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=outputs, outputs=outputs)

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls, graph_config: Mapping[str, Any], node_id: str, node_data: EndNodeData
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        return {}
