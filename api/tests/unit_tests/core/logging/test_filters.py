"""Tests for logging filters."""

import logging
from unittest import mock


class TestTraceContextFilter:
    def test_sets_empty_trace_id_without_context(self):
        from core.logging.filters import TraceContextFilter

        filter = TraceContextFilter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="test",
            args=(),
            exc_info=None,
        )

        result = filter.filter(record)

        assert result is True
        assert hasattr(record, "trace_id")
        assert hasattr(record, "span_id")
        assert hasattr(record, "req_id")

    def test_filter_always_returns_true(self):
        from core.logging.filters import TraceContextFilter

        filter = TraceContextFilter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="test",
            args=(),
            exc_info=None,
        )

        result = filter.filter(record)
        assert result is True

    def test_sets_trace_id_from_otel_when_available(self):
        from core.logging.filters import TraceContextFilter

        mock_span = mock.MagicMock()
        mock_context = mock.MagicMock()
        mock_context.trace_id = 0x5B8AA5A2D2C872E8321CF37308D69DF2
        mock_context.span_id = 0x051581BF3BB55C45
        mock_span.get_span_context.return_value = mock_context

        with mock.patch("opentelemetry.trace.get_current_span", return_value=mock_span):
            with (
                mock.patch("opentelemetry.trace.span.INVALID_TRACE_ID", 0),
                mock.patch("opentelemetry.trace.span.INVALID_SPAN_ID", 0),
            ):
                filter = TraceContextFilter()
                record = logging.LogRecord(
                    name="test",
                    level=logging.INFO,
                    pathname="",
                    lineno=0,
                    msg="test",
                    args=(),
                    exc_info=None,
                )

                filter.filter(record)

                assert record.trace_id == "5b8aa5a2d2c872e8321cf37308d69df2"
                assert record.span_id == "051581bf3bb55c45"


class TestIdentityContextFilter:
    def test_sets_empty_identity_without_request_context(self):
        from core.logging.filters import IdentityContextFilter

        filter = IdentityContextFilter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="test",
            args=(),
            exc_info=None,
        )

        result = filter.filter(record)

        assert result is True
        assert record.tenant_id == ""
        assert record.user_id == ""
        assert record.user_type == ""

    def test_filter_always_returns_true(self):
        from core.logging.filters import IdentityContextFilter

        filter = IdentityContextFilter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="test",
            args=(),
            exc_info=None,
        )

        result = filter.filter(record)
        assert result is True

    def test_handles_exception_gracefully(self):
        from core.logging.filters import IdentityContextFilter

        filter = IdentityContextFilter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="test",
            args=(),
            exc_info=None,
        )

        # Should not raise even if something goes wrong
        with mock.patch("core.logging.filters.flask.has_request_context", side_effect=Exception("Test error")):
            result = filter.filter(record)
            assert result is True
            assert record.tenant_id == ""
