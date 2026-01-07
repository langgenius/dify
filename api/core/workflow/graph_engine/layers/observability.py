"""
Observability layer for GraphEngine.

This layer creates OpenTelemetry spans for node execution, enabling distributed
tracing of workflow execution. It establishes OTel context during node execution
so that automatic instrumentation (HTTP requests, DB queries, etc.) automatically
associates with the node span.
"""

import logging
from dataclasses import dataclass
from typing import cast, final

from opentelemetry import context as context_api
from opentelemetry.trace import Span, SpanKind, Tracer, get_tracer, set_span_in_context
from typing_extensions import override

from configs import dify_config
from core.workflow.enums import NodeType
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events import GraphNodeEventBase
from core.workflow.nodes.base.node import Node
from extensions.otel.parser import (
    DefaultNodeOTelParser,
    LLMNodeOTelParser,
    NodeOTelParser,
    RetrievalNodeOTelParser,
    ToolNodeOTelParser,
)
from extensions.otel.runtime import is_instrument_flag_enabled

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class _NodeSpanContext:
    span: "Span"
    token: object


@final
class ObservabilityLayer(GraphEngineLayer):
    """
    Layer that creates OpenTelemetry spans for node execution.

    This layer:
    - Creates a span when a node starts execution
    - Establishes OTel context so automatic instrumentation associates with the span
    - Sets complete attributes and status when node execution ends
    """

    def __init__(self) -> None:
        super().__init__()
        self._node_contexts: dict[str, _NodeSpanContext] = {}
        self._parsers: dict[NodeType, NodeOTelParser] = {}
        self._default_parser: NodeOTelParser = cast(NodeOTelParser, DefaultNodeOTelParser())
        self._is_disabled: bool = False
        self._tracer: Tracer | None = None
        self._build_parser_registry()
        self._init_tracer()

    def _init_tracer(self) -> None:
        """Initialize OpenTelemetry tracer in constructor."""
        if not (dify_config.ENABLE_OTEL or is_instrument_flag_enabled()):
            self._is_disabled = True
            return

        try:
            self._tracer = get_tracer(__name__)
        except Exception as e:
            logger.warning("Failed to get OpenTelemetry tracer: %s", e)
            self._is_disabled = True

    def _build_parser_registry(self) -> None:
        """Initialize parser registry for node types."""
        self._parsers = {
            NodeType.TOOL: ToolNodeOTelParser(),
            NodeType.LLM: LLMNodeOTelParser(),
            NodeType.KNOWLEDGE_RETRIEVAL: RetrievalNodeOTelParser(),
        }

    def _get_parser(self, node: Node) -> NodeOTelParser:
        node_type = getattr(node, "node_type", None)
        if isinstance(node_type, NodeType):
            return self._parsers.get(node_type, self._default_parser)
        return self._default_parser

    @override
    def on_graph_start(self) -> None:
        """Called when graph execution starts."""
        self._node_contexts.clear()

    @override
    def on_node_run_start(self, node: Node) -> None:
        """
        Called when a node starts execution.

        Creates a span and establishes OTel context for automatic instrumentation.
        """
        if self._is_disabled:
            return

        try:
            if not self._tracer:
                return

            execution_id = node.execution_id
            if not execution_id:
                return

            parent_context = context_api.get_current()
            span = self._tracer.start_span(
                f"{node.title}",
                kind=SpanKind.INTERNAL,
                context=parent_context,
            )

            new_context = set_span_in_context(span)
            token = context_api.attach(new_context)

            self._node_contexts[execution_id] = _NodeSpanContext(span=span, token=token)

        except Exception as e:
            logger.warning("Failed to create OpenTelemetry span for node %s: %s", node.id, e)

    @override
    def on_node_run_end(
        self, node: Node, error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None:
        """
        Called when a node finishes execution.

        Sets complete attributes, records exceptions, and ends the span.
        """
        if self._is_disabled:
            return

        try:
            execution_id = node.execution_id
            if not execution_id:
                return
            node_context = self._node_contexts.get(execution_id)
            if not node_context:
                return

            span = node_context.span
            parser = self._get_parser(node)
            try:
                parser.parse(node=node, span=span, error=error, result_event=result_event)
                span.end()
            finally:
                token = node_context.token
                if token is not None:
                    try:
                        context_api.detach(token)
                    except Exception:
                        logger.warning("Failed to detach OpenTelemetry token: %s", token)
                self._node_contexts.pop(execution_id, None)

        except Exception as e:
            logger.warning("Failed to end OpenTelemetry span for node %s: %s", node.id, e)

    @override
    def on_event(self, event) -> None:
        """Not used in this layer."""
        pass

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        """Called when graph execution ends."""
        if self._node_contexts:
            logger.warning(
                "ObservabilityLayer: %d node spans were not properly ended",
                len(self._node_contexts),
            )
            self._node_contexts.clear()
