
from typing import Any, Mapping, Sequence
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.start.entities import StartNodeData
from models.workflow import WorkflowNodeExecutionStatus


class StartNode(BaseNode):
    _node_data_cls = StartNodeData
    _node_type = NodeType.START

    def _run(self) -> NodeRunResult:
        """
        Run node
        :return:
        """
        # Get cleaned inputs
        cleaned_inputs = dict(self.graph_runtime_state.variable_pool.user_inputs)

        for var in self.graph_runtime_state.variable_pool.system_variables:
            cleaned_inputs['sys.' + var.value] = self.graph_runtime_state.variable_pool.system_variables[var]

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=cleaned_inputs,
            outputs=cleaned_inputs
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls, 
        graph_config: Mapping[str, Any], 
        node_id: str,
        node_data: StartNodeData
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        return {}
