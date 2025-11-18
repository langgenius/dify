import functools
import logging
from collections.abc import Callable
from typing import Any, TypeVar

from opentelemetry.trace import get_tracer

from configs import dify_config
from core.observability.otel.core.registry import get_span_handler

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=Callable[..., Any])


def trace_span(span_name: str) -> Callable[[T], T]:
    """
    Decorator that traces a function with an OpenTelemetry span.

    The decorator looks up a span handler by name and delegates all lifecycle hooks
    (attributes, span kind, status, etc.) to that handler.
    """

    def decorator(func: T) -> T:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            if not dify_config.ENABLE_OTEL:
                return func(*args, **kwargs)

            wrapped = func

            handler = get_span_handler(span_name)
            tracer = get_tracer(__name__)

            try:
                attributes = handler.build_attributes(wrapped, args, kwargs) or {}
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.warning("Failed to build span attributes for %s: %s", span_name, exc)
                attributes = {}

            span_kind = handler.get_span_kind()

            with tracer.start_as_current_span(span_name, kind=span_kind, attributes=attributes) as span:
                handler.on_span_start(span, wrapped, args, kwargs)

                exception: Exception | None = None
                result: Any = None

                try:
                    result = func(*args, **kwargs)
                    handler.on_success(span, result, wrapped, args, kwargs)
                    return result
                except Exception as exc:
                    exception = exc
                    handler.on_error(span, exc, wrapped, args, kwargs)
                    if handler.should_record_exception(exc):
                        span.record_exception(exc)
                    raise
                finally:
                    status = handler.build_status(result, exception)
                    span.set_status(status)

        return wrapper  # type: ignore[misc]

    return decorator

