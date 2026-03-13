"""
Tests for SpanHandler base class.

Test coverage:
- _build_span_name method
- _extract_arguments method
- wrapper method default implementation
- Signature caching
"""

from unittest.mock import patch

import pytest
from opentelemetry.trace import StatusCode

from extensions.otel.decorators.handler import SpanHandler


class TestSpanHandlerExtractArguments:
    """Test SpanHandler._extract_arguments method."""

    def test_extract_positional_arguments(self):
        """Test extracting positional arguments."""
        handler = SpanHandler()

        def func(a, b, c):
            pass

        args = (1, 2, 3)
        kwargs = {}
        result = handler._extract_arguments(func, args, kwargs)

        assert result is not None
        assert result["a"] == 1
        assert result["b"] == 2
        assert result["c"] == 3

    def test_extract_keyword_arguments(self):
        """Test extracting keyword arguments."""
        handler = SpanHandler()

        def func(a, b, c):
            pass

        args = ()
        kwargs = {"a": 1, "b": 2, "c": 3}
        result = handler._extract_arguments(func, args, kwargs)

        assert result is not None
        assert result["a"] == 1
        assert result["b"] == 2
        assert result["c"] == 3

    def test_extract_mixed_arguments(self):
        """Test extracting mixed positional and keyword arguments."""
        handler = SpanHandler()

        def func(a, b, c):
            pass

        args = (1,)
        kwargs = {"b": 2, "c": 3}
        result = handler._extract_arguments(func, args, kwargs)

        assert result is not None
        assert result["a"] == 1
        assert result["b"] == 2
        assert result["c"] == 3

    def test_extract_arguments_with_defaults(self):
        """Test extracting arguments with default values."""
        handler = SpanHandler()

        def func(a, b=10, c=20):
            pass

        args = (1,)
        kwargs = {}
        result = handler._extract_arguments(func, args, kwargs)

        assert result is not None
        assert result["a"] == 1
        assert result["b"] == 10
        assert result["c"] == 20

    def test_extract_arguments_handles_self(self):
        """Test extracting arguments from instance method (with self)."""
        handler = SpanHandler()

        class MyClass:
            def method(self, a, b):
                pass

        instance = MyClass()
        args = (1, 2)
        kwargs = {}
        result = handler._extract_arguments(instance.method, args, kwargs)

        assert result is not None
        assert result["a"] == 1
        assert result["b"] == 2

    def test_extract_arguments_returns_none_on_error(self):
        """Test that _extract_arguments returns None when extraction fails."""
        handler = SpanHandler()

        def func(a, b):
            pass

        args = (1,)
        kwargs = {}
        result = handler._extract_arguments(func, args, kwargs)

        assert result is None

    def test_signature_caching(self):
        """Test that function signatures are cached."""
        handler = SpanHandler()

        def func(a, b):
            pass

        assert func not in handler._signature_cache

        handler._extract_arguments(func, (1, 2), {})
        assert func in handler._signature_cache

        cached_sig = handler._signature_cache[func]
        handler._extract_arguments(func, (3, 4), {})
        assert handler._signature_cache[func] is cached_sig


class TestSpanHandlerWrapper:
    """Test SpanHandler.wrapper default implementation."""

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_wrapper_creates_span(self, tracer_provider_with_memory_exporter, memory_span_exporter):
        """Test that wrapper creates a span."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func():
            return "result"

        result = handler.wrapper(tracer, test_func, (), {})

        assert result == "result"
        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_wrapper_sets_span_kind_internal(self, tracer_provider_with_memory_exporter, memory_span_exporter):
        """Test that wrapper sets SpanKind to INTERNAL."""
        from opentelemetry.trace import SpanKind

        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func():
            return "result"

        handler.wrapper(tracer, test_func, (), {})

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].kind == SpanKind.INTERNAL

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_wrapper_sets_status_ok_on_success(self, tracer_provider_with_memory_exporter, memory_span_exporter):
        """Test that wrapper sets status to OK when function succeeds."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func():
            return "result"

        handler.wrapper(tracer, test_func, (), {})

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.OK

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_wrapper_records_exception_on_error(self, tracer_provider_with_memory_exporter, memory_span_exporter):
        """Test that wrapper records exception when function raises."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func():
            raise ValueError("test error")

        with pytest.raises(ValueError, match="test error"):
            handler.wrapper(tracer, test_func, (), {})

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        events = spans[0].events
        assert len(events) > 0
        assert any("exception" in event.name.lower() for event in events)

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_wrapper_sets_status_error_on_exception(self, tracer_provider_with_memory_exporter, memory_span_exporter):
        """Test that wrapper sets status to ERROR when function raises exception."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func():
            raise ValueError("test error")

        with pytest.raises(ValueError):
            handler.wrapper(tracer, test_func, (), {})

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.ERROR
        assert "test error" in spans[0].status.description

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_wrapper_re_raises_exception(self, tracer_provider_with_memory_exporter):
        """Test that wrapper re-raises exception after recording it."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func():
            raise ValueError("test error")

        with pytest.raises(ValueError, match="test error"):
            handler.wrapper(tracer, test_func, (), {})

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_wrapper_passes_arguments_correctly(self, tracer_provider_with_memory_exporter, memory_span_exporter):
        """Test that wrapper correctly passes arguments to wrapped function."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def test_func(a, b, c=10):
            return a + b + c

        result = handler.wrapper(tracer, test_func, (1, 2), {"c": 3})

        assert result == 6

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_wrapper_with_memory_exporter(self, tracer_provider_with_memory_exporter, memory_span_exporter):
        """Test wrapper end-to-end with memory exporter."""
        handler = SpanHandler()
        tracer = tracer_provider_with_memory_exporter.get_tracer(__name__)

        def my_function(x):
            return x * 2

        result = handler.wrapper(tracer, my_function, (5,), {})

        assert result == 10
        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert "my_function" in spans[0].name
        assert spans[0].status.status_code == StatusCode.OK
