from collections.abc import Mapping, Sequence
from typing import Any, Optional, cast

from core.variables import ArrayFileSegment, FileSegment
from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph import BaseNodeData, Node, RetryConfig
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.answer.answer_stream_generate_router import AnswerStreamGeneratorRouter
from core.workflow.nodes.answer.entities import (
    AnswerNodeData,
    GenerateRouteChunk,
    TextGenerateRouteChunk,
    VarGenerateRouteChunk,
)
from core.workflow.nodes.base.template import Template
from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser


class AnswerNode(Node):
    node_type = NodeType.ANSWER
    execution_type = NodeExecutionType.RESPONSE

    _node_data: AnswerNodeData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = AnswerNodeData.model_validate(data)

    def _get_error_strategy(self) -> Optional[ErrorStrategy]:
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> Optional[str]:
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
        Run node - collect all outputs at once.

        This method runs after streaming is complete (if streaming was enabled).
        It collects all variable values and outputs them as a single answer.
        """
        # Generate routes from template
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

    def get_streaming_template(self) -> Template:
        """
        Get the template for streaming.

        Returns:
            Template instance for this Answer node
        """
        return Template.from_answer_template(self._node_data.answer)
