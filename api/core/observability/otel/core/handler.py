from collections.abc import Callable, Mapping
from typing import Any

from opentelemetry.trace import Span, SpanKind, Status, StatusCode
from opentelemetry.util.types import AttributeValue


class SpanHandler:
    """
    Base class for all span handlers.

    Each instrumentation point can provide a handler implementation that customizes
    how spans are created, annotated, and finalized.

    Handler methods receive:
    - wrapped: The original function being traced
    - args: Positional arguments (including self/cls if applicable)
    - kwargs: Keyword arguments
    """

    def build_attributes(
        self,
        wrapped: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: Mapping[str, Any],
    ) -> dict[str, AttributeValue]:
        """
        Build the attribute dictionary for the span.

        Handlers can override this to extract structured metadata from the wrapped function.

        :param wrapped: The original function being traced
        :param args: Positional arguments (including self/cls if applicable)
        :param kwargs: Keyword arguments
        """
        return {}

    def get_span_kind(self) -> SpanKind:
        """Return the SpanKind. Defaults to INTERNAL."""
        return SpanKind.INTERNAL

    def on_span_start(
        self,
        span: Span,
        wrapped: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: Mapping[str, Any],
    ) -> None:
        """Hook invoked immediately after the span is created."""
        return None

    def on_success(
        self,
        span: Span,
        result: Any,
        wrapped: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: Mapping[str, Any],
    ) -> None:
        """Hook invoked when the wrapped function completes successfully."""
        return None

    def on_error(
        self,
        span: Span,
        exception: Exception,
        wrapped: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: Mapping[str, Any],
    ) -> None:
        """Hook invoked when the wrapped function raises an exception."""
        return None

    def build_status(self, result: Any, exception: Exception | None) -> Status:
        """
        Build the final Status for the span.

        Default behavior marks spans as OK on success and ERROR on exceptions.
        """
        if exception:
            return Status(StatusCode.ERROR, str(exception))
        return Status(StatusCode.OK)

    def should_record_exception(self, exception: Exception) -> bool:
        """Return whether the exception should be recorded on the span."""
        return True



