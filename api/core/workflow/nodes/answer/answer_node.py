from collections.abc import Mapping, Sequence
from typing import Any, cast

from core.variables import ArrayFileSegment, FileSegment
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.answer.answer_stream_generate_router import AnswerStreamGeneratorRouter
from core.workflow.nodes.answer.entities import (
    AnswerNodeData,
    GenerateRouteChunk,
    TextGenerateRouteChunk,
    VarGenerateRouteChunk,
)
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.enums import ErrorStrategy, NodeType
from core.workflow.utils.variable_template_parser import VariableTemplateParser


class AnswerNode(BaseNode):
    _node_type = NodeType.ANSWER

    _node_data: AnswerNodeData

    def init_node_data(self, data: Mapping[str, Any]):
        self._node_data = AnswerNodeData.model_validate(data)

    def _get_error_strategy(self) -> ErrorStrategy | None:
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> str | None:
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        """
        Run node
        :return:
        """
        # generate routes
        generate_routes = AnswerStreamGeneratorRouter.extract_generate_route_from_node_data(self._node_data)

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

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={"answer": answer, "files": ArrayFileSegment(value=files)},
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        # Create typed NodeData from dict
        typed_node_data = AnswerNodeData.model_validate(node_data)

        variable_template_parser = VariableTemplateParser(template=typed_node_data.answer)
        variable_selectors = variable_template_parser.extract_variable_selectors()

        variable_mapping = {}
        for variable_selector in variable_selectors:
            variable_mapping[node_id + "." + variable_selector.variable] = variable_selector.value_selector

        return variable_mapping
