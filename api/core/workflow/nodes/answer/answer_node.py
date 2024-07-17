import json
from typing import cast

from core.file.file_obj import FileVar
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.nodes.answer.answer_stream_output_manager import AnswerStreamOutputManager
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
    node_type = NodeType.ANSWER

    def _run(self) -> NodeRunResult:
        """
        Run node
        :return:
        """
        node_data = self.node_data
        node_data = cast(AnswerNodeData, node_data)

        # generate routes
        generate_routes = AnswerStreamOutputManager.extract_generate_route_from_node_data(node_data)

        answer = ''
        for part in generate_routes:
            if part.type == GenerateRouteChunk.ChunkType.VAR:
                part = cast(VarGenerateRouteChunk, part)
                value_selector = part.value_selector
                value = self.graph_runtime_state.variable_pool.get_variable_value(
                    variable_selector=value_selector
                )

                text = ''
                if isinstance(value, str | int | float):
                    text = str(value)
                elif isinstance(value, dict):
                    # other types
                    text = json.dumps(value, ensure_ascii=False)
                elif isinstance(value, FileVar):
                    # convert file to markdown
                    text = value.to_markdown()
                elif isinstance(value, list):
                    for item in value:
                        if isinstance(item, FileVar):
                            text += item.to_markdown() + ' '

                    text = text.strip()

                    if not text and value:
                        # other types
                        text = json.dumps(value, ensure_ascii=False)

                answer += text
            else:
                part = cast(TextGenerateRouteChunk, part)
                answer += part.text

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={
                "answer": answer
            }
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[str, list[str]]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        node_data = node_data
        node_data = cast(AnswerNodeData, node_data)

        variable_template_parser = VariableTemplateParser(template=node_data.answer)
        variable_selectors = variable_template_parser.extract_variable_selectors()

        variable_mapping = {}
        for variable_selector in variable_selectors:
            variable_mapping[variable_selector.variable] = variable_selector.value_selector

        return variable_mapping
