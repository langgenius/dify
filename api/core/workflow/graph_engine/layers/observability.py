"""
Observability layer for GraphEngine.

This layer creates OpenTelemetry spans for node execution, enabling distributed
tracing of workflow execution. It establishes OTel context during node execution
so that automatic instrumentation (HTTP requests, DB queries, etc.) automatically
associates with the node span.
"""

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, final

from typing_extensions import override

from configs import dify_config
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.nodes.base.node import Node

if TYPE_CHECKING:
    from opentelemetry.trace import Span

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
        self._tracer = None

    def _get_tracer(self):
        """Get or create the OpenTelemetry tracer."""
        if not dify_config.ENABLE_OTEL:
            return None

        if self._tracer is None:
            try:
                from opentelemetry.trace import get_tracer

                self._tracer = get_tracer(__name__)
            except Exception as e:
                logger.warning("Failed to get OpenTelemetry tracer: %s", e)
                return None

        return self._tracer

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
        if not dify_config.ENABLE_OTEL:
            return

        try:
            tracer = self._get_tracer()
            if not tracer:
                return

            if not node._node_execution_id:
                return

            from opentelemetry import context as context_api
            from opentelemetry.trace import SpanKind, set_span_in_context

            parent_context = context_api.get_current()
            span = tracer.start_span(
                f"node.{node.node_type.value}",
                kind=SpanKind.INTERNAL,
                context=parent_context,
            )

            new_context = set_span_in_context(span)
            token = context_api.attach(new_context)

            self._node_contexts[node._node_execution_id] = _NodeSpanContext(span=span, token=token)

        except Exception as e:
            logger.debug("Failed to create OpenTelemetry span for node %s: %s", node.id, e)

    @override
    def on_node_run_end(self, node: Node, error: Exception | None) -> None:
        """
        Called when a node finishes execution.

        Sets complete attributes, records exceptions, and ends the span.
        """
        if not dify_config.ENABLE_OTEL:
            return

        try:
            if not node._node_execution_id:
                return

            node_context = self._node_contexts.get(node._node_execution_id)
            if not node_context:
                return
            span = node_context.span

            from opentelemetry.trace.status import Status, StatusCode
            from opentelemetry import context as context_api

            try:
                span.set_attribute("node.type", node.node_type.value)
                span.set_attribute("node.id", node.id)
                span.set_attribute("node.execution_id", node._node_execution_id)
                if hasattr(node, "title") and node.title:
                    span.set_attribute("node.title", node.title)

                if error:
                    span.record_exception(error)
                    span.set_status(Status(StatusCode.ERROR, str(error)))
                else:
                    span.set_status(Status(StatusCode.OK))

                span.end()
            finally:
                token = node_context.token
                if token is not None:
                    try:
                        context_api.detach(token)
                    except Exception:
                        pass
                self._node_contexts.pop(node._node_execution_id, None)

        except Exception as e:
            logger.debug("Failed to end OpenTelemetry span for node %s: %s", node.id, e)

    @override
    def on_event(self, event) -> None:
        """Not used in this layer."""

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        """Called when graph execution ends."""
        if self._node_contexts:
            logger.warning(
                "ObservabilityLayer: %d node spans were not properly ended",
                len(self._node_contexts),
            )
            from opentelemetry import context as context_api

            for node_context in self._node_contexts.values():
                try:
                    context_api.detach(node_context.token)
                except Exception:
                    pass
            self._node_contexts.clear()

