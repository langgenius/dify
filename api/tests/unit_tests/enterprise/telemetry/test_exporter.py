"""Unit tests for EnterpriseExporter and _ExporterFactory."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from configs.enterprise import EnterpriseTelemetryConfig
from enterprise.telemetry.entities import EnterpriseTelemetryCounter, EnterpriseTelemetryHistogram
from enterprise.telemetry.exporter import EnterpriseExporter, _datetime_to_ns, _parse_otlp_headers


def test_config_api_key_default_empty():
    """Test that ENTERPRISE_OTLP_API_KEY defaults to empty string."""
    config = EnterpriseTelemetryConfig()
    assert config.ENTERPRISE_OTLP_API_KEY == ""


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_api_key_only_injects_bearer_header(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """Test that API key alone injects Bearer authorization header."""
    mock_config = SimpleNamespace(
        ENTERPRISE_OTLP_ENDPOINT="https://collector.example.com",
        ENTERPRISE_OTLP_HEADERS="",
        ENTERPRISE_OTLP_PROTOCOL="grpc",
        ENTERPRISE_SERVICE_NAME="dify",
        ENTERPRISE_OTEL_SAMPLING_RATE=1.0,
        ENTERPRISE_INCLUDE_CONTENT=True,
        ENTERPRISE_OTLP_API_KEY="test-secret-key",
    )

    EnterpriseExporter(mock_config)

    # Verify span exporter was called with Bearer header
    assert mock_span_exporter.call_args is not None
    headers = mock_span_exporter.call_args.kwargs.get("headers")
    assert headers is not None
    assert ("authorization", "Bearer test-secret-key") in headers


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_empty_api_key_no_auth_header(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """Test that empty API key does not inject authorization header."""
    mock_config = SimpleNamespace(
        ENTERPRISE_OTLP_ENDPOINT="https://collector.example.com",
        ENTERPRISE_OTLP_HEADERS="",
        ENTERPRISE_OTLP_PROTOCOL="grpc",
        ENTERPRISE_SERVICE_NAME="dify",
        ENTERPRISE_OTEL_SAMPLING_RATE=1.0,
        ENTERPRISE_INCLUDE_CONTENT=True,
        ENTERPRISE_OTLP_API_KEY="",
    )

    EnterpriseExporter(mock_config)

    # Verify span exporter was called without authorization header
    assert mock_span_exporter.call_args is not None
    headers = mock_span_exporter.call_args.kwargs.get("headers")
    # Headers should be None or not contain authorization
    if headers is not None:
        assert not any(key == "authorization" for key, _ in headers)


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_api_key_and_custom_headers_merge(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """Test that API key and custom headers are merged correctly."""
    mock_config = SimpleNamespace(
        ENTERPRISE_OTLP_ENDPOINT="https://collector.example.com",
        ENTERPRISE_OTLP_HEADERS="x-custom=foo",
        ENTERPRISE_OTLP_PROTOCOL="grpc",
        ENTERPRISE_SERVICE_NAME="dify",
        ENTERPRISE_OTEL_SAMPLING_RATE=1.0,
        ENTERPRISE_INCLUDE_CONTENT=True,
        ENTERPRISE_OTLP_API_KEY="test-key",
    )

    EnterpriseExporter(mock_config)

    # Verify both headers are present
    assert mock_span_exporter.call_args is not None
    headers = mock_span_exporter.call_args.kwargs.get("headers")
    assert headers is not None
    assert ("authorization", "Bearer test-key") in headers
    assert ("x-custom", "foo") in headers


@patch("enterprise.telemetry.exporter.logger")
@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_api_key_overrides_conflicting_header(
    mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock, mock_logger: MagicMock
) -> None:
    """Test that API key overrides conflicting authorization header and logs warning."""
    mock_config = SimpleNamespace(
        ENTERPRISE_OTLP_ENDPOINT="https://collector.example.com",
        ENTERPRISE_OTLP_HEADERS="authorization=Basic+old",
        ENTERPRISE_OTLP_PROTOCOL="grpc",
        ENTERPRISE_SERVICE_NAME="dify",
        ENTERPRISE_OTEL_SAMPLING_RATE=1.0,
        ENTERPRISE_INCLUDE_CONTENT=True,
        ENTERPRISE_OTLP_API_KEY="test-key",
    )

    EnterpriseExporter(mock_config)

    # Verify Bearer header takes precedence
    assert mock_span_exporter.call_args is not None
    headers = mock_span_exporter.call_args.kwargs.get("headers")
    assert headers is not None
    assert ("authorization", "Bearer test-key") in headers
    # Verify old authorization header is not present
    assert ("authorization", "Basic old") not in headers

    # Verify warning was logged
    mock_logger.warning.assert_called_once()
    assert mock_logger.warning.call_args is not None
    warning_message = mock_logger.warning.call_args[0][0]
    assert "ENTERPRISE_OTLP_API_KEY is set" in warning_message
    assert "authorization" in warning_message


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_https_endpoint_uses_secure_grpc(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """Test that https:// endpoint enables TLS (insecure=False) for gRPC."""
    mock_config = SimpleNamespace(
        ENTERPRISE_OTLP_ENDPOINT="https://collector.example.com",
        ENTERPRISE_OTLP_HEADERS="",
        ENTERPRISE_OTLP_PROTOCOL="grpc",
        ENTERPRISE_SERVICE_NAME="dify",
        ENTERPRISE_OTEL_SAMPLING_RATE=1.0,
        ENTERPRISE_INCLUDE_CONTENT=True,
        ENTERPRISE_OTLP_API_KEY="test-key",
    )

    EnterpriseExporter(mock_config)

    # Verify insecure=False for both exporters (https:// scheme)
    assert mock_span_exporter.call_args is not None
    assert mock_span_exporter.call_args.kwargs["insecure"] is False

    assert mock_metric_exporter.call_args is not None
    assert mock_metric_exporter.call_args.kwargs["insecure"] is False


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_http_endpoint_uses_insecure_grpc(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """Test that http:// endpoint uses insecure gRPC (insecure=True)."""
    mock_config = SimpleNamespace(
        ENTERPRISE_OTLP_ENDPOINT="http://collector.example.com",
        ENTERPRISE_OTLP_HEADERS="",
        ENTERPRISE_OTLP_PROTOCOL="grpc",
        ENTERPRISE_SERVICE_NAME="dify",
        ENTERPRISE_OTEL_SAMPLING_RATE=1.0,
        ENTERPRISE_INCLUDE_CONTENT=True,
        ENTERPRISE_OTLP_API_KEY="",
    )

    EnterpriseExporter(mock_config)

    # Verify insecure=True for both exporters (http:// scheme)
    assert mock_span_exporter.call_args is not None
    assert mock_span_exporter.call_args.kwargs["insecure"] is True

    assert mock_metric_exporter.call_args is not None
    assert mock_metric_exporter.call_args.kwargs["insecure"] is True


@patch("enterprise.telemetry.exporter.HTTPSpanExporter")
@patch("enterprise.telemetry.exporter.HTTPMetricExporter")
def test_insecure_not_passed_to_http_exporters(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """Test that insecure parameter is not passed to HTTP exporters."""
    mock_config = SimpleNamespace(
        ENTERPRISE_OTLP_ENDPOINT="http://collector.example.com",
        ENTERPRISE_OTLP_HEADERS="",
        ENTERPRISE_OTLP_PROTOCOL="http",
        ENTERPRISE_SERVICE_NAME="dify",
        ENTERPRISE_OTEL_SAMPLING_RATE=1.0,
        ENTERPRISE_INCLUDE_CONTENT=True,
        ENTERPRISE_OTLP_API_KEY="test-key",
    )

    EnterpriseExporter(mock_config)

    # Verify insecure kwarg is NOT in HTTP exporter calls
    assert mock_span_exporter.call_args is not None
    assert "insecure" not in mock_span_exporter.call_args.kwargs

    assert mock_metric_exporter.call_args is not None
    assert "insecure" not in mock_metric_exporter.call_args.kwargs


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_api_key_with_special_chars_preserved(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """Test that API key with special characters is preserved without mangling."""
    special_key = "abc+def/ghi=jkl=="
    mock_config = SimpleNamespace(
        ENTERPRISE_OTLP_ENDPOINT="https://collector.example.com",
        ENTERPRISE_OTLP_HEADERS="",
        ENTERPRISE_OTLP_PROTOCOL="grpc",
        ENTERPRISE_SERVICE_NAME="dify",
        ENTERPRISE_OTEL_SAMPLING_RATE=1.0,
        ENTERPRISE_INCLUDE_CONTENT=True,
        ENTERPRISE_OTLP_API_KEY=special_key,
    )

    EnterpriseExporter(mock_config)

    # Verify special characters are preserved in Bearer header
    assert mock_span_exporter.call_args is not None
    headers = mock_span_exporter.call_args.kwargs.get("headers")
    assert headers is not None
    assert ("authorization", f"Bearer {special_key}") in headers


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_no_scheme_localhost_uses_insecure(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """Test that endpoint without scheme defaults to insecure for localhost."""
    mock_config = SimpleNamespace(
        ENTERPRISE_OTLP_ENDPOINT="localhost:4317",
        ENTERPRISE_OTLP_HEADERS="",
        ENTERPRISE_OTLP_PROTOCOL="grpc",
        ENTERPRISE_SERVICE_NAME="dify",
        ENTERPRISE_OTEL_SAMPLING_RATE=1.0,
        ENTERPRISE_INCLUDE_CONTENT=True,
        ENTERPRISE_OTLP_API_KEY="",
    )

    EnterpriseExporter(mock_config)

    # Verify insecure=True for localhost without scheme
    assert mock_span_exporter.call_args is not None
    assert mock_span_exporter.call_args.kwargs["insecure"] is True

    assert mock_metric_exporter.call_args is not None
    assert mock_metric_exporter.call_args.kwargs["insecure"] is True


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_no_scheme_production_uses_insecure(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """Test that endpoint without scheme defaults to insecure (not https://)."""
    mock_config = SimpleNamespace(
        ENTERPRISE_OTLP_ENDPOINT="collector.example.com:4317",
        ENTERPRISE_OTLP_HEADERS="",
        ENTERPRISE_OTLP_PROTOCOL="grpc",
        ENTERPRISE_SERVICE_NAME="dify",
        ENTERPRISE_OTEL_SAMPLING_RATE=1.0,
        ENTERPRISE_INCLUDE_CONTENT=True,
        ENTERPRISE_OTLP_API_KEY="",
    )

    EnterpriseExporter(mock_config)

    # Verify insecure=True for any endpoint without https:// scheme
    assert mock_span_exporter.call_args is not None
    assert mock_span_exporter.call_args.kwargs["insecure"] is True

    assert mock_metric_exporter.call_args is not None
    assert mock_metric_exporter.call_args.kwargs["insecure"] is True


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


def _make_grpc_config(**overrides) -> SimpleNamespace:
    defaults = {
        "ENTERPRISE_OTLP_ENDPOINT": "https://collector.example.com",
        "ENTERPRISE_OTLP_HEADERS": "",
        "ENTERPRISE_OTLP_PROTOCOL": "grpc",
        "ENTERPRISE_SERVICE_NAME": "dify",
        "ENTERPRISE_OTEL_SAMPLING_RATE": 1.0,
        "ENTERPRISE_INCLUDE_CONTENT": True,
        "ENTERPRISE_OTLP_API_KEY": "",
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_include_content_true_stored_on_exporter(
    mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock
) -> None:
    """include_content=True is stored as a public attribute (line 115)."""
    exporter = EnterpriseExporter(_make_grpc_config(ENTERPRISE_INCLUDE_CONTENT=True))
    assert exporter.include_content is True


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_include_content_false_stored_on_exporter(
    mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock
) -> None:
    """include_content=False is preserved (lines 288-289 path exercised by callers)."""
    exporter = EnterpriseExporter(_make_grpc_config(ENTERPRISE_INCLUDE_CONTENT=False))
    assert exporter.include_content is False


# ---------------------------------------------------------------------------
# EnterpriseExporter constructor — gRPC setup (lines 64-68 exporter-init path)
# ---------------------------------------------------------------------------


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_grpc_exporter_created_with_correct_endpoint(
    mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock
) -> None:
    """GRPCSpanExporter and GRPCMetricExporter receive the configured endpoint."""
    EnterpriseExporter(_make_grpc_config(ENTERPRISE_OTLP_ENDPOINT="https://my-collector:4317"))

    assert mock_span_exporter.call_args.kwargs["endpoint"] == "https://my-collector:4317"
    assert mock_metric_exporter.call_args.kwargs["endpoint"] == "https://my-collector:4317"


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_grpc_exporter_empty_endpoint_passes_none(
    mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock
) -> None:
    """Empty string endpoint is normalised to None for both gRPC exporters."""
    EnterpriseExporter(_make_grpc_config(ENTERPRISE_OTLP_ENDPOINT=""))

    assert mock_span_exporter.call_args.kwargs["endpoint"] is None
    assert mock_metric_exporter.call_args.kwargs["endpoint"] is None


# ---------------------------------------------------------------------------
# EnterpriseExporter.export_span (lines 204-271)
# ---------------------------------------------------------------------------


def _make_exporter_with_mock_tracer() -> tuple[EnterpriseExporter, MagicMock, MagicMock]:
    """Return (exporter, mock_tracer, mock_span) with OTEL internals fully mocked."""
    mock_span = MagicMock()
    mock_span.__enter__ = MagicMock(return_value=mock_span)
    mock_span.__exit__ = MagicMock(return_value=False)

    mock_tracer = MagicMock()
    mock_tracer.start_as_current_span.return_value = mock_span

    with (
        patch("enterprise.telemetry.exporter.GRPCSpanExporter"),
        patch("enterprise.telemetry.exporter.GRPCMetricExporter"),
    ):
        exporter = EnterpriseExporter(_make_grpc_config())

    exporter._tracer = mock_tracer
    return exporter, mock_tracer, mock_span


@patch("enterprise.telemetry.exporter.set_correlation_id")
@patch("enterprise.telemetry.exporter.set_span_id_source")
def test_export_span_sets_and_clears_context(mock_set_span: MagicMock, mock_set_corr: MagicMock) -> None:
    """export_span sets correlation/span context before the span and clears them in finally."""
    exporter, mock_tracer, mock_span = _make_exporter_with_mock_tracer()

    exporter.export_span(
        name="test.span",
        attributes={"k": "v"},
        correlation_id="corr-1",
        span_id_source="span-src-1",
    )

    # Context was set at the start of the call
    mock_set_corr.assert_any_call("corr-1")
    mock_set_span.assert_any_call("span-src-1")
    # Context was cleared in finally
    mock_set_corr.assert_called_with(None)
    mock_set_span.assert_called_with(None)


def test_export_span_sets_attributes_on_span() -> None:
    """All non-None attribute values are set on the span via set_attribute."""
    exporter, mock_tracer, mock_span = _make_exporter_with_mock_tracer()

    exporter.export_span(
        name="test.span",
        attributes={"key1": "value1", "key2": None, "key3": 42},
    )

    # set_attribute should be called for non-None values only
    calls = list(mock_span.set_attribute.call_args_list)
    keys_set = {c[0][0] for c in calls}
    assert "key1" in keys_set
    assert "key3" in keys_set
    assert "key2" not in keys_set


def test_export_span_no_end_time_uses_end_on_exit() -> None:
    """When end_time is None, end_on_exit=True is passed to start_as_current_span."""
    exporter, mock_tracer, mock_span = _make_exporter_with_mock_tracer()

    exporter.export_span(name="test.span", attributes={})

    _, kwargs = mock_tracer.start_as_current_span.call_args
    assert kwargs["end_on_exit"] is True


def test_export_span_with_end_time_calls_span_end() -> None:
    """When end_time is provided, span.end() is called with the converted ns timestamp."""
    exporter, mock_tracer, mock_span = _make_exporter_with_mock_tracer()

    start = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)
    end = datetime(2024, 1, 1, 0, 0, 5, tzinfo=UTC)

    exporter.export_span(name="test.span", attributes={}, start_time=start, end_time=end)

    mock_span.end.assert_called_once()
    end_ns = mock_span.end.call_args.kwargs["end_time"]
    assert end_ns == _datetime_to_ns(end)


def test_export_span_with_start_time_passed_to_start_as_current_span() -> None:
    """When start_time is provided it is converted to ns and passed to start_as_current_span."""
    exporter, mock_tracer, mock_span = _make_exporter_with_mock_tracer()

    start = datetime(2024, 3, 1, 12, 0, 0, tzinfo=UTC)
    exporter.export_span(name="test.span", attributes={}, start_time=start)

    _, kwargs = mock_tracer.start_as_current_span.call_args
    assert kwargs["start_time"] == _datetime_to_ns(start)


def test_export_span_root_span_no_parent_context() -> None:
    """When span_id_source == correlation_id the span is root — no parent context."""
    exporter, mock_tracer, mock_span = _make_exporter_with_mock_tracer()

    uid = "123e4567-e89b-12d3-a456-426614174000"
    exporter.export_span(
        name="root.span",
        attributes={},
        correlation_id=uid,
        span_id_source=uid,
    )

    _, kwargs = mock_tracer.start_as_current_span.call_args
    assert kwargs["context"] is None


def test_export_span_child_span_has_parent_context() -> None:
    """When correlation_id != span_id_source the child span gets a parent context."""
    exporter, mock_tracer, mock_span = _make_exporter_with_mock_tracer()

    corr_uid = "123e4567-e89b-12d3-a456-426614174000"
    node_uid = "987fbc97-4bed-5078-9f07-9141ba07c9f3"

    exporter.export_span(
        name="child.span",
        attributes={},
        correlation_id=corr_uid,
        span_id_source=node_uid,
    )

    _, kwargs = mock_tracer.start_as_current_span.call_args
    assert kwargs["context"] is not None


def test_export_span_cross_workflow_parent_context() -> None:
    """When parent_span_id_source is set, the cross-workflow parent context is built."""
    exporter, mock_tracer, mock_span = _make_exporter_with_mock_tracer()

    corr_uid = "123e4567-e89b-12d3-a456-426614174000"
    parent_uid = "987fbc97-4bed-5078-9f07-9141ba07c9f3"

    exporter.export_span(
        name="cross.span",
        attributes={},
        correlation_id=corr_uid,
        parent_span_id_source=parent_uid,
    )

    _, kwargs = mock_tracer.start_as_current_span.call_args
    assert kwargs["context"] is not None


@patch("enterprise.telemetry.exporter.logger")
def test_export_span_logs_exception_on_error(mock_logger: MagicMock) -> None:
    """If the span block raises, the exception is logged and context is still cleared."""
    exporter, mock_tracer, mock_span = _make_exporter_with_mock_tracer()

    mock_tracer.start_as_current_span.side_effect = RuntimeError("boom")

    exporter.export_span(name="bad.span", attributes={})  # must not raise

    mock_logger.exception.assert_called_once()
    assert "bad.span" in mock_logger.exception.call_args[0][1]


@patch("enterprise.telemetry.exporter.logger")
def test_export_span_invalid_trace_correlation_logs_warning(mock_logger: MagicMock) -> None:
    """Invalid UUID for trace_correlation_override triggers a warning log."""
    exporter, mock_tracer, mock_span = _make_exporter_with_mock_tracer()

    parent_uid = "987fbc97-4bed-5078-9f07-9141ba07c9f3"
    exporter.export_span(
        name="link.span",
        attributes={},
        correlation_id="not-a-valid-uuid",
        parent_span_id_source=parent_uid,
    )

    mock_logger.warning.assert_called()


# ---------------------------------------------------------------------------
# EnterpriseExporter.increment_counter (lines 276-278)
# ---------------------------------------------------------------------------


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_increment_counter_calls_add_on_counter(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """increment_counter calls .add() on the matching counter instrument."""
    exporter = EnterpriseExporter(_make_grpc_config())

    mock_counter = MagicMock()
    exporter._counters[EnterpriseTelemetryCounter.TOKENS] = mock_counter

    labels = {"tenant_id": "t1", "app_id": "app-1"}
    exporter.increment_counter(EnterpriseTelemetryCounter.TOKENS, 50, labels)

    mock_counter.add.assert_called_once_with(50, labels)


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_increment_counter_unknown_name_is_noop(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """increment_counter silently does nothing when the counter is not found."""
    exporter = EnterpriseExporter(_make_grpc_config())
    exporter._counters.clear()

    # Should not raise
    exporter.increment_counter(EnterpriseTelemetryCounter.TOKENS, 5, {})


# ---------------------------------------------------------------------------
# EnterpriseExporter.record_histogram (lines 283-285)
# ---------------------------------------------------------------------------


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_record_histogram_calls_record_on_histogram(
    mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock
) -> None:
    """record_histogram calls .record() on the matching histogram instrument."""
    exporter = EnterpriseExporter(_make_grpc_config())

    mock_histogram = MagicMock()
    exporter._histograms[EnterpriseTelemetryHistogram.WORKFLOW_DURATION] = mock_histogram

    labels = {"tenant_id": "t1"}
    exporter.record_histogram(EnterpriseTelemetryHistogram.WORKFLOW_DURATION, 3.14, labels)

    mock_histogram.record.assert_called_once_with(3.14, labels)


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_record_histogram_unknown_name_is_noop(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """record_histogram silently does nothing when the histogram is not found."""
    exporter = EnterpriseExporter(_make_grpc_config())
    exporter._histograms.clear()

    # Should not raise
    exporter.record_histogram(EnterpriseTelemetryHistogram.WORKFLOW_DURATION, 1.0, {})
