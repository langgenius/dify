"""Tests for logging filters."""

import logging
from unittest import mock

import pytest


@pytest.fixture
def log_record():
    return logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname="",
        lineno=0,
        msg="test",
        args=(),
        exc_info=None,
    )


class TestTraceContextFilter:
    def test_sets_empty_trace_id_without_context(self, log_record):
        from core.logging.context import clear_request_context
        from core.logging.filters import TraceContextFilter

        # Ensure no context is set
        clear_request_context()

        filter = TraceContextFilter()
        result = filter.filter(log_record)

        assert result is True
        assert hasattr(log_record, "trace_id")
        assert hasattr(log_record, "span_id")
        assert hasattr(log_record, "req_id")
        # Without context, IDs should be empty
        assert log_record.trace_id == ""
        assert log_record.req_id == ""

    def test_sets_trace_id_from_context(self, log_record):
        """Test that trace_id and req_id are set from ContextVar when initialized."""
        from core.logging.context import init_request_context
        from core.logging.filters import TraceContextFilter

        # Initialize context (no Flask needed!)
        init_request_context()

        filter = TraceContextFilter()
        filter.filter(log_record)

        # With context initialized, IDs should be set
        assert log_record.trace_id != ""
        assert len(log_record.trace_id) == 32
        assert log_record.req_id != ""
        assert len(log_record.req_id) == 10

    def test_filter_always_returns_true(self, log_record):
        from core.logging.filters import TraceContextFilter

        filter = TraceContextFilter()
        result = filter.filter(log_record)
        assert result is True

    def test_sets_trace_id_from_otel_when_available(self, log_record):
        from core.logging.filters import TraceContextFilter

        mock_span = mock.MagicMock()
        mock_context = mock.MagicMock()
        mock_context.trace_id = 0x5B8AA5A2D2C872E8321CF37308D69DF2
        mock_context.span_id = 0x051581BF3BB55C45
        mock_span.get_span_context.return_value = mock_context

        with (
            mock.patch("opentelemetry.trace.get_current_span", return_value=mock_span),
            mock.patch("opentelemetry.trace.span.INVALID_TRACE_ID", 0),
            mock.patch("opentelemetry.trace.span.INVALID_SPAN_ID", 0),
        ):
            filter = TraceContextFilter()
            filter.filter(log_record)

            assert log_record.trace_id == "5b8aa5a2d2c872e8321cf37308d69df2"
            assert log_record.span_id == "051581bf3bb55c45"


class TestIdentityContextFilter:
    def test_sets_empty_identity_without_request_context(self, log_record):
        from core.logging.filters import IdentityContextFilter

        filter = IdentityContextFilter()
        result = filter.filter(log_record)

        assert result is True
        assert log_record.tenant_id == ""
        assert log_record.user_id == ""
        assert log_record.user_type == ""

    def test_filter_always_returns_true(self, log_record):
        from core.logging.filters import IdentityContextFilter

        filter = IdentityContextFilter()
        result = filter.filter(log_record)
        assert result is True

    def test_handles_exception_gracefully(self, log_record):
        from core.logging.filters import IdentityContextFilter

        filter = IdentityContextFilter()

        # Should not raise even if something goes wrong
        with mock.patch("core.logging.filters.flask.has_request_context", side_effect=Exception("Test error")):
            result = filter.filter(log_record)
            assert result is True
            assert log_record.tenant_id == ""
