"""
Node-level OpenTelemetry parser interfaces and defaults.
"""

import json
from typing import Protocol

from opentelemetry.trace import Span
from opentelemetry.trace.status import Status, StatusCode

from core.workflow.nodes.base.node import Node
from core.workflow.nodes.tool.entities import ToolNodeData


class NodeOTelParser(Protocol):
    """Parser interface for node-specific OpenTelemetry enrichment."""

    def parse(self, *, node: Node, span: "Span", error: Exception | None) -> None: ...


class DefaultNodeOTelParser:
    """Fallback parser used when no node-specific parser is registered."""

    def parse(self, *, node: Node, span: "Span", error: Exception | None) -> None:
        span.set_attribute("node.id", node.id)
        if node.execution_id:
            span.set_attribute("node.execution_id", node.execution_id)
        if hasattr(node, "node_type") and node.node_type:
            span.set_attribute("node.type", node.node_type.value)

        if error:
            span.record_exception(error)
            span.set_status(Status(StatusCode.ERROR, str(error)))
        else:
            span.set_status(Status(StatusCode.OK))


class ToolNodeOTelParser:
    """Parser for tool nodes that captures tool-specific metadata."""

    def __init__(self) -> None:
        self._delegate = DefaultNodeOTelParser()

    def parse(self, *, node: Node, span: "Span", error: Exception | None) -> None:
        self._delegate.parse(node=node, span=span, error=error)

        tool_data = getattr(node, "_node_data", None)
        if not isinstance(tool_data, ToolNodeData):
            return

        span.set_attribute("tool.provider.id", tool_data.provider_id)
        span.set_attribute("tool.provider.type", tool_data.provider_type.value)
        span.set_attribute("tool.provider.name", tool_data.provider_name)
        span.set_attribute("tool.name", tool_data.tool_name)
        span.set_attribute("tool.label", tool_data.tool_label)
        if tool_data.plugin_unique_identifier:
            span.set_attribute("tool.plugin.id", tool_data.plugin_unique_identifier)
        if tool_data.credential_id:
            span.set_attribute("tool.credential.id", tool_data.credential_id)
        if tool_data.tool_configurations:
            span.set_attribute("tool.config", json.dumps(tool_data.tool_configurations, ensure_ascii=False))
