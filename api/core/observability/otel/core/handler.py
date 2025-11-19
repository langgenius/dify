from collections.abc import Callable, Mapping
from typing import Any

from opentelemetry.trace import SpanKind, Status, StatusCode


class SpanHandler:
    """
    Base class for all span handlers.

    Each instrumentation point provides a handler implementation that fully controls
    how spans are created, annotated, and finalized through the wrapper method.

    This class provides a default implementation that creates a basic span and handles
    exceptions. Handlers can override the wrapper method to customize behavior.
    """

    def wrapper(
        self,
        tracer: Any,
        wrapped: Callable[..., Any],
        span_name: str,
        args: tuple[Any, ...],
        kwargs: Mapping[str, Any],
    ) -> Any:
        """
        Fully control the wrapper behavior.

        Default implementation creates a basic span and handles exceptions.
        Handlers can override this method to provide complete control over:
        - Span creation and configuration
        - Attribute extraction
        - Function invocation
        - Exception handling
        - Status setting

        :param tracer: OpenTelemetry tracer instance
        :param wrapped: The original function being traced
        :param span_name: The span name
        :param args: Positional arguments (including self/cls if applicable)
        :param kwargs: Keyword arguments
        :return: Result of calling wrapped function
        """
        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            try:
                result = wrapped(*args, **kwargs)
                span.set_status(Status(StatusCode.OK))
                return result
            except Exception as exc:
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                raise



