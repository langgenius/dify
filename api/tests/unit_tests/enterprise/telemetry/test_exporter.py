"""Unit tests for EnterpriseExporter and _ExporterFactory."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from configs.enterprise import EnterpriseTelemetryConfig
from enterprise.telemetry.exporter import EnterpriseExporter


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
        ENTERPRISE_OTLP_HEADERS="authorization=Basic old",
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
def test_api_key_set_uses_secure_grpc(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """Test that API key presence enables TLS (insecure=False) for gRPC."""
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

    # Verify insecure=False for both exporters
    assert mock_span_exporter.call_args is not None
    assert mock_span_exporter.call_args.kwargs["insecure"] is False

    assert mock_metric_exporter.call_args is not None
    assert mock_metric_exporter.call_args.kwargs["insecure"] is False


@patch("enterprise.telemetry.exporter.GRPCSpanExporter")
@patch("enterprise.telemetry.exporter.GRPCMetricExporter")
def test_no_api_key_uses_insecure_grpc(mock_metric_exporter: MagicMock, mock_span_exporter: MagicMock) -> None:
    """Test that empty API key uses insecure gRPC (backward compat)."""
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

    # Verify insecure=True for both exporters
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
