from typing import cast

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.end.entities import EndNodeData
from models.workflow import WorkflowNodeExecutionStatus


class EndNode(BaseNode):
    _node_data_cls = EndNodeData
    _node_type = NodeType.END

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run node
        :param variable_pool: variable pool
        :return:
        """
        node_data = self.node_data
        node_data = cast(EndNodeData, node_data)
        output_variables = node_data.outputs

        outputs = {}
        for variable_selector in output_variables:
            value = variable_pool.get_any(variable_selector.value_selector)
            outputs[variable_selector.variable] = value

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=outputs,
            outputs=outputs
        )

    @classmethod
    def extract_generate_nodes(cls, graph: dict, config: dict) -> list[str]:
        """
        Extract generate nodes
        :param graph: graph
        :param config: node config
        :return:
        """
        node_data = cls._node_data_cls(**config.get("data", {}))
        node_data = cast(EndNodeData, node_data)

        return cls.extract_generate_nodes_from_node_data(graph, node_data)

    @classmethod
    def extract_generate_nodes_from_node_data(cls, graph: dict, node_data: EndNodeData) -> list[str]:
        """
        Extract generate nodes from node data
        :param graph: graph
        :param node_data: node data object
        :return:
        """
        nodes = graph.get('nodes', [])
        node_mapping = {node.get('id'): node for node in nodes}

        variable_selectors = node_data.outputs

        generate_nodes = []
        for variable_selector in variable_selectors:
            if not variable_selector.value_selector:
                continue

            node_id = variable_selector.value_selector[0]
            if node_id != 'sys' and node_id in node_mapping:
                node = node_mapping[node_id]
                node_type = node.get('data', {}).get('type')
                if node_type == NodeType.LLM.value and variable_selector.value_selector[1] == 'text':
                    generate_nodes.append(node_id)

        # remove duplicates
        generate_nodes = list(set(generate_nodes))

        return generate_nodes

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[str, list[str]]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        return {}
