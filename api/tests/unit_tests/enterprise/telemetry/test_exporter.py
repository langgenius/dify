"""Unit tests for EnterpriseExporter and _ExporterFactory."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

import pytest
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter as RealGRPCMetricExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter as RealGRPCSpanExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter as RealHTTPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter as RealHTTPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import enterprise.telemetry.exporter as exporter_module
from configs import DifyConfig
from configs.enterprise import EnterpriseTelemetryConfig
from enterprise.telemetry.entities import EnterpriseTelemetryCounter, EnterpriseTelemetryHistogram
from enterprise.telemetry.exporter import EnterpriseExporter, _datetime_to_ns, _parse_otlp_headers


def _make_grpc_config(**overrides: object) -> DifyConfig:
    defaults: dict[str, object] = {
        "ENTERPRISE_OTLP_ENDPOINT": "https://collector.example.com",
        "ENTERPRISE_OTLP_HEADERS": "",
        "ENTERPRISE_OTLP_PROTOCOL": "grpc",
        "APPLICATION_NAME": "dify",
        "ENTERPRISE_OTEL_SAMPLING_RATE": 1.0,
        "ENTERPRISE_INCLUDE_CONTENT": True,
        "ENTERPRISE_OTLP_API_KEY": "",
    }
    defaults.update(overrides)
    return DifyConfig.model_validate(defaults)


@contextmanager
def _running_exporter(config: DifyConfig) -> Iterator[EnterpriseExporter]:
    exporter = EnterpriseExporter(config)
    try:
        yield exporter
    finally:
        exporter._tracer_provider.shutdown()
        exporter._meter_provider.shutdown()


def _record_grpc_construction(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    span_calls: list[dict[str, object]] = []
    metric_calls: list[dict[str, object]] = []

    def create_span_exporter(**kwargs: object) -> RealGRPCSpanExporter:
        span_calls.append(kwargs)
        return RealGRPCSpanExporter(**kwargs)

    def create_metric_exporter(**kwargs: object) -> RealGRPCMetricExporter:
        metric_calls.append(kwargs)
        return RealGRPCMetricExporter(**kwargs)

    monkeypatch.setattr(exporter_module, "GRPCSpanExporter", create_span_exporter)
    monkeypatch.setattr(exporter_module, "GRPCMetricExporter", create_metric_exporter)
    return span_calls, metric_calls


def _record_http_construction(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    span_calls: list[dict[str, object]] = []
    metric_calls: list[dict[str, object]] = []

    def create_span_exporter(**kwargs: object) -> RealHTTPSpanExporter:
        span_calls.append(kwargs)
        return RealHTTPSpanExporter(**kwargs)

    def create_metric_exporter(**kwargs: object) -> RealHTTPMetricExporter:
        metric_calls.append(kwargs)
        return RealHTTPMetricExporter(**kwargs)

    monkeypatch.setattr(exporter_module, "HTTPSpanExporter", create_span_exporter)
    monkeypatch.setattr(exporter_module, "HTTPMetricExporter", create_metric_exporter)
    return span_calls, metric_calls


def test_config_api_key_default_empty():
    """Test that ENTERPRISE_OTLP_API_KEY defaults to empty string."""
    config = EnterpriseTelemetryConfig()
    assert config.ENTERPRISE_OTLP_API_KEY == ""


def test_api_key_only_injects_bearer_header(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that API key alone injects Bearer authorization header."""
    span_calls, _ = _record_grpc_construction(monkeypatch)
    config = _make_grpc_config(ENTERPRISE_OTLP_API_KEY="test-secret-key")

    with _running_exporter(config):
        pass

    headers = span_calls[0]["headers"]
    assert isinstance(headers, tuple)
    assert ("authorization", "Bearer test-secret-key") in headers


