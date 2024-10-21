from collections.abc import Mapping, Sequence
from typing import Any

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.enums import NodeType
from models.workflow import WorkflowNodeExecutionStatus


class EndNode(BaseNode[EndNodeData]):
    _node_data_cls = EndNodeData
    _node_type = NodeType.END

    def _run(self) -> NodeRunResult:
        """
        Run node
        :return:
        """
        output_variables = self.node_data.outputs

        outputs = {}
        for variable_selector in output_variables:
            variable = self.graph_runtime_state.variable_pool.get(variable_selector.value_selector)
            value = variable.to_object() if variable is not None else None
            outputs[variable_selector.variable] = value

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=outputs,
            outputs=outputs,
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: EndNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        return {}
