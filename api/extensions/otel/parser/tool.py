"""
Parser for tool nodes that captures tool-specific metadata.
"""

from opentelemetry.trace import Span

from core.workflow.enums import WorkflowNodeExecutionMetadataKey
from core.workflow.graph_events import GraphNodeEventBase
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.tool.entities import ToolNodeData
from extensions.otel.parser.base import DefaultNodeOTelParser, safe_json_dumps
from extensions.otel.semconv.gen_ai import ToolAttributes


class ToolNodeOTelParser:
    """Parser for tool nodes that captures tool-specific metadata."""

    def __init__(self) -> None:
        self._delegate = DefaultNodeOTelParser()

    def parse(
        self, *, node: Node, span: "Span", error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None:
        self._delegate.parse(node=node, span=span, error=error, result_event=result_event)

        tool_data = getattr(node, "_node_data", None)
        if not isinstance(tool_data, ToolNodeData):
            return

        span.set_attribute(ToolAttributes.TOOL_NAME, node.title)
        span.set_attribute(ToolAttributes.TOOL_TYPE, tool_data.provider_type.value)

        # Extract tool info from metadata (consistent with aliyun_trace)
        tool_info = {}
        if result_event and result_event.node_run_result:
            node_run_result = result_event.node_run_result
            if node_run_result.metadata:
                tool_info = node_run_result.metadata.get(WorkflowNodeExecutionMetadataKey.TOOL_INFO, {})

        if tool_info:
            span.set_attribute(ToolAttributes.TOOL_DESCRIPTION, safe_json_dumps(tool_info))

        if result_event and result_event.node_run_result and result_event.node_run_result.inputs:
            span.set_attribute(ToolAttributes.TOOL_CALL_ARGUMENTS, safe_json_dumps(result_event.node_run_result.inputs))

        if result_event and result_event.node_run_result and result_event.node_run_result.outputs:
            span.set_attribute(ToolAttributes.TOOL_CALL_RESULT, safe_json_dumps(result_event.node_run_result.outputs))
