"""Utilities for propagating OpenTelemetry context across execution boundaries."""

import functools
from collections.abc import Callable

from opentelemetry import context as otel_context


def propagate_context[**P, R](func: Callable[P, R]) -> Callable[P, R]:
    """Capture the current context and attach it whenever ``func`` executes."""
    captured_context = otel_context.get_current()

    @functools.wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        token = otel_context.attach(captured_context)
        try:
            return func(*args, **kwargs)
        finally:
            otel_context.detach(token)

    return wrapper
