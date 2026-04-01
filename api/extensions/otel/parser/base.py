"""
Base parser interface and utilities for OpenTelemetry node parsers.

Content gating: ``should_include_content()`` controls whether content-bearing
span attributes (inputs, outputs, prompts, completions, documents) are written.
Gate is only active in EE (``ENTERPRISE_ENABLED=True``) when
``ENTERPRISE_INCLUDE_CONTENT=False``; CE behaviour is unchanged.
"""

import json
from typing import Any, Protocol

from graphon.enums import BuiltinNodeTypes
from graphon.file import File
from graphon.graph_events import GraphNodeEventBase
from graphon.nodes.base.node import Node
from graphon.variables import Segment
from opentelemetry.trace import Span
from opentelemetry.trace.status import Status, StatusCode
from pydantic import BaseModel

from configs import dify_config
from extensions.otel.semconv.gen_ai import ChainAttributes, GenAIAttributes


def should_include_content() -> bool:
    """Return True if content should be written to spans.

    CE (ENTERPRISE_ENABLED=False): always True — no behaviour change.
    """
    if not dify_config.ENTERPRISE_ENABLED:
        return True
    return dify_config.ENTERPRISE_INCLUDE_CONTENT


def safe_json_dumps(obj: Any, ensure_ascii: bool = False) -> str:
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
        return json.dumps(
            {"error": f"Failed to serialize: {type(obj).__name__}", "message": str(e)}, ensure_ascii=ensure_ascii
        )


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
        span.set_attribute("node.type", node.node_type)

        span.set_attribute(GenAIAttributes.FRAMEWORK, "dify")

        node_type = node.node_type
        if node_type == BuiltinNodeTypes.LLM:
            span.set_attribute(GenAIAttributes.SPAN_KIND, "LLM")
        elif node_type == BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL:
            span.set_attribute(GenAIAttributes.SPAN_KIND, "RETRIEVER")
        elif node_type == BuiltinNodeTypes.TOOL:
            span.set_attribute(GenAIAttributes.SPAN_KIND, "TOOL")
        else:
            span.set_attribute(GenAIAttributes.SPAN_KIND, "TASK")

        # Extract inputs and outputs from result_event
        if result_event and result_event.node_run_result:
            node_run_result = result_event.node_run_result
            if should_include_content():
                if node_run_result.inputs:
                    span.set_attribute(ChainAttributes.INPUT_VALUE, safe_json_dumps(node_run_result.inputs))
                if node_run_result.outputs:
                    span.set_attribute(ChainAttributes.OUTPUT_VALUE, safe_json_dumps(node_run_result.outputs))

        if error:
            span.record_exception(error)
            span.set_status(Status(StatusCode.ERROR, str(error)))
        else:
            span.set_status(Status(StatusCode.OK))
