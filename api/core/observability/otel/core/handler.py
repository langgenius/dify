import inspect
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

    _signature_cache: dict[Callable[..., Any], inspect.Signature] = {}

    def _build_span_name(self, wrapped: Callable[..., Any]) -> str:
        """
        Build the span name from the wrapped function.

        Handlers can override this method to customize span name generation.

        :param wrapped: The original function being traced
        :return: The span name
        """
        return f"{wrapped.__module__}.{wrapped.__qualname__}"

    def _extract_arguments(
        self,
        wrapped: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        """
        Extract function arguments using inspect.signature.

        Returns a dictionary of bound arguments, or None if extraction fails.
        Handlers can use this to safely extract parameters from args/kwargs.

        The function signature is cached to improve performance on repeated calls.

        :param wrapped: The function being traced
        :param args: Positional arguments
        :param kwargs: Keyword arguments
        :return: Dictionary of bound arguments, or None if extraction fails
        """
        try:
            if wrapped not in self._signature_cache:
                self._signature_cache[wrapped] = inspect.signature(wrapped)

            sig = self._signature_cache[wrapped]
            bound = sig.bind(*args, **kwargs)
            bound.apply_defaults()
            return bound.arguments
        except Exception:
            return None

    def wrapper(
        self,
        tracer: Any,
        wrapped: Callable[..., Any],
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
        :param args: Positional arguments (including self/cls if applicable)
        :param kwargs: Keyword arguments
        :return: Result of calling wrapped function
        """
        span_name = self._build_span_name(wrapped)
        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            try:
                result = wrapped(*args, **kwargs)
                span.set_status(Status(StatusCode.OK))
                return result
            except Exception as exc:
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                raise
