import functools
from collections.abc import Callable
from typing import Any, TypeVar

from opentelemetry.trace import get_tracer

from configs import dify_config
from core.observability.otel.core.registry import get_span_handler

T = TypeVar("T", bound=Callable[..., Any])


def trace_span(span_name: str) -> Callable[[T], T]:
    """
    Decorator that traces a function with an OpenTelemetry span.

    The decorator looks up a span handler by name and delegates the wrapper
    implementation to that handler, providing necessary infrastructure (tracer, span_name).
    """

    def decorator(func: T) -> T:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            if not dify_config.ENABLE_OTEL:
                return func(*args, **kwargs)

            handler = get_span_handler(span_name)
            tracer = get_tracer(__name__)

            return handler.wrapper(
                tracer=tracer,
                wrapped=func,
                span_name=span_name,
                args=args,
                kwargs=kwargs,
            )

        return wrapper  # type: ignore[misc]

    return decorator

