from collections.abc import Mapping, Sequence
from typing import Any, cast

from core.variables import ArrayFileSegment, FileSegment
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.answer.answer_stream_generate_router import AnswerStreamGeneratorRouter
from core.workflow.nodes.answer.entities import (
    AnswerNodeData,
    GenerateRouteChunk,
    TextGenerateRouteChunk,
    VarGenerateRouteChunk,
)
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.utils.variable_template_parser import VariableTemplateParser
from models.workflow import WorkflowNodeExecutionStatus


class AnswerNode(BaseNode[AnswerNodeData]):
    _node_data_cls = AnswerNodeData
    _node_type: NodeType = NodeType.ANSWER

    def _run(self) -> NodeRunResult:
        """
        Run node
        :return:
        """
        # generate routes
        generate_routes = AnswerStreamGeneratorRouter.extract_generate_route_from_node_data(self.node_data)

        answer = ""
        files = []
        for part in generate_routes:
            if part.type == GenerateRouteChunk.ChunkType.VAR:
                part = cast(VarGenerateRouteChunk, part)
                value_selector = part.value_selector
                variable = self.graph_runtime_state.variable_pool.get(value_selector)
                if variable:
                    if isinstance(variable, FileSegment):
                        files.append(variable.value)
                    elif isinstance(variable, ArrayFileSegment):
                        files.extend(variable.value)
                    answer += variable.markdown
            else:
                part = cast(TextGenerateRouteChunk, part)
                answer += part.text

        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs={"answer": answer, "files": files})

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: AnswerNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        variable_template_parser = VariableTemplateParser(template=node_data.answer)
        variable_selectors = variable_template_parser.extract_variable_selectors()

        variable_mapping = {}
        for variable_selector in variable_selectors:
            variable_mapping[node_id + "." + variable_selector.variable] = variable_selector.value_selector

        return variable_mapping
