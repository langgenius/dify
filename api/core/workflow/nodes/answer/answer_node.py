from collections.abc import Mapping, Sequence
from typing import Any, cast

from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.nodes.answer.answer_stream_generate_router import AnswerStreamGeneratorRouter
from core.workflow.nodes.answer.entities import (
    AnswerNodeData,
    GenerateRouteChunk,
    TextGenerateRouteChunk,
    VarGenerateRouteChunk,
)
from core.workflow.nodes.base_node import BaseNode
from core.workflow.utils.variable_template_parser import VariableTemplateParser
from models.workflow import WorkflowNodeExecutionStatus


class AnswerNode(BaseNode):
    _node_data_cls = AnswerNodeData
    _node_type: NodeType = NodeType.ANSWER

    def _run(self) -> NodeRunResult:
        """
        Run node
        :return:
        """
        node_data = self.node_data
        node_data = cast(AnswerNodeData, node_data)

        # generate routes
        generate_routes = AnswerStreamGeneratorRouter.extract_generate_route_from_node_data(node_data)

        answer = ""
        for part in generate_routes:
            if part.type == GenerateRouteChunk.ChunkType.VAR:
                part = cast(VarGenerateRouteChunk, part)
                value_selector = part.value_selector
                value = self.graph_runtime_state.variable_pool.get(value_selector)

                if value:
                    answer += value.markdown
            else:
                part = cast(TextGenerateRouteChunk, part)
                answer += part.text

        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs={"answer": answer})

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls, graph_config: Mapping[str, Any], node_id: str, node_data: AnswerNodeData
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        node_data = node_data
        node_data = cast(AnswerNodeData, node_data)

        variable_template_parser = VariableTemplateParser(template=node_data.answer)
        variable_selectors = variable_template_parser.extract_variable_selectors()

        variable_mapping = {}
        for variable_selector in variable_selectors:
            variable_mapping[node_id + "." + variable_selector.variable] = variable_selector.value_selector

        return variable_mapping
