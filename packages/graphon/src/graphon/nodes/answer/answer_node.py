from collections.abc import Mapping, Sequence
from typing import Any, override

from graphon.enums import (
    BuiltinNodeTypes,
    NodeExecutionType,
    WorkflowNodeExecutionStatus,
)
from graphon.file.models import File
from graphon.node_events.base import NodeRunResult
from graphon.nodes.answer.entities import AnswerNodeData
from graphon.nodes.base.node import Node
from graphon.nodes.base.template import Template
from graphon.nodes.base.variable_template_parser import VariableTemplateParser
from graphon.variables.segments import (
    ArrayFileSegment,
    FileSegment,
    Segment,
)
from graphon.variables.template_resolution import convert_template


class AnswerNode(Node[AnswerNodeData]):
    node_type = BuiltinNodeTypes.ANSWER
    execution_type = NodeExecutionType.RESPONSE

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        segments = convert_template(
            self.runtime_state.variable_pool,
            self.node_data.answer,
        )
        files = self._extract_files_from_segments(segments.value)
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={
                "answer": segments.markdown,
                "files": ArrayFileSegment(value=files),
            },
        )

    def _extract_files_from_segments(self, segments: Sequence[Segment]) -> list[File]:
        """Extract all files from segments containing FileSegment or
        ArrayFileSegment instances.

        FileSegment contains a single file, while ArrayFileSegment contains
        multiple files. This method flattens all files into a single list.

        Returns:
            A flat list of `File` objects extracted from the segments.

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
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: AnswerNodeData,
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config  # Explicitly mark as unused
        variable_template_parser = VariableTemplateParser(template=node_data.answer)
        variable_selectors = variable_template_parser.extract_variable_selectors()

        variable_mapping = {}
        for variable_selector in variable_selectors:
            variable_mapping[node_id + "." + variable_selector.variable] = (
                variable_selector.value_selector
            )

        return variable_mapping

    def get_streaming_template(self) -> Template:
        """Get the template for streaming.

        Returns:
            Template instance for this Answer node

        """
        return Template.from_answer_template(self.node_data.answer)

    def get_streaming_text_selector(self) -> Sequence[str]:
        return [self.id, "answer"]
