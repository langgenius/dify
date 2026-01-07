"""
Node-level OpenTelemetry parser interfaces and defaults.
"""

import json
from typing import Any, Protocol

from opentelemetry.trace import Span
from opentelemetry.trace.status import Status, StatusCode
from pydantic import BaseModel

from core.file.models import File
from core.variables import Segment
from core.workflow.enums import WorkflowNodeExecutionMetadataKey
from core.workflow.graph_events import GraphNodeEventBase
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.tool.entities import ToolNodeData
from extensions.otel.semconv.gen_ai import ChainAttributes, ToolAttributes


def _safe_json_dumps(obj: Any, ensure_ascii: bool = False) -> str:
    """
    Safely serialize objects to JSON, handling non-serializable types.

    Handles:
    - Segment types (ArrayFileSegment, FileSegment, etc.) - converts to their value
    - File objects - converts to dict using to_dict()
    - BaseModel objects - converts using model_dump()
    - Other types - falls back to str() representation

    Args:
        obj: Object to serialize
        ensure_ascii: Whether to ensure ASCII encoding

    Returns:
        JSON string representation of the object
    """
    def _convert_value(value: Any) -> Any:
        """Recursively convert non-serializable values."""
        if value is None:
            return None
        if isinstance(value, (bool, int, float, str)):
            return value
        if isinstance(value, Segment):
            # Convert Segment to its underlying value
            return _convert_value(value.value)
        if isinstance(value, File):
            # Convert File to dict
            return value.to_dict()
        if isinstance(value, BaseModel):
            # Convert Pydantic model to dict
            return _convert_value(value.model_dump(mode="json"))
        if isinstance(value, dict):
            return {k: _convert_value(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [_convert_value(item) for item in value]
        # Fallback to string representation for unknown types
        return str(value)

    try:
        converted = _convert_value(obj)
        return json.dumps(converted, ensure_ascii=ensure_ascii)
    except (TypeError, ValueError) as e:
        # If conversion still fails, return error message as string
        return json.dumps({"error": f"Failed to serialize: {type(obj).__name__}", "message": str(e)},
                          ensure_ascii=ensure_ascii)


class NodeOTelParser(Protocol):
    """Parser interface for node-specific OpenTelemetry enrichment."""

    def parse(
        self, *, node: Node, span: "Span", error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None: ...


class DefaultNodeOTelParser:
    """Fallback parser used when no node-specific parser is registered."""

    def parse(
        self, *, node: Node, span: "Span", error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None:
        span.set_attribute("node.id", node.id)
        if node.execution_id:
            span.set_attribute("node.execution_id", node.execution_id)
        if hasattr(node, "node_type") and node.node_type:
            span.set_attribute("node.type", node.node_type.value)

        # Extract inputs and outputs from result_event
        if result_event and result_event.node_run_result:
            node_run_result = result_event.node_run_result
            if node_run_result.inputs:
                span.set_attribute(ChainAttributes.INPUT_VALUE, _safe_json_dumps(node_run_result.inputs))
            if node_run_result.outputs:
                span.set_attribute(ChainAttributes.OUTPUT_VALUE, _safe_json_dumps(node_run_result.outputs))

        if error:
            span.record_exception(error)
            span.set_status(Status(StatusCode.ERROR, str(error)))
        else:
            span.set_status(Status(StatusCode.OK))


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
            span.set_attribute(ToolAttributes.TOOL_DESCRIPTION, _safe_json_dumps(tool_info))

        if result_event and result_event.node_run_result and result_event.node_run_result.inputs:
            span.set_attribute(
                ToolAttributes.TOOL_CALL_ARGUMENTS, _safe_json_dumps(result_event.node_run_result.inputs)
            )

        if result_event and result_event.node_run_result and result_event.node_run_result.outputs:
            span.set_attribute(
                ToolAttributes.TOOL_CALL_RESULT, _safe_json_dumps(result_event.node_run_result.outputs)
            )
