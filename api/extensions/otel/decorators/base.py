import functools
import os
from collections.abc import Callable
from typing import Any, TypeVar, cast

from opentelemetry.trace import get_tracer

from configs import dify_config
from extensions.otel.decorators.handler import SpanHandler

T = TypeVar("T", bound=Callable[..., Any])

_HANDLER_INSTANCES: dict[type[SpanHandler], SpanHandler] = {SpanHandler: SpanHandler()}


def _is_instrument_flag_enabled() -> bool:
    """
    Check if external instrumentation is enabled via environment variable.

    Third-party non-invasive instrumentation agents set this flag to coordinate
    with Dify's manual OpenTelemetry instrumentation.
    """
    return os.getenv("ENABLE_OTEL_FOR_INSTRUMENT", "").strip().lower() == "true"


def _get_handler_instance(handler_class: type[SpanHandler]) -> SpanHandler:
    """Get or create a singleton instance of the handler class."""
    if handler_class not in _HANDLER_INSTANCES:
        _HANDLER_INSTANCES[handler_class] = handler_class()
    return _HANDLER_INSTANCES[handler_class]


def trace_span(handler_class: type[SpanHandler] | None = None) -> Callable[[T], T]:
    """
    Decorator that traces a function with an OpenTelemetry span.

    The decorator uses the provided handler class to create a singleton handler instance
    and delegates the wrapper implementation to that handler.

    :param handler_class: Optional handler class to use for this span. If None, uses the default SpanHandler.
    """

    def decorator(func: T) -> T:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            if not (dify_config.ENABLE_OTEL or _is_instrument_flag_enabled()):
                return func(*args, **kwargs)

            handler = _get_handler_instance(handler_class or SpanHandler)
            tracer = get_tracer(__name__)

            return handler.wrapper(
                tracer=tracer,
                wrapped=func,
                args=args,
                kwargs=kwargs,
            )

        return cast(T, wrapper)

    return decorator
