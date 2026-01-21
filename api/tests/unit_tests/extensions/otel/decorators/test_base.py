"""
Tests for trace_span decorator.

Test coverage:
- Decorator basic functionality
- Enable/disable logic
- Handler singleton management
- Integration with OpenTelemetry SDK
"""

from unittest.mock import patch

import pytest
from opentelemetry.trace import StatusCode

from extensions.otel.decorators.base import trace_span


class TestTraceSpanDecorator:
    """Test trace_span decorator basic functionality."""

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_decorated_function_executes_normally(self, tracer_provider_with_memory_exporter):
        """Test that decorated function executes and returns correct value."""

        @trace_span()
        def test_func(x, y):
            return x + y

        result = test_func(2, 3)
        assert result == 5

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_decorator_with_args_and_kwargs(self, tracer_provider_with_memory_exporter):
        """Test that decorator correctly handles args and kwargs."""

        @trace_span()
        def test_func(a, b, c=10):
            return a + b + c

        result = test_func(1, 2, c=3)
        assert result == 6


class TestTraceSpanWithMemoryExporter:
    """Test trace_span with MemorySpanExporter to verify span creation."""

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_span_is_created_and_exported(self, tracer_provider_with_memory_exporter, memory_span_exporter):
        """Test that span is created and exported to memory exporter."""

        @trace_span()
        def test_func():
            return "result"

        test_func()

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_span_name_matches_function(self, tracer_provider_with_memory_exporter, memory_span_exporter):
        """Test that span name matches the decorated function."""

        @trace_span()
        def my_test_function():
            return "result"

        my_test_function()

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert "my_test_function" in spans[0].name

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_span_status_is_ok_on_success(self, tracer_provider_with_memory_exporter, memory_span_exporter):
        """Test that span status is OK when function succeeds."""

        @trace_span()
        def test_func():
            return "result"

        test_func()

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.OK

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_span_status_is_error_on_exception(self, tracer_provider_with_memory_exporter, memory_span_exporter):
        """Test that span status is ERROR when function raises exception."""

        @trace_span()
        def test_func():
            raise ValueError("test error")

        with pytest.raises(ValueError, match="test error"):
            test_func()

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.ERROR

    @patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True)
    def test_exception_is_recorded_in_span(self, tracer_provider_with_memory_exporter, memory_span_exporter):
        """Test that exception details are recorded in span events."""

        @trace_span()
        def test_func():
            raise ValueError("test error")

        with pytest.raises(ValueError):
            test_func()

        spans = memory_span_exporter.get_finished_spans()
        assert len(spans) == 1
        events = spans[0].events
        assert len(events) > 0
        assert any("exception" in event.name.lower() for event in events)
