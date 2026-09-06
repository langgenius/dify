"""
Observability layer for Engine.

This layer creates OpenTelemetry spans for node execution, enabling distributed
tracing of workflow execution. It establishes OTel context during node execution
so that automatic instrumentation (HTTP requests, DB queries, etc.) automatically
associates with the node span.
"""

import logging
from collections.abc import Generator
from contextlib import contextmanager
from contextvars import Token
from typing import cast, final, override

from opentelemetry import context as context_api
from opentelemetry.trace import Span, SpanKind, Tracer, get_current_span, get_tracer, set_span_in_context

from configs import dify_config
from extensions.otel.parser import (
    DefaultNodeOTelParser,
    LLMNodeOTelParser,
    NodeOTelParser,
    RetrievalNodeOTelParser,
    ToolNodeOTelParser,
)
from extensions.otel.runtime import is_instrument_flag_enabled
from extensions.otel.semconv import DifySpanAttributes
from graphon.engine.layer import Layer
from graphon.engine_events import EngineEvent, GraphRunAbortedEvent, NodeEvent
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.nodes.base.node import Node

logger = logging.getLogger(__name__)


@final
class ObservabilityLayer(Layer):
    """
    Layer that creates OpenTelemetry spans for node execution.

    This layer:
    - Creates a span when a node starts execution
    - Establishes OTel context so automatic instrumentation associates with the span
    - Sets complete attributes and status when node execution ends
    """

    def __init__(self) -> None:
        super().__init__()
        self._node_spans: dict[str, Span] = {}
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
            BuiltinNodeTypes.TOOL: ToolNodeOTelParser(),
            BuiltinNodeTypes.LLM: LLMNodeOTelParser(),
            BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL: RetrievalNodeOTelParser(),
        }

    def _get_parser(self, node: Node) -> NodeOTelParser:
        return self._parsers.get(node.node_type, self._default_parser)

    @override
    def on_graph_start(self) -> None:
        """Called when graph execution starts."""
        self.on_graph_end(None)

    @override
    @contextmanager
    def node_run_context(self, node: Node, *, parent_execution_id: str | None = None) -> Generator[None, None, None]:
        """Activate a retained span only for this worker's execution segment.

        Container spans outlive worker activations. Context tokens must not:
        suspension and final resume can execute in different contexts/threads.
        """
        token: Token[context_api.Context] | None = None
        try:
            if not self._is_disabled and self._tracer and (execution_id := node.execution_id):
                span = self._node_spans.get(execution_id)
                if span is None:
                    parent_context = context_api.get_current()
                    parent_span = self._node_spans.get(parent_execution_id) if parent_execution_id else None
                    if parent_span is not None:
                        parent_context = set_span_in_context(parent_span, parent_context)
                    span = self._tracer.start_span(node.title, kind=SpanKind.INTERNAL, context=parent_context)
                    self._node_spans[execution_id] = span
                token = context_api.attach(set_span_in_context(span))
        except Exception as e:
            logger.warning("Failed to activate OpenTelemetry span for node %s: %s", node.id, e)

        try:
            yield
        finally:
            if token is not None:
                context_api.detach(token)

    @override
    def on_node_run_end(self, node: Node, error: Exception | None, result_event: NodeEvent | None = None) -> None:
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
            span = self._node_spans.pop(execution_id, None)
            if span is None:
                return

            parser = self._get_parser(node)
            try:
                parser.parse(node=node, span=span, error=error, result_event=result_event)
            finally:
                span.end()

        except Exception as e:
            logger.warning("Failed to end OpenTelemetry span for node %s: %s", node.id, e)

    @override
    def on_event(self, event: EngineEvent) -> None:
        """Record graph-level observability events."""
        if self._is_disabled:
            return

        if isinstance(event, GraphRunAbortedEvent):
            self._record_abort_reason(reason=event.reason or "Workflow execution aborted")

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        """Close suspended spans when this engine attempt pauses or terminates."""
        for execution_id in tuple(self._node_spans):
            if (span := self._node_spans.pop(execution_id, None)) is not None:
                span.end()

    def _record_abort_reason(self, *, reason: str) -> None:
        span = get_current_span()
        if not span.is_recording():
            return

        span.set_attribute(DifySpanAttributes.WORKFLOW_ABORT_REASON, reason)
        span.add_event(
            "dify.workflow.aborted",
            attributes={
                DifySpanAttributes.WORKFLOW_ABORT_REASON: reason,
            },
        )
