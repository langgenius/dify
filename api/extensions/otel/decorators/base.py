import functools
from collections.abc import Callable
from typing import ParamSpec, TypeVar, cast

from opentelemetry.trace import get_tracer

from configs import dify_config
from extensions.otel.decorators.handler import SpanHandler
from extensions.otel.runtime import is_instrument_flag_enabled

P = ParamSpec("P")
R = TypeVar("R")

_HANDLER_INSTANCES: dict[type[SpanHandler], SpanHandler] = {SpanHandler: SpanHandler()}


def _get_handler_instance(handler_class: type[SpanHandler]) -> SpanHandler:
    """Get or create a singleton instance of the handler class."""
    if handler_class not in _HANDLER_INSTANCES:
        _HANDLER_INSTANCES[handler_class] = handler_class()
    return _HANDLER_INSTANCES[handler_class]


def trace_span(handler_class: type[SpanHandler] | None = None) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """
    Decorator that traces a function with an OpenTelemetry span.

    The decorator uses the provided handler class to create a singleton handler instance
    and delegates the wrapper implementation to that handler.

    :param handler_class: Optional handler class to use for this span. If None, uses the default SpanHandler.
    """

    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        @functools.wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            if not (dify_config.ENABLE_OTEL or is_instrument_flag_enabled()):
                return func(*args, **kwargs)

            handler = _get_handler_instance(handler_class or SpanHandler)
            tracer = get_tracer(__name__)

            return handler.wrapper(
                tracer=tracer,
                wrapped=func,
                args=args,
                kwargs=kwargs,
            )

        return cast(Callable[P, R], wrapper)

    return decorator
