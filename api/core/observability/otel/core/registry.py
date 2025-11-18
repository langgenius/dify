from core.observability.otel.core.handler import SpanHandler

_SPAN_HANDLERS: dict[str, SpanHandler] = {}
_DEFAULT_HANDLER = SpanHandler()


def register_span_handler(span_name: str, handler: SpanHandler) -> None:
    """Register a handler for the provided span name."""
    _SPAN_HANDLERS[span_name] = handler


def get_span_handler(span_name: str) -> SpanHandler:
    """Return the handler registered for ``span_name`` (or the default handler)."""
    return _SPAN_HANDLERS.get(span_name, _DEFAULT_HANDLER)