def test_empty_api_key_no_auth_header(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that empty API key does not inject authorization header."""
    span_calls, _ = _record_grpc_construction(monkeypatch)

    with _running_exporter(_make_grpc_config()):
        pass

    headers = span_calls[0]["headers"]
    if headers is not None:
        assert isinstance(headers, tuple)
        assert not any(key == "authorization" for key, _ in headers)


def test_api_key_and_custom_headers_merge(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that API key and custom headers are merged correctly."""
    span_calls, _ = _record_grpc_construction(monkeypatch)
    config = _make_grpc_config(
        ENTERPRISE_OTLP_HEADERS="x-custom=foo",
        ENTERPRISE_OTLP_API_KEY="test-key",
    )

    with _running_exporter(config):
        pass

    headers = span_calls[0]["headers"]
    assert isinstance(headers, tuple)
    assert ("authorization", "Bearer test-key") in headers
    assert ("x-custom", "foo") in headers


def test_api_key_overrides_conflicting_header(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Test that API key overrides conflicting authorization header and logs warning."""
    span_calls, _ = _record_grpc_construction(monkeypatch)
    config = _make_grpc_config(
        ENTERPRISE_OTLP_HEADERS="authorization=Basic+old",
        ENTERPRISE_OTLP_API_KEY="test-key",
    )

    with caplog.at_level(logging.WARNING, logger="enterprise.telemetry.exporter"):
        with _running_exporter(config):
            pass

    headers = span_calls[0]["headers"]
    assert isinstance(headers, tuple)
    assert ("authorization", "Bearer test-key") in headers
    assert ("authorization", "Basic old") not in headers

    assert "ENTERPRISE_OTLP_API_KEY is set" in caplog.text
    assert "authorization" in caplog.text


def test_https_endpoint_uses_secure_grpc(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that https:// endpoint enables TLS (insecure=False) for gRPC."""
    span_calls, metric_calls = _record_grpc_construction(monkeypatch)

    with _running_exporter(_make_grpc_config(ENTERPRISE_OTLP_API_KEY="test-key")):
        pass

    assert span_calls[0]["insecure"] is False
    assert metric_calls[0]["insecure"] is False


def test_http_endpoint_uses_insecure_grpc(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that http:// endpoint uses insecure gRPC (insecure=True)."""
    span_calls, metric_calls = _record_grpc_construction(monkeypatch)

    with _running_exporter(_make_grpc_config(ENTERPRISE_OTLP_ENDPOINT="http://collector.example.com")):
        pass

    assert span_calls[0]["insecure"] is True
    assert metric_calls[0]["insecure"] is True


def test_insecure_not_passed_to_http_exporters(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that insecure parameter is not passed to HTTP exporters."""
    span_calls, metric_calls = _record_http_construction(monkeypatch)
    config = _make_grpc_config(
        ENTERPRISE_OTLP_ENDPOINT="http://collector.example.com",
        ENTERPRISE_OTLP_PROTOCOL="http",
        ENTERPRISE_OTLP_API_KEY="test-key",
    )

    with _running_exporter(config):
        pass

    assert "insecure" not in span_calls[0]
    assert "insecure" not in metric_calls[0]


def test_api_key_with_special_chars_preserved(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that API key with special characters is preserved without mangling."""
    special_key = "abc+def/ghi=jkl=="
    span_calls, _ = _record_grpc_construction(monkeypatch)

    with _running_exporter(_make_grpc_config(ENTERPRISE_OTLP_API_KEY=special_key)):
        pass

    headers = span_calls[0]["headers"]
    assert isinstance(headers, tuple)
    assert ("authorization", f"Bearer {special_key}") in headers


def test_no_scheme_localhost_uses_insecure(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that endpoint without scheme defaults to insecure for localhost."""
    span_calls, metric_calls = _record_grpc_construction(monkeypatch)

    with _running_exporter(_make_grpc_config(ENTERPRISE_OTLP_ENDPOINT="localhost:4317")):
        pass

    assert span_calls[0]["insecure"] is True
    assert metric_calls[0]["insecure"] is True


def test_no_scheme_production_uses_insecure(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that endpoint without scheme defaults to insecure (not https://)."""
    span_calls, metric_calls = _record_grpc_construction(monkeypatch)

    with _running_exporter(_make_grpc_config(ENTERPRISE_OTLP_ENDPOINT="collector.example.com:4317")):
        pass

    assert span_calls[0]["insecure"] is True
    assert metric_calls[0]["insecure"] is True


# ---------------------------------------------------------------------------
# _parse_otlp_headers (line 55 — pair without "=" is skipped)
# ---------------------------------------------------------------------------


def test_parse_otlp_headers_empty_returns_empty_dict() -> None:
    assert _parse_otlp_headers("") == {}


def test_parse_otlp_headers_value_may_contain_equals() -> None:
    result = _parse_otlp_headers("token=abc=def==")
    assert result == {"token": "abc=def=="}


def test_parse_otlp_headers_url_encoded() -> None:
    result = _parse_otlp_headers("key=%E4%BD%A0%E5%A5%BD")

    assert result == {"key": "你好"}


# ---------------------------------------------------------------------------
# _datetime_to_ns (lines 64-68)
# ---------------------------------------------------------------------------


def test_datetime_to_ns_naive_treated_as_utc() -> None:
    """Naive datetime must be interpreted as UTC (line 64-65)."""
    naive = datetime(2024, 1, 1, 0, 0, 0)  # no tzinfo
    aware_utc = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)
    assert _datetime_to_ns(naive) == _datetime_to_ns(aware_utc)


def test_datetime_to_ns_tz_aware_converted_to_utc() -> None:
    """Timezone-aware datetime must be converted to UTC before computing ns (line 66-67)."""
    import zoneinfo

    eastern = zoneinfo.ZoneInfo("America/New_York")
    dt_east = datetime(2024, 6, 1, 12, 0, 0, tzinfo=eastern)  # UTC-4 in summer
    dt_utc = dt_east.astimezone(UTC)
    assert _datetime_to_ns(dt_east) == _datetime_to_ns(dt_utc)


def test_datetime_to_ns_returns_integer_nanoseconds() -> None:
    dt = datetime(2024, 1, 1, 0, 0, 1, tzinfo=UTC)
    result = _datetime_to_ns(dt)
    # 2024-01-01 00:00:01 UTC = epoch + some_seconds; result should be in nanoseconds
    assert isinstance(result, int)
    # 1 second past epoch start of 2024 — should be > 1_700_000_000_000_000_000 (rough lower bound)
    assert result > 1_700_000_000_000_000_000


# ---------------------------------------------------------------------------
# EnterpriseExporter constructor — include_content property (line 115 / 288-289)
# ---------------------------------------------------------------------------


def test_include_content_true_stored_on_exporter() -> None:
    """include_content=True is stored as a public attribute (line 115)."""
    with _running_exporter(_make_grpc_config(ENTERPRISE_INCLUDE_CONTENT=True)) as exporter:
        assert exporter.include_content is True


def test_include_content_false_stored_on_exporter() -> None:
    """include_content=False is preserved (lines 288-289 path exercised by callers)."""
    with _running_exporter(_make_grpc_config(ENTERPRISE_INCLUDE_CONTENT=False)) as exporter:
        assert exporter.include_content is False


# ---------------------------------------------------------------------------
# EnterpriseExporter constructor — gRPC setup (lines 64-68 exporter-init path)
# ---------------------------------------------------------------------------


def test_grpc_exporter_created_with_correct_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    """GRPCSpanExporter and GRPCMetricExporter receive the configured endpoint."""
    span_calls, metric_calls = _record_grpc_construction(monkeypatch)

    with _running_exporter(_make_grpc_config(ENTERPRISE_OTLP_ENDPOINT="https://my-collector:4317")):
        pass

    assert span_calls[0]["endpoint"] == "https://my-collector:4317"
    assert metric_calls[0]["endpoint"] == "https://my-collector:4317"


def test_grpc_exporter_empty_endpoint_passes_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """Empty string endpoint is normalised to None for both gRPC exporters."""
    span_calls, metric_calls = _record_grpc_construction(monkeypatch)

    with _running_exporter(_make_grpc_config(ENTERPRISE_OTLP_ENDPOINT="")):
        pass

    assert span_calls[0]["endpoint"] is None
    assert metric_calls[0]["endpoint"] is None


# ---------------------------------------------------------------------------
# EnterpriseExporter.export_span (lines 204-271)
# ---------------------------------------------------------------------------


@contextmanager
def _exporter_with_in_memory_tracer() -> Iterator[tuple[EnterpriseExporter, InMemorySpanExporter]]:
    span_exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(span_exporter))
    with _running_exporter(_make_grpc_config()) as exporter:
        exporter._tracer = provider.get_tracer("test.enterprise")
        try:
            yield exporter, span_exporter
        finally:
            provider.shutdown()


def test_export_span_sets_and_clears_context(monkeypatch: pytest.MonkeyPatch) -> None:
    """export_span sets correlation/span context before the span and clears them in finally."""
    correlation_ids: list[str | None] = []
    span_id_sources: list[str | None] = []
    monkeypatch.setattr(exporter_module, "set_correlation_id", correlation_ids.append)
    monkeypatch.setattr(exporter_module, "set_span_id_source", span_id_sources.append)

    with _exporter_with_in_memory_tracer() as (exporter, _):
        exporter.export_span(
            name="test.span",
            attributes={"k": "v"},
            correlation_id="corr-1",
            span_id_source="span-src-1",
        )

    assert correlation_ids == ["corr-1", None]
    assert span_id_sources == ["span-src-1", None]


def test_export_span_sets_attributes_on_span() -> None:
    """All non-None attribute values are set on the span via set_attribute."""
    with _exporter_with_in_memory_tracer() as (exporter, span_exporter):
        exporter.export_span(
            name="test.span",
            attributes={"key1": "value1", "key2": None, "key3": 42},
        )
        attributes = span_exporter.get_finished_spans()[0].attributes

    assert attributes is not None
    assert attributes["key1"] == "value1"
    assert attributes["key3"] == 42
    assert "key2" not in attributes


def test_export_span_no_end_time_uses_end_on_exit() -> None:
    """When end_time is None, end_on_exit=True is passed to start_as_current_span."""
    with _exporter_with_in_memory_tracer() as (exporter, span_exporter):
        exporter.export_span(name="test.span", attributes={})
        span = span_exporter.get_finished_spans()[0]

    assert span.end_time is not None


def test_export_span_with_end_time_calls_span_end() -> None:
    """When end_time is provided, span.end() is called with the converted ns timestamp."""
    start = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)
    end = datetime(2024, 1, 1, 0, 0, 5, tzinfo=UTC)

    with _exporter_with_in_memory_tracer() as (exporter, span_exporter):
        exporter.export_span(name="test.span", attributes={}, start_time=start, end_time=end)
        span = span_exporter.get_finished_spans()[0]

    assert span.end_time == _datetime_to_ns(end)


def test_export_span_with_start_time_passed_to_start_as_current_span() -> None:
    """When start_time is provided it is converted to ns and passed to start_as_current_span."""
    start = datetime(2024, 3, 1, 12, 0, 0, tzinfo=UTC)
    with _exporter_with_in_memory_tracer() as (exporter, span_exporter):
        exporter.export_span(name="test.span", attributes={}, start_time=start)
        span = span_exporter.get_finished_spans()[0]

    assert span.start_time == _datetime_to_ns(start)


def test_export_span_root_span_no_parent_context() -> None:
    """When span_id_source == correlation_id the span is root.

    An explicit empty ``Context`` is passed (not ``None``) so the root span never
    implicitly inherits an ambient active span from the surrounding context.
    """
    uid = "123e4567-e89b-12d3-a456-426614174000"
    with _exporter_with_in_memory_tracer() as (exporter, span_exporter):
        exporter.export_span(
            name="root.span",
            attributes={},
            correlation_id=uid,
            span_id_source=uid,
        )
        span = span_exporter.get_finished_spans()[0]

    assert span.parent is None


def test_export_span_child_span_has_parent_context() -> None:
    """When correlation_id != span_id_source the child span gets a parent context."""
    corr_uid = "123e4567-e89b-12d3-a456-426614174000"
    node_uid = "987fbc97-4bed-5078-9f07-9141ba07c9f3"

    with _exporter_with_in_memory_tracer() as (exporter, span_exporter):
        exporter.export_span(
            name="child.span",
            attributes={},
            correlation_id=corr_uid,
            span_id_source=node_uid,
        )
        span = span_exporter.get_finished_spans()[0]

    assert span.parent is not None


def test_export_span_cross_workflow_parent_context() -> None:
    """When parent_span_id_source is set, the cross-workflow parent context is built."""
    corr_uid = "123e4567-e89b-12d3-a456-426614174000"
    parent_uid = "987fbc97-4bed-5078-9f07-9141ba07c9f3"

    with _exporter_with_in_memory_tracer() as (exporter, span_exporter):
        exporter.export_span(
            name="cross.span",
            attributes={},
            correlation_id=corr_uid,
            parent_span_id_source=parent_uid,
        )
        span = span_exporter.get_finished_spans()[0]

    assert span.parent is not None


def test_export_span_logs_exception_on_error(caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch) -> None:
    """If the span block raises, the exception is logged and context is still cleared."""

    def raise_error(*args: object, **kwargs: object) -> None:
        raise RuntimeError("boom")

    with _exporter_with_in_memory_tracer() as (exporter, _):
        monkeypatch.setattr(exporter._tracer, "start_as_current_span", raise_error)
        with caplog.at_level(logging.ERROR, logger="enterprise.telemetry.exporter"):
            exporter.export_span(name="bad.span", attributes={})  # must not raise

    assert "Failed to export span" in caplog.text
    assert "bad.span" in caplog.text


def test_export_span_invalid_trace_correlation_logs_warning(caplog: pytest.LogCaptureFixture) -> None:
    """Invalid UUID for trace_correlation_override triggers a warning log."""
    parent_uid = "987fbc97-4bed-5078-9f07-9141ba07c9f3"
    with _exporter_with_in_memory_tracer() as (exporter, _):
        with caplog.at_level(logging.WARNING, logger="enterprise.telemetry.exporter"):
            exporter.export_span(
                name="link.span",
                attributes={},
                correlation_id="not-a-valid-uuid",
                parent_span_id_source=parent_uid,
            )

    assert "Invalid trace correlation UUID for cross-workflow link" in caplog.text


# ---------------------------------------------------------------------------
# EnterpriseExporter.increment_counter (lines 276-278)
# ---------------------------------------------------------------------------


def test_increment_counter_calls_add_on_counter() -> None:
    """increment_counter calls .add() on the matching counter instrument."""
    reader = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[reader])
    counter = provider.get_meter("test").create_counter("test.tokens")

    labels = {"tenant_id": "t1", "app_id": "app-1"}
    with _running_exporter(_make_grpc_config()) as exporter:
        exporter._counters[EnterpriseTelemetryCounter.TOKENS] = counter
        exporter.increment_counter(EnterpriseTelemetryCounter.TOKENS, 50, labels)

    metrics = reader.get_metrics_data().resource_metrics[0].scope_metrics[0].metrics
    data_point = metrics[0].data.data_points[0]
    assert data_point.value == 50
    assert dict(data_point.attributes) == labels
    provider.shutdown()


def test_increment_counter_unknown_name_is_noop() -> None:
    """increment_counter silently does nothing when the counter is not found."""
    with _running_exporter(_make_grpc_config()) as exporter:
        exporter._counters.clear()

        # Should not raise
        exporter.increment_counter(EnterpriseTelemetryCounter.TOKENS, 5, {})


# ---------------------------------------------------------------------------
# EnterpriseExporter.record_histogram (lines 283-285)
# ---------------------------------------------------------------------------


def test_record_histogram_calls_record_on_histogram() -> None:
    """record_histogram calls .record() on the matching histogram instrument."""
    reader = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[reader])
    histogram = provider.get_meter("test").create_histogram("test.workflow.duration")

    labels = {"tenant_id": "t1"}
    with _running_exporter(_make_grpc_config()) as exporter:
        exporter._histograms[EnterpriseTelemetryHistogram.WORKFLOW_DURATION] = histogram
        exporter.record_histogram(EnterpriseTelemetryHistogram.WORKFLOW_DURATION, 3.14, labels)

    metrics = reader.get_metrics_data().resource_metrics[0].scope_metrics[0].metrics
    data_point = metrics[0].data.data_points[0]
    assert data_point.count == 1
    assert data_point.sum == 3.14
    assert dict(data_point.attributes) == labels
    provider.shutdown()


def test_record_histogram_unknown_name_is_noop() -> None:
    """record_histogram silently does nothing when the histogram is not found."""
    with _running_exporter(_make_grpc_config()) as exporter:
        exporter._histograms.clear()

        # Should not raise
        exporter.record_histogram(EnterpriseTelemetryHistogram.WORKFLOW_DURATION, 1.0, {})
