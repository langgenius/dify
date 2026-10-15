"""
Tests for SpanHandler base class.

Test coverage:
- _build_span_name method
- _extract_arguments method
- wrapper method default implementation
- Signature caching
"""

from collections.abc import Callable

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from extensions.otel.decorators.handler import SpanHandler


@pytest.fixture(autouse=True)
def _otel_enabled(config_overrides: Callable[..., None]) -> None:
    config_overrides(ENABLE_OTEL=True)


class TestSpanHandlerExtractArguments:
    """Test SpanHandler._extract_arguments method."""

    def test_extract_positional_arguments(self) -> None:
        """Test extracting positional arguments."""
        handler = SpanHandler()

        def func(a: int, b: int, c: int) -> None:
            pass

        result = handler._extract_arguments(func, 1, 2, 3)

        assert result is not None
        assert result["a"] == 1
        assert result["b"] == 2
        assert result["c"] == 3

    def test_extract_keyword_arguments(self) -> None:
        """Test extracting keyword arguments."""
        handler = SpanHandler()

        def func(a: int, b: int, c: int) -> None:
            pass

        result = handler._extract_arguments(func, a=1, b=2, c=3)

        assert result is not None
        assert result["a"] == 1
        assert result["b"] == 2
        assert result["c"] == 3

    def test_extract_mixed_arguments(self) -> None:
        """Test extracting mixed positional and keyword arguments."""
        handler = SpanHandler()

        def func(a: int, b: int, c: int) -> None:
            pass

        result = handler._extract_arguments(func, 1, b=2, c=3)

        assert result is not None
        assert result["a"] == 1
        assert result["b"] == 2
        assert result["c"] == 3

    def test_extract_arguments_with_defaults(self) -> None:
        """Test extracting arguments with default values."""
        handler = SpanHandler()

        def func(a: int, b: int = 10, c: int = 20) -> None:
            pass

        result = handler._extract_arguments(func, 1)

        assert result is not None
        assert result["a"] == 1
        assert result["b"] == 10
        assert result["c"] == 20

    def test_extract_arguments_handles_self(self) -> None:
        """Test extracting arguments from instance method (with self)."""
        handler = SpanHandler()

        class MyClass:
            def method(self, a: int, b: int) -> None:
                pass

        instance = MyClass()
        result = handler._extract_arguments(instance.method, 1, 2)

        assert result is not None
        assert result["a"] == 1
        assert result["b"] == 2

    def test_extract_arguments_returns_none_on_error(self) -> None:
        """Test that _extract_arguments returns None when extraction fails."""
        handler = SpanHandler()

        def func(a: int, b: int) -> None:
            pass

        result = handler._extract_arguments(func, 1)  # pyrefly: ignore[missing-argument]

        assert result is None

    def test_signature_caching(self) -> None:
        """Test that function signatures are cached."""
        handler = SpanHandler()

        def func(a: int, b: int) -> None:
            pass

        assert func not in handler._signature_cache

        handler._extract_arguments(func, 1, 2)
        assert func in handler._signature_cache

        cached_sig = handler._signature_cache[func]
        handler._extract_arguments(func, 3, 4)
        assert handler._signature_cache[func] is cached_sig


class TestSpanHandlerWrapper:
    """Test SpanHandler.wrapper default implementation."""

    def test_wrapper_creates_span(
        self, tracer_provider_with_memory_exporter: TracerProvider, memory_span_exporter: InMemorySpanExporter
    ) -> None:
        """Test that wrapper creates a span."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func() -> str:
            return "result"

        result = handler.wrapper(tracer, test_func)

        assert result == "result"
        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1

    def test_wrapper_sets_span_kind_internal(
        self, tracer_provider_with_memory_exporter: TracerProvider, memory_span_exporter: InMemorySpanExporter
    ) -> None:
        """Test that wrapper sets SpanKind to INTERNAL."""
        from opentelemetry.trace import SpanKind

        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func() -> str:
            return "result"

        handler.wrapper(tracer, test_func)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].kind == SpanKind.INTERNAL

    def test_wrapper_sets_status_ok_on_success(
        self, tracer_provider_with_memory_exporter: TracerProvider, memory_span_exporter: InMemorySpanExporter
    ) -> None:
        """Test that wrapper sets status to OK when function succeeds."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func() -> str:
            return "result"

        handler.wrapper(tracer, test_func)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.OK

    def test_wrapper_records_exception_on_error(
        self, tracer_provider_with_memory_exporter: TracerProvider, memory_span_exporter: InMemorySpanExporter
    ) -> None:
        """Test that wrapper records exception when function raises."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func() -> None:
            raise ValueError("test error")

        with pytest.raises(ValueError, match="test error"):
            handler.wrapper(tracer, test_func)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        events = spans[0].events
        assert len(events) > 0
        assert any("exception" in event.name.lower() for event in events)

    def test_wrapper_sets_status_error_on_exception(
        self, tracer_provider_with_memory_exporter: TracerProvider, memory_span_exporter: InMemorySpanExporter
    ) -> None:
        """Test that wrapper sets status to ERROR when function raises exception."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func() -> None:
            raise ValueError("test error")

        with pytest.raises(ValueError):
            handler.wrapper(tracer, test_func)

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.ERROR
        assert spans[0].status.description is not None
        assert "test error" in spans[0].status.description

    def test_wrapper_re_raises_exception(self, tracer_provider_with_memory_exporter: TracerProvider) -> None:
        """Test that wrapper re-raises exception after recording it."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func() -> None:
            raise ValueError("test error")

        with pytest.raises(ValueError, match="test error"):
            handler.wrapper(tracer, test_func)

    def test_wrapper_passes_arguments_correctly(self, tracer_provider_with_memory_exporter: TracerProvider) -> None:
        """Test that wrapper correctly passes arguments to wrapped function."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func(a: int, b: int, c: int = 10) -> int:
            return a + b + c

        result = handler.wrapper(tracer, test_func, 1, 2, c=3)

        assert result == 6

    def test_wrapper_with_memory_exporter(
        self, tracer_provider_with_memory_exporter: TracerProvider, memory_span_exporter: InMemorySpanExporter
    ) -> None:
        """Test wrapper end-to-end with memory exporter."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def my_function(x: int) -> int:
            return x * 2

        result = handler.wrapper(tracer, my_function, 5)

        assert result == 10
        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert "my_function" in spans[0].name
        assert spans[0].status.status_code == StatusCode.OK
