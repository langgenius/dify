# Import handlers module to trigger handler registrations on import
from core.observability.otel import handlers as _otel_handlers
from core.observability.otel.core.decorators import trace_span
from core.observability.otel.core.handler import SpanHandler
from core.observability.otel.core.registry import register_span_handler

__all__ = ["SpanHandler", "trace_span", "register_span_handler"]

