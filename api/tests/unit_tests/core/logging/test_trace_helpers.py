"""Tests for trace helper functions."""

import re
from unittest import mock


class TestGetSpanIdFromOtelContext:
    def test_returns_none_without_span(self):
        from core.helper.trace_id_helper import get_span_id_from_otel_context

        with mock.patch("opentelemetry.trace.get_current_span", return_value=None):
            result = get_span_id_from_otel_context()
            assert result is None

    def test_returns_span_id_when_available(self):
        from core.helper.trace_id_helper import get_span_id_from_otel_context

        mock_span = mock.MagicMock()
        mock_context = mock.MagicMock()
        mock_context.span_id = 0x051581BF3BB55C45
        mock_span.get_span_context.return_value = mock_context

        with mock.patch("opentelemetry.trace.get_current_span", return_value=mock_span):
            with mock.patch("opentelemetry.trace.span.INVALID_SPAN_ID", 0):
                result = get_span_id_from_otel_context()
                assert result == "051581bf3bb55c45"

    def test_returns_none_on_exception(self):
        from core.helper.trace_id_helper import get_span_id_from_otel_context

        with mock.patch("opentelemetry.trace.get_current_span", side_effect=Exception("Test error")):
            result = get_span_id_from_otel_context()
            assert result is None


class TestGenerateTraceparentHeader:
    def test_generates_valid_format(self):
        from core.helper.trace_id_helper import generate_traceparent_header

        with mock.patch("opentelemetry.trace.get_current_span", return_value=None):
            result = generate_traceparent_header()

            assert result is not None
            # Format: 00-{trace_id}-{span_id}-01
            parts = result.split("-")
            assert len(parts) == 4
            assert parts[0] == "00"  # version
            assert len(parts[1]) == 32  # trace_id (32 hex chars)
            assert len(parts[2]) == 16  # span_id (16 hex chars)
            assert parts[3] == "01"  # flags

    def test_uses_otel_context_when_available(self):
        from core.helper.trace_id_helper import generate_traceparent_header

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
                result = generate_traceparent_header()

                assert result == "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3bb55c45-01"

    def test_generates_hex_only_values(self):
        from core.helper.trace_id_helper import generate_traceparent_header

        with mock.patch("opentelemetry.trace.get_current_span", return_value=None):
            result = generate_traceparent_header()

            parts = result.split("-")
            # All parts should be valid hex
            assert re.match(r"^[0-9a-f]+$", parts[1])
            assert re.match(r"^[0-9a-f]+$", parts[2])


class TestParseTraceparentHeader:
    def test_parses_valid_traceparent(self):
        from core.helper.trace_id_helper import parse_traceparent_header

        traceparent = "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3bb55c45-01"
        result = parse_traceparent_header(traceparent)

        assert result == "5b8aa5a2d2c872e8321cf37308d69df2"

    def test_returns_none_for_invalid_format(self):
        from core.helper.trace_id_helper import parse_traceparent_header

        # Wrong number of parts
        assert parse_traceparent_header("00-abc-def") is None
        # Wrong trace_id length
        assert parse_traceparent_header("00-abc-def-01") is None

    def test_returns_none_for_empty_string(self):
        from core.helper.trace_id_helper import parse_traceparent_header

        assert parse_traceparent_header("") is None
