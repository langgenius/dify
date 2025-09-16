from collections.abc import Mapping, Sequence
from typing import Any

from core.variables import ArrayFileSegment, FileSegment, Segment
from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.answer.entities import AnswerNodeData
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.template import Template
from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser


class AnswerNode(Node):
    node_type = NodeType.ANSWER
    execution_type = NodeExecutionType.RESPONSE

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
        segments = self.graph_runtime_state.variable_pool.convert_template(self._node_data.answer)
        files = self._extract_files_from_segments(segments.value)
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={"answer": segments.markdown, "files": ArrayFileSegment(value=files)},
        )

    def _extract_files_from_segments(self, segments: Sequence[Segment]):
        """Extract all files from segments containing FileSegment or ArrayFileSegment instances.

        FileSegment contains a single file, while ArrayFileSegment contains multiple files.
        This method flattens all files into a single list.
        """
        files = []
        for segment in segments:
            if isinstance(segment, FileSegment):
                # Single file - wrap in list for consistency
                files.append(segment.value)
            elif isinstance(segment, ArrayFileSegment):
                # Multiple files - extend the list
                files.extend(segment.value)
        return files

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
