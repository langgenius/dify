"""Unit tests for the OTLP log dual-emit path.

Covers:
- ``compute_otlp_span_id_hex`` (deterministic, non-zero, seed-distinct).
- ``EnterpriseExporter.emit_otel_log`` LogRecord field correctness, the
  disabled (no-op) path, and exception swallowing.
- ``_ExporterFactory.create_log_exporter`` endpoint/protocol shaping.
- ``emit_telemetry_log`` dual-emit gating: OTLP still fires when the stdlib
  logger is below INFO (production ``LOG_LEVEL=WARNING``), is skipped when the
  switch is off or the exporter is missing, and never disturbs the stdout path.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.sdk._logs.export import InMemoryLogRecordExporter, SimpleLogRecordProcessor
from opentelemetry.sdk.resources import Resource
from opentelemetry.trace import TraceFlags

from core.ops.entities.trace_entity import MessageTraceInfo, WorkflowNodeTraceInfo
from enterprise.telemetry.exporter import EnterpriseExporter, _ExporterFactory

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _make_grpc_config(**overrides) -> SimpleNamespace:
    defaults = {
        "ENTERPRISE_OTLP_ENDPOINT": "https://collector.example.com",
        "ENTERPRISE_OTLP_HEADERS": "",
        "ENTERPRISE_OTLP_PROTOCOL": "grpc",
        "ENTERPRISE_SERVICE_NAME": "dify",
        "ENTERPRISE_OTEL_SAMPLING_RATE": 1.0,
        "ENTERPRISE_INCLUDE_CONTENT": True,
        "ENTERPRISE_OTLP_API_KEY": "",
        "ENTERPRISE_OTLP_LOGS_ENABLED": True,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _exporter_with_memory_logs(**config_overrides):
    """Build an EnterpriseExporter whose OTLP logger writes to memory synchronously.

    Returns ``(exporter, memory_exporter)``.
    """
    memory_exporter = InMemoryLogRecordExporter()
    with (
        patch("enterprise.telemetry.exporter.GRPCSpanExporter"),
        patch("enterprise.telemetry.exporter.GRPCMetricExporter"),
        patch("enterprise.telemetry.exporter.GRPCLogExporter"),
    ):
        exporter = EnterpriseExporter(_make_grpc_config(**config_overrides))

    # Replace the batch-backed logger with a synchronous in-memory one so the test
    # can read records back without flushing/timing.
    provider = LoggerProvider(resource=Resource(attributes={"service.name": "dify"}))
    provider.add_log_record_processor(SimpleLogRecordProcessor(memory_exporter))
    exporter._otel_logger = provider.get_logger("dify.enterprise")  # type: ignore[attr-defined]
    return exporter, memory_exporter


# ---------------------------------------------------------------------------
# compute_otlp_span_id_hex
# ---------------------------------------------------------------------------


class TestComputeOtlpSpanIdHex:
    def setup_method(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_otlp_span_id_hex

        compute_otlp_span_id_hex.cache_clear()

    def test_none_returns_empty(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_otlp_span_id_hex

        assert compute_otlp_span_id_hex(None) == ""

    def test_empty_string_returns_empty(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_otlp_span_id_hex

        assert compute_otlp_span_id_hex("") == ""

    def test_produces_16_hex_chars(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_otlp_span_id_hex

        result = compute_otlp_span_id_hex("msg-123:message")
        assert len(result) == 16
        assert all(ch in "0123456789abcdef" for ch in result)

    def test_deterministic(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_otlp_span_id_hex

        seed = "msg-123/node-456/google_search:tool"
        assert compute_otlp_span_id_hex(seed) == compute_otlp_span_id_hex(seed)

    def test_non_zero(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_otlp_span_id_hex

        # Whatever the seed, the span_id must never be zero (OTEL requirement).
        for seed in ("a", "message", "x" * 200, "0", "00000000"):
            result = compute_otlp_span_id_hex(seed)
            assert int(result, 16) != 0

    def test_different_seeds_differ(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_otlp_span_id_hex

        a = compute_otlp_span_id_hex("msg-1:message")
        b = compute_otlp_span_id_hex("msg-2:message")
        c = compute_otlp_span_id_hex("msg-1:tool")
        assert a != b
        assert a != c

    def test_accepts_non_uuid_seed(self) -> None:
        from enterprise.telemetry.telemetry_log import compute_otlp_span_id_hex

        # Composite (non-UUID) seeds are the whole point of this function.
        result = compute_otlp_span_id_hex("not/a/uuid:moderation")
        assert len(result) == 16


# ---------------------------------------------------------------------------
# _ExporterFactory.create_log_exporter
# ---------------------------------------------------------------------------


class TestCreateLogExporter:
    @patch("enterprise.telemetry.exporter.HTTPLogExporter")
    def test_http_appends_v1_logs_path(self, mock_http_log: MagicMock) -> None:
        factory = _ExporterFactory("http", "https://collector.example.com", {"x": "y"}, insecure=False)
        factory.create_log_exporter()
        assert mock_http_log.call_args.kwargs["endpoint"] == "https://collector.example.com/v1/logs"

    @patch("enterprise.telemetry.exporter.HTTPLogExporter")
    def test_http_empty_endpoint_passes_none(self, mock_http_log: MagicMock) -> None:
        factory = _ExporterFactory("http", "", {}, insecure=False)
        factory.create_log_exporter()
        assert mock_http_log.call_args.kwargs["endpoint"] is None

    @patch("enterprise.telemetry.exporter.GRPCLogExporter")
    def test_grpc_uses_base_endpoint_and_insecure(self, mock_grpc_log: MagicMock) -> None:
        factory = _ExporterFactory("grpc", "collector.example.com:4317", {"a": "b"}, insecure=True)
        factory.create_log_exporter()
        assert mock_grpc_log.call_args.kwargs["endpoint"] == "collector.example.com:4317"
        assert mock_grpc_log.call_args.kwargs["insecure"] is True


# ---------------------------------------------------------------------------
# EnterpriseExporter.emit_otel_log
# ---------------------------------------------------------------------------


class TestEmitOtelLog:
    def test_log_record_fields_are_correct(self) -> None:
        exporter, memory = _exporter_with_memory_logs()

        trace_hex = "0123456789abcdef0123456789abcdef"
        span_hex = "1122334455667788"
        exporter.emit_otel_log(
            event_name="dify.workflow.run",
            body="telemetry.span_detail",
            attributes={"dify.event.signal": "span_detail", "dify.parent.trace_id": "abc", "drop_me": None},
            trace_id_hex=trace_hex,
            span_id_hex=span_hex,
            start_unix_nano=1_700_000_000_000_000_000,
            end_unix_nano=1_700_000_000_500_000_000,
        )

        records = memory.get_finished_logs()
        assert len(records) == 1
        rec = records[0].log_record
        assert rec.trace_id == int(trace_hex, 16)
        assert rec.span_id == int(span_hex, 16)
        assert int(rec.trace_flags) == int(TraceFlags.SAMPLED)
        assert rec.timestamp == 1_700_000_000_000_000_000
        assert rec.observed_timestamp == 1_700_000_000_500_000_000
        assert rec.body == "telemetry.span_detail"
        assert rec.event_name == "dify.workflow.run"
        attrs = dict(rec.attributes)
        assert attrs["dify.event.signal"] == "span_detail"
        assert attrs["dify.parent.trace_id"] == "abc"
        # None-valued attributes are dropped (OTEL rejects None attribute values).
        assert "drop_me" not in attrs

    def test_observed_timestamp_falls_back_to_start(self) -> None:
        exporter, memory = _exporter_with_memory_logs()

        exporter.emit_otel_log(
            event_name="dify.message.run",
            body="telemetry.metric_only",
            attributes={},
            trace_id_hex="0" * 32,  # all-zero hex parses to int 0 (collector treats as unset)
            span_id_hex="1122334455667788",
            start_unix_nano=1_700_000_000_000_000_000,
            end_unix_nano=None,
        )

        rec = memory.get_finished_logs()[0].log_record
        assert rec.observed_timestamp == 1_700_000_000_000_000_000

    def test_missing_ids_become_zero(self) -> None:
        exporter, memory = _exporter_with_memory_logs()

        exporter.emit_otel_log(
            event_name="dify.message.run",
            body="telemetry.metric_only",
            attributes={"k": "v"},
            trace_id_hex=None,
            span_id_hex=None,
        )

        rec = memory.get_finished_logs()[0].log_record
        # No ids provided → trace_id/span_id default to 0 (collector treats as unset).
        assert rec.trace_id == 0
        assert rec.span_id == 0

    def test_noop_when_logs_disabled(self) -> None:
        """When ENTERPRISE_OTLP_LOGS_ENABLED is false, no LoggerProvider is built."""
        with (
            patch("enterprise.telemetry.exporter.GRPCSpanExporter"),
            patch("enterprise.telemetry.exporter.GRPCMetricExporter"),
            patch("enterprise.telemetry.exporter.GRPCLogExporter") as mock_log_exporter,
        ):
            exporter = EnterpriseExporter(_make_grpc_config(ENTERPRISE_OTLP_LOGS_ENABLED=False))

        # No log exporter constructed at all (zero cost when disabled).
        mock_log_exporter.assert_not_called()
        assert exporter._otel_logger is None  # type: ignore[attr-defined]
        # Calling emit is a safe no-op.
        exporter.emit_otel_log(event_name="x", body="b", attributes={})

    def test_logger_provider_built_when_enabled(self) -> None:
        with (
            patch("enterprise.telemetry.exporter.GRPCSpanExporter"),
            patch("enterprise.telemetry.exporter.GRPCMetricExporter"),
            patch("enterprise.telemetry.exporter.GRPCLogExporter") as mock_log_exporter,
        ):
            exporter = EnterpriseExporter(_make_grpc_config(ENTERPRISE_OTLP_LOGS_ENABLED=True))

        mock_log_exporter.assert_called_once()
        assert exporter._otel_logger is not None  # type: ignore[attr-defined]

    def test_exception_is_swallowed(self) -> None:
        exporter, _ = _exporter_with_memory_logs()

        boom = MagicMock()
        boom.emit.side_effect = RuntimeError("boom")
        exporter._otel_logger = boom  # type: ignore[attr-defined]

        # Must not raise.
        exporter.emit_otel_log(
            event_name="dify.workflow.run",
            body="telemetry.span_detail",
            attributes={"a": "b"},
            trace_id_hex="0123456789abcdef0123456789abcdef",
            span_id_hex="1122334455667788",
        )

    def test_shutdown_closes_logger_provider(self) -> None:
        with (
            patch("enterprise.telemetry.exporter.GRPCSpanExporter"),
            patch("enterprise.telemetry.exporter.GRPCMetricExporter"),
            patch("enterprise.telemetry.exporter.GRPCLogExporter"),
        ):
            exporter = EnterpriseExporter(_make_grpc_config(ENTERPRISE_OTLP_LOGS_ENABLED=True))

        mock_provider = MagicMock()
        exporter._logger_provider = mock_provider  # type: ignore[attr-defined]
        exporter._tracer_provider = MagicMock()  # type: ignore[attr-defined]
        exporter._meter_provider = MagicMock()  # type: ignore[attr-defined]
        exporter.shutdown()
        mock_provider.shutdown.assert_called_once()


# ---------------------------------------------------------------------------
# emit_telemetry_log dual-emit gating
# ---------------------------------------------------------------------------


class TestDualEmitGating:
    def setup_method(self) -> None:
        from enterprise.telemetry.telemetry_log import (
            compute_otlp_span_id_hex,
            compute_span_id_hex,
            compute_trace_id_hex,
        )

        compute_trace_id_hex.cache_clear()
        compute_span_id_hex.cache_clear()
        compute_otlp_span_id_hex.cache_clear()

    @patch("enterprise.telemetry.telemetry_log.otlp_logs_enabled", return_value=True)
    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_otlp_emitted_even_when_info_disabled(self, mock_logger: MagicMock, mock_enabled: MagicMock) -> None:
        """LOG_LEVEL=WARNING (isEnabledFor(INFO)=False) must NOT suppress OTLP."""
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = False  # WARNING level
        mock_exporter = MagicMock()
        uid = "123e4567-e89b-12d3-a456-426614174000"

        with patch(
            "extensions.ext_enterprise_telemetry.get_enterprise_exporter",
            return_value=mock_exporter,
        ):
            emit_telemetry_log(
                event_name="dify.workflow.run",
                attributes={"k": "v"},
                signal="span_detail",
                trace_id_source=uid,
                span_id_source=uid,
                start_unix_nano=111,
                end_unix_nano=222,
            )

        # stdout path suppressed ...
        mock_logger.info.assert_not_called()
        # ... but OTLP fired.
        mock_exporter.emit_otel_log.assert_called_once()
        kwargs = mock_exporter.emit_otel_log.call_args.kwargs
        assert kwargs["event_name"] == "dify.workflow.run"
        assert kwargs["body"] == "telemetry.span_detail"
        assert kwargs["start_unix_nano"] == 111
        assert kwargs["end_unix_nano"] == 222
        assert kwargs["attributes"]["dify.event.signal"] == "span_detail"
        assert kwargs["attributes"]["dify.event.name"] == "dify.workflow.run"
        assert len(kwargs["trace_id_hex"]) == 32
        assert len(kwargs["span_id_hex"]) == 16

    @patch("enterprise.telemetry.telemetry_log.otlp_logs_enabled", return_value=False)
    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_not_emitted_when_switch_off(self, mock_logger: MagicMock, mock_enabled: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True
        mock_exporter = MagicMock()

        with patch(
            "extensions.ext_enterprise_telemetry.get_enterprise_exporter",
            return_value=mock_exporter,
        ):
            emit_telemetry_log(event_name="dify.workflow.run", attributes={}, signal="metric_only")

        mock_exporter.emit_otel_log.assert_not_called()
        # stdout path still works as before.
        mock_logger.info.assert_called_once()

    @patch("enterprise.telemetry.telemetry_log.otlp_logs_enabled", return_value=True)
    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_graceful_when_exporter_missing(self, mock_logger: MagicMock, mock_enabled: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True

        with patch(
            "extensions.ext_enterprise_telemetry.get_enterprise_exporter",
            return_value=None,
        ):
            # Must not raise even though the exporter is unavailable.
            emit_telemetry_log(event_name="dify.workflow.run", attributes={}, signal="metric_only")

        # stdout path unaffected.
        mock_logger.info.assert_called_once()

    @patch("enterprise.telemetry.telemetry_log.otlp_logs_enabled", return_value=True)
    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_otlp_span_seed_only_affects_otlp_span_id(self, mock_logger: MagicMock, mock_enabled: MagicMock) -> None:
        """otlp_span_seed drives the OTLP span_id; stdout span_id stays derived from span_id_source."""
        from enterprise.telemetry.telemetry_log import compute_otlp_span_id_hex, emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True
        mock_exporter = MagicMock()
        node_uid = "123e4567-e89b-12d3-a456-426614174000"

        with patch(
            "extensions.ext_enterprise_telemetry.get_enterprise_exporter",
            return_value=mock_exporter,
        ):
            emit_telemetry_log(
                event_name="dify.message.run",
                attributes={},
                signal="metric_only",
                span_id_source=node_uid,
                otlp_span_seed="msg-1:message",
            )

        # OTLP span_id == seed-derived value.
        otlp_kwargs = mock_exporter.emit_otel_log.call_args.kwargs
        assert otlp_kwargs["span_id_hex"] == compute_otlp_span_id_hex("msg-1:message")

        # stdout span_id == span_id_source-derived value (UNCHANGED behavior).
        from enterprise.telemetry.telemetry_log import compute_span_id_hex

        stdout_extra = mock_logger.info.call_args.kwargs["extra"]
        assert stdout_extra["span_id"] == compute_span_id_hex(node_uid)
        # And the two differ, proving the OTLP seed did not leak into stdout.
        assert stdout_extra["span_id"] != otlp_kwargs["span_id_hex"]

    @patch("enterprise.telemetry.telemetry_log.otlp_logs_enabled", return_value=True)
    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_otlp_span_id_falls_back_to_stdout_when_no_seed(
        self, mock_logger: MagicMock, mock_enabled: MagicMock
    ) -> None:
        from enterprise.telemetry.telemetry_log import compute_span_id_hex, emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True
        mock_exporter = MagicMock()
        node_uid = "123e4567-e89b-12d3-a456-426614174000"

        with patch(
            "extensions.ext_enterprise_telemetry.get_enterprise_exporter",
            return_value=mock_exporter,
        ):
            emit_telemetry_log(
                event_name="dify.node.execution",
                attributes={},
                signal="span_detail",
                span_id_source=node_uid,
            )

        otlp_kwargs = mock_exporter.emit_otel_log.call_args.kwargs
        assert otlp_kwargs["span_id_hex"] == compute_span_id_hex(node_uid)

    @patch("enterprise.telemetry.telemetry_log.otlp_logs_enabled", return_value=True)
    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_stdout_extra_identical_with_and_without_otlp(
        self, mock_logger: MagicMock, mock_enabled: MagicMock
    ) -> None:
        """The stdout ``extra`` payload must be identical whether OTLP is on or off."""
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True
        uid = "123e4567-e89b-12d3-a456-426614174000"

        def call() -> dict:
            mock_logger.reset_mock()
            mock_logger.isEnabledFor.return_value = True
            with patch(
                "extensions.ext_enterprise_telemetry.get_enterprise_exporter",
                return_value=MagicMock(),
            ):
                emit_telemetry_log(
                    event_name="dify.message.run",
                    attributes={"a": 1},
                    signal="metric_only",
                    trace_id_source=uid,
                    span_id_source=uid,
                    tenant_id="t1",
                    user_id="u1",
                    start_unix_nano=999,
                    end_unix_nano=1000,
                    otlp_span_seed="msg-1:message",
                )
            return mock_logger.info.call_args.kwargs["extra"]

        mock_enabled.return_value = True
        extra_on = call()
        mock_enabled.return_value = False
        extra_off = call()

        assert extra_on == extra_off
        # New OTLP-only params never leak into the stdout extra.
        assert "start_unix_nano" not in extra_on
        assert "otlp_span_seed" not in extra_on

    @patch("enterprise.telemetry.telemetry_log.otlp_logs_enabled", return_value=True)
    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_otlp_trace_id_matches_stdout(self, mock_logger: MagicMock, mock_enabled: MagicMock) -> None:
        """The OTLP trace_id must equal the stdout trace_id (one trace across both signals)."""
        from enterprise.telemetry.telemetry_log import compute_trace_id_hex, emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True
        mock_exporter = MagicMock()
        uid = "123e4567-e89b-12d3-a456-426614174000"

        with patch(
            "extensions.ext_enterprise_telemetry.get_enterprise_exporter",
            return_value=mock_exporter,
        ):
            emit_telemetry_log(
                event_name="dify.workflow.run",
                attributes={},
                signal="span_detail",
                trace_id_source=uid,
                span_id_source=uid,
            )

        otlp_trace = mock_exporter.emit_otel_log.call_args.kwargs["trace_id_hex"]
        stdout_trace = mock_logger.info.call_args.kwargs["extra"]["trace_id"]
        assert otlp_trace == stdout_trace == compute_trace_id_hex(uid)

    @patch("enterprise.telemetry.telemetry_log.otlp_logs_enabled", return_value=True)
    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_no_otlp_emit_when_no_derivable_id(self, mock_logger: MagicMock, mock_enabled: MagicMock) -> None:
        """No trace_id/span_id source or seed → no dual-emit (the collector drops an id-less
        record); the stdout path is unaffected. Covers metric_handler lifecycle/feedback events."""
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True
        mock_exporter = MagicMock()

        with patch(
            "extensions.ext_enterprise_telemetry.get_enterprise_exporter",
            return_value=mock_exporter,
        ):
            emit_telemetry_log(event_name="dify.app.created", attributes={"a": 1}, signal="metric_only")

        mock_exporter.emit_otel_log.assert_not_called()
        mock_logger.info.assert_called_once()


# ---------------------------------------------------------------------------
# dify.parent.* is OTLP-only: never pollutes the stdout path
# ---------------------------------------------------------------------------


class TestParentAttrsOtlpOnly:
    """``otlp_parent_*`` must add ``dify.parent.*`` to the OTLP record ONLY.

    The stdout ``extra`` (and the caller-provided ``attributes`` dict) must stay
    free of any ``dify.parent.*`` key, regardless of the OTLP switch.
    """

    def setup_method(self) -> None:
        from enterprise.telemetry.telemetry_log import (
            compute_otlp_span_id_hex,
            compute_span_id_hex,
            compute_trace_id_hex,
        )

        compute_trace_id_hex.cache_clear()
        compute_span_id_hex.cache_clear()
        compute_otlp_span_id_hex.cache_clear()

    @patch("enterprise.telemetry.telemetry_log.otlp_logs_enabled", return_value=True)
    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_parent_attrs_only_on_otlp_not_stdout(self, mock_logger: MagicMock, mock_enabled: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True
        mock_exporter = MagicMock()
        caller_attrs = {"a": 1}

        with patch(
            "extensions.ext_enterprise_telemetry.get_enterprise_exporter",
            return_value=mock_exporter,
        ):
            emit_telemetry_log(
                event_name="dify.message.run",
                attributes=caller_attrs,
                signal="metric_only",
                otlp_span_seed="msg-1:message",
                otlp_parent_trace_id="outer-run-001",
                otlp_parent_node_execution_id="outer-ne-001",
                otlp_parent_workflow_run_id="outer-run-001",
            )

        # OTLP record carries dify.parent.*
        otlp_attrs = mock_exporter.emit_otel_log.call_args.kwargs["attributes"]
        assert otlp_attrs["dify.parent.trace_id"] == "outer-run-001"
        assert otlp_attrs["dify.parent.node.execution_id"] == "outer-ne-001"
        assert otlp_attrs["dify.parent.workflow.run_id"] == "outer-run-001"

        # stdout extra has NO dify.parent.* at all
        stdout_attrs = mock_logger.info.call_args.kwargs["extra"]["attributes"]
        assert not any(k.startswith("dify.parent.") for k in stdout_attrs)

        # ... and the caller's attributes dict was never mutated.
        assert not any(k.startswith("dify.parent.") for k in caller_attrs)

    @patch("enterprise.telemetry.telemetry_log.otlp_logs_enabled", return_value=True)
    @patch("enterprise.telemetry.telemetry_log.logger")
    def test_none_parent_fields_omitted_from_otlp(self, mock_logger: MagicMock, mock_enabled: MagicMock) -> None:
        from enterprise.telemetry.telemetry_log import emit_telemetry_log

        mock_logger.isEnabledFor.return_value = True
        mock_exporter = MagicMock()

        with patch(
            "extensions.ext_enterprise_telemetry.get_enterprise_exporter",
            return_value=mock_exporter,
        ):
            emit_telemetry_log(
                event_name="dify.message.run",
                attributes={},
                signal="metric_only",
                otlp_span_seed="msg-2:message",
                otlp_parent_trace_id="own-trace",
                otlp_parent_node_execution_id=None,
                otlp_parent_workflow_run_id=None,
            )

        otlp_attrs = mock_exporter.emit_otel_log.call_args.kwargs["attributes"]
        assert otlp_attrs["dify.parent.trace_id"] == "own-trace"
        # Non-nested events have no parent workflow / node — those keys are omitted.
        assert "dify.parent.workflow.run_id" not in otlp_attrs
        assert "dify.parent.node.execution_id" not in otlp_attrs


# ---------------------------------------------------------------------------
# Handler-level: nested parent linkage lands on OTLP only; stdout pre-M1
# ---------------------------------------------------------------------------

_HT0 = datetime(2024, 1, 10, 12, 0, 0, tzinfo=UTC)
_HT1 = datetime(2024, 1, 10, 12, 0, 5, tzinfo=UTC)

# Realistic nested context: ParentTraceContext only carries these two ids.
_NESTED_CTX = {
    "parent_workflow_run_id": "outer-run-001",
    "parent_node_execution_id": "outer-ne-001",
}


def _make_message_info(**overrides):
    defaults = {
        "message_id": "msg-001",
        "conversation_model": "gpt-4",
        "message_tokens": 40,
        "answer_tokens": 60,
        "total_tokens": 100,
        "conversation_mode": "chat",
        "start_time": _HT0,
        "end_time": _HT1,
        "inputs": "user input",
        "outputs": "assistant output",
        "metadata": {
            "app_id": "app-001",
            "tenant_id": "tenant-abc",
            "from_source": "api",
            "ls_provider": "openai",
            "ls_model_name": "gpt-4",
            "status": "succeeded",
        },
    }
    defaults.update(overrides)
    return MessageTraceInfo(**defaults)


def _make_node_info(**overrides):
    defaults = {
        "workflow_id": "wf-001",
        "workflow_run_id": "run-inner-001",
        "tenant_id": "tenant-abc",
        "node_execution_id": "ne-001",
        "node_id": "node-001",
        "node_type": "llm",
        "title": "LLM Node",
        "status": "succeeded",
        "elapsed_time": 2.5,
        "index": 1,
        "total_tokens": 80,
        "prompt_tokens": 50,
        "completion_tokens": 30,
        "model_provider": "openai",
        "model_name": "gpt-4",
        "start_time": _HT0,
        "end_time": _HT1,
        "metadata": {"app_id": "app-001", "tenant_id": "tenant-abc"},
    }
    defaults.update(overrides)
    return WorkflowNodeTraceInfo(**defaults)


@contextmanager
def _drive(mock_exporter):
    """Run a handler body with OTLP enabled and capture stdout + OTLP payloads.

    Yields ``(get_otlp_attrs, get_stdout_attrs)`` callables reading the most recent
    ``emit_otel_log`` / ``logger.info`` invocation. ``mock_exporter`` is shared both
    as the trace handler's exporter and as the dual-emit ``get_enterprise_exporter``.
    """
    from enterprise.telemetry import telemetry_log

    telemetry_log.compute_trace_id_hex.cache_clear()
    telemetry_log.compute_span_id_hex.cache_clear()
    telemetry_log.compute_otlp_span_id_hex.cache_clear()

    with (
        patch("enterprise.telemetry.telemetry_log.otlp_logs_enabled", return_value=True),
        patch("enterprise.telemetry.telemetry_log.logger") as mock_logger,
        patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter", return_value=mock_exporter),
    ):
        mock_logger.isEnabledFor.return_value = True

        def get_otlp_attrs():
            return mock_exporter.emit_otel_log.call_args.kwargs["attributes"]

        def get_stdout_attrs():
            return mock_logger.info.call_args.kwargs["extra"]["attributes"]

        yield get_otlp_attrs, get_stdout_attrs


@pytest.fixture
def handler():
    mock_exporter = MagicMock()
    mock_exporter.include_content = True
    with patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter", return_value=mock_exporter):
        from enterprise.telemetry.enterprise_trace import EnterpriseOtelTrace

        h = EnterpriseOtelTrace()
    return h, mock_exporter


class TestHandlerParentLinkage:
    """Nested parent linkage end-to-end through the real handlers (message metric_only + node span_detail)."""

    def test_nested_message_parent_fields_otlp_only(self, handler):
        h, mock_exporter = handler
        info = _make_message_info(
            metadata={
                "app_id": "app-001",
                "tenant_id": "tenant-abc",
                "from_source": "api",
                "status": "succeeded",
                "node_execution_id": "inner-ne-777",
                "parent_trace_context": dict(_NESTED_CTX),
            }
        )
        with _drive(mock_exporter) as (get_otlp_attrs, get_stdout_attrs):
            h._message_trace(info)
            otlp_attrs = get_otlp_attrs()
            stdout_attrs = get_stdout_attrs()

        # parent trace id derived from the OUTER run id; workflow/node from the ctx.
        assert otlp_attrs["dify.parent.trace_id"] == "outer-run-001"
        assert otlp_attrs["dify.parent.workflow.run_id"] == "outer-run-001"
        assert otlp_attrs["dify.parent.node.execution_id"] == "outer-ne-001"
        # stdout has NO dify.parent.* whatsoever.
        assert not any(k.startswith("dify.parent.") for k in stdout_attrs)

    def test_top_level_message_parent_trace_is_own(self, handler):
        h, mock_exporter = handler
        # No parent_trace_context, but a producing node id present.
        info = _make_message_info(
            metadata={
                "app_id": "app-001",
                "tenant_id": "tenant-abc",
                "from_source": "api",
                "status": "succeeded",
                "workflow_run_id": "run-self-123",
                "node_execution_id": "ne-self-999",
            }
        )
        with _drive(mock_exporter) as (get_otlp_attrs, get_stdout_attrs):
            h._message_trace(info)
            otlp_attrs = get_otlp_attrs()
            stdout_attrs = get_stdout_attrs()

        # Non-nested: parent trace id is the event's own resolved trace (workflow_run_id).
        assert otlp_attrs["dify.parent.trace_id"] == "run-self-123"
        # Direct parent span = the producing node execution.
        assert otlp_attrs["dify.parent.node.execution_id"] == "ne-self-999"
        # No outer workflow → no parent workflow run id key.
        assert "dify.parent.workflow.run_id" not in otlp_attrs
        assert not any(k.startswith("dify.parent.") for k in stdout_attrs)

    def test_nested_node_span_detail_parent_fields_otlp_only(self, handler):
        h, mock_exporter = handler
        info = _make_node_info(
            metadata={
                "app_id": "app-001",
                "tenant_id": "tenant-abc",
                "parent_trace_context": dict(_NESTED_CTX),
            }
        )
        with _drive(mock_exporter) as (get_otlp_attrs, get_stdout_attrs):
            h._node_execution_trace(info)
            otlp_attrs = get_otlp_attrs()
            stdout_attrs = get_stdout_attrs()

        # the nested child-node companion log carries dify.parent.* (OTLP only) so the
        # collector can re-map it to the outer trace, even though trace_id_source is inner.
        assert otlp_attrs["dify.parent.trace_id"] == "outer-run-001"
        assert otlp_attrs["dify.parent.workflow.run_id"] == "outer-run-001"
        assert otlp_attrs["dify.parent.node.execution_id"] == "outer-ne-001"
        assert not any(k.startswith("dify.parent.") for k in stdout_attrs)

    def test_top_level_node_has_no_self_parent_node(self, handler):
        h, mock_exporter = handler
        # A top-level node: metadata carries no node_execution_id (the node's own id is a
        # direct field, not metadata), so it must NOT become its own parent span pointer.
        info = _make_node_info()
        with _drive(mock_exporter) as (get_otlp_attrs, _get_stdout_attrs):
            h._node_execution_trace(info)
            otlp_attrs = get_otlp_attrs()

        assert otlp_attrs["dify.parent.trace_id"] == "run-inner-001"  # own resolved trace
        assert "dify.parent.node.execution_id" not in otlp_attrs
        assert "dify.parent.workflow.run_id" not in otlp_attrs


class TestMetricOnlySpanIdNonZero:
    """metric_only events get a non-zero OTLP span_id even when ids are missing."""

    def test_message_without_ids_still_non_zero_span(self, handler):
        h, mock_exporter = handler
        # message_id None and no node_execution_id → old seed would be None → span_id 0.
        info = _make_message_info(
            message_id=None,
            metadata={"app_id": "app-001", "tenant_id": "tenant-abc", "from_source": "api", "status": "succeeded"},
        )
        with _drive(mock_exporter) as (_get_otlp_attrs, _get_stdout_attrs):
            h._message_trace(info)
            span_hex = mock_exporter.emit_otel_log.call_args.kwargs["span_id_hex"]

        assert span_hex is not None
        assert int(span_hex, 16) != 0

    def test_suggested_question_without_message_id_non_zero_span(self, handler):
        h, mock_exporter = handler
        from core.ops.entities.trace_entity import SuggestedQuestionTraceInfo

        info = SuggestedQuestionTraceInfo(
            message_id=None,
            total_tokens=0,
            suggested_question=["Q?"],
            level="info",
            status="succeeded",
            model_provider="openai",
            model_id="gpt-4",
            start_time=_HT0,
            end_time=_HT1,
            inputs="x",
            outputs="y",
            metadata={"app_id": "app-001", "tenant_id": "tenant-abc"},
        )
        with _drive(mock_exporter) as (_get_otlp_attrs, _get_stdout_attrs):
            h._suggested_question_trace(info)
            span_hex = mock_exporter.emit_otel_log.call_args.kwargs["span_id_hex"]

        assert span_hex is not None
        assert int(span_hex, 16) != 0

    def test_generate_name_without_conversation_id_non_zero_span(self, handler):
        h, mock_exporter = handler
        from core.ops.entities.trace_entity import GenerateNameTraceInfo

        info = GenerateNameTraceInfo(
            conversation_id=None,
            message_id=None,
            inputs={"q": "hi"},
            outputs="My Conversation",
            start_time=_HT0,
            end_time=_HT1,
            tenant_id="tenant-abc",
            metadata={"app_id": "app-001", "tenant_id": "tenant-abc"},
        )
        with _drive(mock_exporter) as (_get_otlp_attrs, _get_stdout_attrs):
            h._generate_name_trace(info)
            span_hex = mock_exporter.emit_otel_log.call_args.kwargs["span_id_hex"]

        assert span_hex is not None
        assert int(span_hex, 16) != 0


# ---------------------------------------------------------------------------
# Failure logging is throttled (no per-event ERROR flood when collector down)
# ---------------------------------------------------------------------------


class TestFailureThrottling:
    """A down collector must not log one ERROR + traceback per telemetry event."""

    def test_emit_otlp_log_failure_is_throttled(self) -> None:
        from enterprise.telemetry import telemetry_log

        with (
            patch("enterprise.telemetry.telemetry_log.logger") as mock_logger,
            patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter") as mock_get,
        ):
            # Exporter that always blows up inside emit_otel_log.
            boom = MagicMock()
            boom.emit_otel_log.side_effect = RuntimeError("collector down")
            mock_get.return_value = boom

            # Reset the module-level counter so the first call is failure #1.
            telemetry_log._otlp_failure_count = 0

            for _ in range(5):
                telemetry_log._emit_otlp_log(
                    event_name="dify.message.run",
                    signal="metric_only",
                    attributes={},
                    trace_id_source=None,
                    span_id_source=None,
                    otlp_span_seed="seed:message",
                    start_unix_nano=None,
                    end_unix_nano=None,
                )

        # Only the FIRST failure logs a full traceback; the rest are swallowed/throttled.
        assert mock_logger.exception.call_count == 1
        # Below the summary interval → no repeated WARNING spam either.
        assert mock_logger.warning.call_count == 0

    def test_emit_otel_log_internal_failure_is_throttled(self) -> None:
        import enterprise.telemetry.exporter as exporter_mod

        exporter, _ = _exporter_with_memory_logs()
        boom = MagicMock()
        boom.emit.side_effect = RuntimeError("boom")
        exporter._otel_logger = boom  # type: ignore[attr-defined]

        with patch.object(exporter_mod, "logger") as mock_logger:
            exporter_mod._emit_failure_count = 0
            for _ in range(4):
                exporter.emit_otel_log(
                    event_name="dify.workflow.run",
                    body="telemetry.span_detail",
                    attributes={"a": "b"},
                    trace_id_hex="0123456789abcdef0123456789abcdef",
                    span_id_hex="1122334455667788",
                )

        assert mock_logger.exception.call_count == 1
        assert mock_logger.warning.call_count == 0
