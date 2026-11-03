"""Unit tests for enterprise/telemetry/telemetry_log.py."""

from __future__ import annotations

import logging
import uuid

import pytest

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

    def test_logs_info_with_event_name_and_signal(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        with caplog.at_level(logging.INFO, logger="dify.telemetry"):
            emit_telemetry_log(
                event_name="dify.workflow.run",
                attributes={"tenant_id": "t1"},
                signal="metric_only",
            )

        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert record.levelno == logging.INFO
        assert record.getMessage() == "telemetry.metric_only"
        assert hasattr(record, "attributes")
        assert record.attributes["dify.event.name"] == "dify.workflow.run"
        assert record.attributes["dify.event.signal"] == "metric_only"
        assert record.attributes["tenant_id"] == "t1"

    def test_no_log_when_info_disabled(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        with caplog.at_level(logging.WARNING, logger="dify.telemetry"):
            emit_telemetry_log(event_name="dify.workflow.run", attributes={})

        assert len(caplog.records) == 0

    def test_trace_id_added_to_extra_when_valid_uuid(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        uid = "123e4567-e89b-12d3-a456-426614174000"

        with caplog.at_level(logging.INFO, logger="dify.telemetry"):
            emit_telemetry_log(event_name="test.event", attributes={}, trace_id_source=uid)

        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert hasattr(record, "trace_id")
        assert len(record.trace_id) == 32

    def test_trace_id_absent_when_invalid_source(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        with caplog.at_level(logging.INFO, logger="dify.telemetry"):
            emit_telemetry_log(event_name="test.event", attributes={}, trace_id_source="bad-id")

        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert not hasattr(record, "trace_id")

    def test_span_id_added_to_extra_when_valid_uuid(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        uid = "123e4567-e89b-12d3-a456-426614174000"

        with caplog.at_level(logging.INFO, logger="dify.telemetry"):
            emit_telemetry_log(event_name="test.event", attributes={}, span_id_source=uid)

        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert hasattr(record, "span_id")
        assert len(record.span_id) == 16

    def test_tenant_id_added_when_provided(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        with caplog.at_level(logging.INFO, logger="dify.telemetry"):
            emit_telemetry_log(event_name="test.event", attributes={}, tenant_id="tenant-99")

        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert hasattr(record, "tenant_id")
        assert record.tenant_id == "tenant-99"

    def test_user_id_added_when_provided(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        with caplog.at_level(logging.INFO, logger="dify.telemetry"):
            emit_telemetry_log(event_name="test.event", attributes={}, user_id="user-42")

        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert hasattr(record, "user_id")
        assert record.user_id == "user-42"

    def test_tenant_and_user_id_absent_when_not_provided(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        with caplog.at_level(logging.INFO, logger="dify.telemetry"):
            emit_telemetry_log(event_name="test.event", attributes={})

        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert not hasattr(record, "tenant_id")
        assert not hasattr(record, "user_id")

    def test_caller_attributes_merged_into_attrs(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        with caplog.at_level(logging.INFO, logger="dify.telemetry"):
            emit_telemetry_log(
                event_name="dify.node.run",
                attributes={"node_type": "code", "elapsed": 0.5},
            )

        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert hasattr(record, "attributes")
        assert record.attributes["node_type"] == "code"
        assert record.attributes["elapsed"] == 0.5

    def test_signal_span_detail_forwarded(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        with caplog.at_level(logging.INFO, logger="dify.telemetry"):
            emit_telemetry_log(event_name="test.event", attributes={}, signal="span_detail")

        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert record.getMessage() == "telemetry.span_detail"
        assert hasattr(record, "attributes")
        assert record.attributes["dify.event.signal"] == "span_detail"


# ---------------------------------------------------------------------------
# emit_metric_only_event
# ---------------------------------------------------------------------------


class TestEmitMetricOnlyEvent:
    def setup_method(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_span_id_hex, compute_trace_id_hex

        compute_trace_id_hex.cache_clear()
        compute_span_id_hex.cache_clear()

    def test_delegates_to_emit_telemetry_log_with_metric_only_signal(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_metric_only_event

        with caplog.at_level(logging.INFO, logger="dify.telemetry"):
            emit_metric_only_event(
                event_name="dify.app.created",
                attributes={"app_id": "app-1"},
                tenant_id="t1",
                user_id="u1",
            )

        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert hasattr(record, "attributes")
        assert record.attributes["dify.event.signal"] == "metric_only"
        assert record.attributes["dify.event.name"] == "dify.app.created"
        assert record.attributes["app_id"] == "app-1"
        assert hasattr(record, "tenant_id")
        assert record.tenant_id == "t1"
        assert hasattr(record, "user_id")
        assert record.user_id == "u1"

    def test_trace_and_span_ids_passed_through(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_metric_only_event

        uid = "123e4567-e89b-12d3-a456-426614174000"

        with caplog.at_level(logging.INFO, logger="dify.telemetry"):
            emit_metric_only_event(
                event_name="dify.workflow.run",
                attributes={},
                trace_id_source=uid,
                span_id_source=uid,
            )

        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert hasattr(record, "trace_id")
        assert hasattr(record, "span_id")

    def test_no_log_emitted_when_logger_disabled(self, caplog: pytest.LogCaptureFixture) -> None:
        from enterprise.telemetry.telemetry_log import emit_metric_only_event

        with caplog.at_level(logging.WARNING, logger="dify.telemetry"):
            emit_metric_only_event(event_name="dify.workflow.run", attributes={})

        assert len(caplog.records) == 0
