"""Unit tests for enterprise/telemetry/telemetry_log.py."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# compute_trace_id_hex
# ---------------------------------------------------------------------------


class TestComputeTraceIdHex:
    def setup_method(self) -> None:
        # Clear lru_cache between tests to avoid cross-test pollution
        from enterprise.telemetry.telemetry_log import compute_trace_id_hex

        compute_trace_id_hex.cache_clear()

    def test_none_returns_empty(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_trace_id_hex

        assert compute_trace_id_hex(None) == ""

    def test_empty_string_returns_empty(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_trace_id_hex

        assert compute_trace_id_hex("") == ""

    def test_already_32_hex_chars_returned_as_is(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_trace_id_hex

        hex_id = "a" * 32
        assert compute_trace_id_hex(hex_id) == hex_id

    def test_valid_uuid_string_converted_to_32_hex(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_trace_id_hex

        uid = "123e4567-e89b-12d3-a456-426614174000"
        result = compute_trace_id_hex(uid)
        assert len(result) == 32
        assert all(ch in "0123456789abcdef" for ch in result)
        # Round-trip: int of the UUID should equal the int parsed from result
        assert int(result, 16) == uuid.UUID(uid).int

    def test_invalid_string_returns_empty(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_trace_id_hex

        assert compute_trace_id_hex("not-a-uuid") == ""

    def test_whitespace_stripped(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_trace_id_hex

        uid = "  123e4567-e89b-12d3-a456-426614174000  "
        result = compute_trace_id_hex(uid)
        assert len(result) == 32

    def test_uppercase_uuid_accepted(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_trace_id_hex

        uid = "123E4567-E89B-12D3-A456-426614174000"
        result = compute_trace_id_hex(uid)
        assert len(result) == 32

    def test_result_is_cached(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_trace_id_hex

        uid = "123e4567-e89b-12d3-a456-426614174000"
        r1 = compute_trace_id_hex(uid)
        r2 = compute_trace_id_hex(uid)
        assert r1 == r2
        info = compute_trace_id_hex.cache_info()
        assert info.hits >= 1


# ---------------------------------------------------------------------------
# compute_span_id_hex
# ---------------------------------------------------------------------------


class TestComputeSpanIdHex:
    def setup_method(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_span_id_hex

        compute_span_id_hex.cache_clear()

    def test_none_returns_empty(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_span_id_hex

        assert compute_span_id_hex(None) == ""

    def test_empty_string_returns_empty(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_span_id_hex

        assert compute_span_id_hex("") == ""

    def test_already_16_hex_chars_returned_as_is(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_span_id_hex

        hex_id = "abcdef0123456789"
        assert compute_span_id_hex(hex_id) == hex_id

    def test_valid_uuid_produces_16_hex_span_id(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_span_id_hex

        uid = "123e4567-e89b-12d3-a456-426614174000"
        result = compute_span_id_hex(uid)
        assert len(result) == 16
        assert all(ch in "0123456789abcdef" for ch in result)

    def test_invalid_string_returns_empty(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_span_id_hex

        assert compute_span_id_hex("not-a-uuid-at-all!") == ""

    def test_result_is_cached(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_span_id_hex

        uid = "123e4567-e89b-12d3-a456-426614174000"
        compute_span_id_hex(uid)
        compute_span_id_hex(uid)
        info = compute_span_id_hex.cache_info()
        assert info.hits >= 1


# ---------------------------------------------------------------------------
# emit_telemetry_log
# ---------------------------------------------------------------------------


class TestEmitTelemetryLog:
    def setup_method(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_span_id_hex, compute_trace_id_hex

        compute_trace_id_hex.cache_clear()
        compute_span_id_hex.cache_clear()

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_logs_info_with_event_name_and_signal(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True

        emit_telemetry_log(
            event_name="dify.workflow.run",
            attributes={"tenant_id": "t1"},
            signal="metric_only",
        )

        mock_logger.info.assert_called_once()
        args, kwargs = mock_logger.info.call_args
        assert args[0] == "telemetry.%s"
        assert args[1] == "metric_only"
        extra = kwargs["extra"]
        assert extra["attributes"]["dify.event.name"] == "dify.workflow.run"
        assert extra["attributes"]["dify.event.signal"] == "metric_only"

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_no_log_when_info_disabled(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = False

        emit_telemetry_log(event_name="dify.workflow.run", attributes={})

        mock_logger.info.assert_not_called()

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_trace_id_added_to_extra_when_valid_uuid(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True
        uid = "123e4567-e89b-12d3-a456-426614174000"

        emit_telemetry_log(event_name="test.event", attributes={}, trace_id_source=uid)

        extra = mock_logger.info.call_args.kwargs["extra"]
        assert "trace_id" in extra
        assert len(extra["trace_id"]) == 32

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_trace_id_absent_when_invalid_source(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True

        emit_telemetry_log(event_name="test.event", attributes={}, trace_id_source="bad-id")

        extra = mock_logger.info.call_args.kwargs["extra"]
        assert "trace_id" not in extra

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_span_id_added_to_extra_when_valid_uuid(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True
        uid = "123e4567-e89b-12d3-a456-426614174000"

        emit_telemetry_log(event_name="test.event", attributes={}, span_id_source=uid)

        extra = mock_logger.info.call_args.kwargs["extra"]
        assert "span_id" in extra
        assert len(extra["span_id"]) == 16

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_tenant_id_added_when_provided(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True

        emit_telemetry_log(event_name="test.event", attributes={}, tenant_id="tenant-99")

        extra = mock_logger.info.call_args.kwargs["extra"]
        assert extra["tenant_id"] == "tenant-99"

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_user_id_added_when_provided(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True

        emit_telemetry_log(event_name="test.event", attributes={}, user_id="user-42")

        extra = mock_logger.info.call_args.kwargs["extra"]
        assert extra["user_id"] == "user-42"

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_tenant_and_user_id_absent_when_not_provided(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True

        emit_telemetry_log(event_name="test.event", attributes={})

        extra = mock_logger.info.call_args.kwargs["extra"]
        assert "tenant_id" not in extra
        assert "user_id" not in extra

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_caller_attributes_merged_into_attrs(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True

        emit_telemetry_log(
            event_name="dify.node.run",
            attributes={"node_type": "code", "elapsed": 0.5},
        )

        extra = mock_logger.info.call_args.kwargs["extra"]
        assert extra["attributes"]["node_type"] == "code"
        assert extra["attributes"]["elapsed"] == 0.5

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_signal_span_detail_forwarded(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True

        emit_telemetry_log(event_name="test.event", attributes={}, signal="span_detail")

        args = mock_logger.info.call_args[0]
        assert args[1] == "span_detail"
        extra = mock_logger.info.call_args.kwargs["extra"]
        assert extra["attributes"]["dify.event.signal"] == "span_detail"


# ---------------------------------------------------------------------------
# emit_metric_only_event
# ---------------------------------------------------------------------------


class TestEmitMetricOnlyEvent:
    def setup_method(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_span_id_hex, compute_trace_id_hex

        compute_trace_id_hex.cache_clear()
        compute_span_id_hex.cache_clear()

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_delegates_to_emit_telemetry_log_with_metric_only_signal(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_metric_only_event

        mock_logger.isEnabledFor.return_value = True

        emit_metric_only_event(
            event_name="dify.app.created",
            attributes={"app_id": "app-1"},
            tenant_id="t1",
            user_id="u1",
        )

        mock_logger.info.assert_called_once()
        extra = mock_logger.info.call_args.kwargs["extra"]
        assert extra["attributes"]["dify.event.signal"] == "metric_only"
        assert extra["attributes"]["dify.event.name"] == "dify.app.created"
        assert extra["attributes"]["app_id"] == "app-1"
        assert extra["tenant_id"] == "t1"
        assert extra["user_id"] == "u1"

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_trace_and_span_ids_passed_through(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_metric_only_event

        mock_logger.isEnabledFor.return_value = True
        uid = "123e4567-e89b-12d3-a456-426614174000"

        emit_metric_only_event(
            event_name="dify.workflow.run",
            attributes={},
            trace_id_source=uid,
            span_id_source=uid,
        )

        extra = mock_logger.info.call_args.kwargs["extra"]
        assert "trace_id" in extra
        assert "span_id" in extra

    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_no_log_emitted_when_logger_disabled(self, mock_logger: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_metric_only_event

        mock_logger.isEnabledFor.return_value = False

        emit_metric_only_event(event_name="dify.workflow.run", attributes={})

        mock_logger.info.assert_not_called()
