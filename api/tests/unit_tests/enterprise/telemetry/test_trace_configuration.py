"""Enterprise destinations are resolved before their configuration is fingerprinted."""

import base64
import json
import os
import ssl
from collections.abc import Callable
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest

from core.ops.trace_source import _settings_hash
from enterprise.telemetry import enterprise_trace, exporter


@pytest.fixture(autouse=True)
def enterprise_configuration(monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]) -> None:
    config_overrides(
        DEPLOYMENT_EDITION="ENTERPRISE",
        ENTERPRISE_TELEMETRY_ENABLED=True,
        ENTERPRISE_OTLP_ENDPOINT="",
        ENTERPRISE_OTLP_HEADERS="",
        ENTERPRISE_OTLP_API_KEY="",
        ENTERPRISE_OTLP_PROTOCOL="http/protobuf",
        SECRET_KEY="enterprise-configuration-test",
    )
    for name in tuple(os.environ):
        if name.startswith("OTEL_EXPORTER_OTLP") or name in {
            "OTEL_SDK_DISABLED",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
        }:
            monkeypatch.delenv(name)


@pytest.mark.parametrize("value", [None, "", "true", " TrUe ", "false", "1", "yes"])
def test_otlp_disabled_setting_is_captured_before_delivery(value: str | None, monkeypatch: pytest.MonkeyPatch) -> None:
    if value is not None:
        monkeypatch.setenv("OTEL_SDK_DISABLED", value)
    disabled = (value or "").lower().strip() == "true"
    captured = enterprise_trace.load_enterprise_config()
    assert captured is not None
    assert json.loads(json.dumps(captured)) == captured
    assert captured["otlp_disabled"] is disabled
    tenant_id = str(uuid4())
    fingerprint = _settings_hash(tenant_id, captured)
    monkeypatch.setenv("OTEL_SDK_DISABLED", "false" if disabled else "true")
    rotated = enterprise_trace.load_enterprise_config()
    assert rotated is not None
    assert _settings_hash(tenant_id, rotated) != fingerprint

    client = enterprise_trace.EnterpriseTraceClient(captured)

    assert client.otlp_disabled is disabled
    assert _settings_hash(tenant_id, captured) == fingerprint


@pytest.mark.parametrize("protocol", ["http/protobuf", "grpc"])
@pytest.mark.parametrize("endpoint_source", ["enterprise", "signal", "base", "default"])
def test_endpoint_precedence_for_both_signals(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    protocol: str,
    endpoint_source: str,
) -> None:
    explicit_endpoint = "collector.example:4317" if protocol == "grpc" else "https://collector.example/base/"
    endpoint = explicit_endpoint if endpoint_source == "enterprise" else ""
    config_overrides(ENTERPRISE_OTLP_ENDPOINT=endpoint, ENTERPRISE_OTLP_PROTOCOL=protocol)
    if endpoint_source != "default":
        monkeypatch.setenv(
            "OTEL_EXPORTER_OTLP_ENDPOINT",
            "https://base.example:4317" if protocol == "grpc" else "https://base.example/otlp/",
        )
    if endpoint_source in {"enterprise", "signal"}:
        for env_signal, hostname in (("TRACES", "trace"), ("METRICS", "metric")):
            monkeypatch.setenv(
                f"OTEL_EXPORTER_OTLP_{env_signal}_ENDPOINT",
                f"https://{hostname}.example:4317" if protocol == "grpc" else f"https://{hostname}.example/exact/",
            )

    configuration = enterprise_trace.load_enterprise_config()

    assert configuration is not None
    assert configuration["endpoint"] == endpoint
    assert configuration["protocol"] == protocol
    for signal, suffix in (("trace", "traces"), ("metrics", "metrics")):
        if endpoint_source == "enterprise":
            expected = "http://collector.example:4317" if protocol == "grpc" else f"{explicit_endpoint}v1/{suffix}"
        elif endpoint_source == "signal":
            expected = f"https://{'trace' if signal == 'trace' else 'metric'}.example"
            expected += ":4317" if protocol == "grpc" else "/exact/"
        elif endpoint_source == "base":
            expected = "https://base.example:4317" if protocol == "grpc" else f"https://base.example/otlp/v1/{suffix}"
        else:
            expected = "http://localhost:4317" if protocol == "grpc" else f"http://localhost:4318/v1/{suffix}"
        assert configuration["signals"][signal] == {
            "endpoint": expected,
            "headers": {},
            "request_timeout": "10.0",
            "tls": {},
        }


@pytest.mark.parametrize("protocol", ["http/protobuf", "grpc"])
@pytest.mark.parametrize(
    "environment",
    [
        {},
        {"OTEL_EXPORTER_OTLP_TIMEOUT": "60"},
        {
            "OTEL_EXPORTER_OTLP_TIMEOUT": "80",
            "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT": "60",
            "OTEL_EXPORTER_OTLP_METRICS_TIMEOUT": "70.5",
        },
        {
            "OTEL_EXPORTER_OTLP_TIMEOUT": "80",
            "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT": "0",
            "OTEL_EXPORTER_OTLP_METRICS_TIMEOUT": "0",
        },
        {"OTEL_EXPORTER_OTLP_TIMEOUT": "inf"},
        {"OTEL_EXPORTER_OTLP_TRACES_TIMEOUT": "nan", "OTEL_EXPORTER_OTLP_METRICS_TIMEOUT": "nan"},
    ],
)
def test_signal_timeouts_match_native_exporters_and_stay_bound_to_captured_settings(
    protocol: str,
    environment: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(ENTERPRISE_OTLP_PROTOCOL=protocol)
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    captured = enterprise_trace.load_enterprise_config()
    assert captured is not None
    json.dumps(captured, allow_nan=False)
    native_factory = exporter._ExporterFactory(protocol, "", {}, insecure=True)
    native_trace = native_factory.create_trace_exporter()
    native_metrics = native_factory.create_metric_exporter()
    try:
        trace_timeout, metrics_timeout = native_trace._timeout, native_metrics._timeout
        assert captured["signals"]["trace"]["request_timeout"] == str(trace_timeout)
        assert captured["signals"]["metrics"]["request_timeout"] == str(metrics_timeout)
    finally:
        native_trace.shutdown()
        native_metrics.shutdown()
    tenant_id = str(uuid4())
    fingerprint = _settings_hash(tenant_id, captured)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", "90")
    rotated = enterprise_trace.load_enterprise_config()
    assert rotated is not None
    assert _settings_hash(tenant_id, rotated) != fingerprint
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", "invalid-after-capture")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_METRICS_TIMEOUT", "invalid-after-capture")

    client = enterprise_trace.EnterpriseTraceClient(captured)

    assert str(client.otlp.http.request_timeout) == str(trace_timeout)
    assert client.otlp.metrics_http is not None
    assert str(client.otlp.metrics_http.request_timeout) == str(metrics_timeout)
    assert _settings_hash(tenant_id, captured) == fingerprint


@pytest.mark.parametrize(
    ("headers", "api_key", "expected"),
    [
        ("", "", None),
        ("x-custom=tenant", "", {"x-custom": "tenant"}),
        ("", "token", {"authorization": "Bearer token"}),
        ("authorization=Basic%20old,x-custom=tenant", "token", {"authorization": "Bearer token", "x-custom": "tenant"}),
    ],
)
def test_enterprise_headers_replace_standard_signal_headers(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    headers: str,
    api_key: str,
    expected: dict[str, str] | None,
) -> None:
    config_overrides(ENTERPRISE_OTLP_HEADERS=headers, ENTERPRISE_OTLP_API_KEY=api_key)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "authorization=Bearer standard,x-base=base%20value")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "x-trace=one%2Btwo")

    configuration = enterprise_trace.load_enterprise_config()

    assert configuration is not None
    assert configuration["api_key"] == api_key
    assert configuration["signals"]["trace"]["headers"] == (expected or {"x-trace": "one+two"})
    assert configuration["signals"]["metrics"]["headers"] == (
        expected or {"authorization": "Bearer standard", "x-base": "base value"}
    )


@pytest.mark.parametrize("protocol", ["http/protobuf", "grpc"])
def test_tls_contents_and_signal_overrides_are_captured(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    config_overrides: Callable[..., None],
    protocol: str,
) -> None:
    config_overrides(ENTERPRISE_OTLP_PROTOCOL=protocol, ENTERPRISE_OTLP_ENDPOINT="https://collector.example")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example")
    certificates = {}
    for field in ("certificate", "client_key", "client_certificate"):
        content = f"base {field}".encode() + b"\x00"
        path = tmp_path / field
        path.write_bytes(content)
        certificates[field] = base64.b64encode(content).decode()
        monkeypatch.setenv(f"OTEL_EXPORTER_OTLP_{field.upper()}", str(path))
    trace_certificate = tmp_path / "trace-ca"
    trace_certificate.write_bytes(b"trace certificate")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", str(trace_certificate))
    metric_key = tmp_path / "metric-key"
    metric_key.write_bytes(b"metric key")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY", str(metric_key))

    configuration = enterprise_trace.load_enterprise_config()

    assert configuration is not None
    assert configuration["signals"]["trace"]["tls"] == {
        **(certificates if protocol != "grpc" else {}),
        "certificate": base64.b64encode(b"trace certificate").decode(),
    }
    assert configuration["signals"]["metrics"]["tls"] == {
        **certificates,
        "client_key": base64.b64encode(b"metric key").decode() if protocol != "grpc" else certificates["client_key"],
    }
    fingerprint = _settings_hash("tenant", configuration)
    trace_certificate.write_bytes(b"rotated certificate")
    rotated = enterprise_trace.load_enterprise_config()
    assert rotated is not None
    assert _settings_hash("tenant", rotated) != fingerprint
    assert configuration["signals"]["trace"]["tls"]["certificate"] == base64.b64encode(b"trace certificate").decode()


@pytest.mark.parametrize("prefix", ["OTEL_EXPORTER_OTLP_", "OTEL_EXPORTER_OTLP_TRACES_", "OTEL_EXPORTER_OTLP_METRICS_"])
@pytest.mark.parametrize("field", ["ENDPOINT", "HEADERS"])
def test_standard_destination_changes_change_the_fingerprint(
    monkeypatch: pytest.MonkeyPatch, prefix: str, field: str
) -> None:
    configuration = enterprise_trace.load_enterprise_config()
    assert configuration is not None
    fingerprint = _settings_hash("tenant", configuration)
    monkeypatch.setenv(
        prefix + field,
        "https://rotated.example/ingest" if field == "ENDPOINT" else "authorization=Bearer rotated",
    )

    rotated = enterprise_trace.load_enterprise_config()

    assert rotated is not None
    assert _settings_hash("tenant", rotated) != fingerprint


def test_configuration_read_does_not_create_exporters(monkeypatch: pytest.MonkeyPatch) -> None:
    create_client = Mock(side_effect=AssertionError("configuration reads must not create clients"))
    monkeypatch.setattr(enterprise_trace, "OtlpTraceClient", create_client)
    for name in ("HTTPSpanExporter", "HTTPMetricExporter", "GRPCSpanExporter", "GRPCMetricExporter"):
        monkeypatch.setattr(exporter, name, create_client)

    assert enterprise_trace.load_enterprise_config() is not None
    create_client.assert_not_called()


def test_client_uses_the_loaded_destination_after_environment_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "https://trace.example/ingest")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "https://metric.example/ingest")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "authorization=Bearer original")
    configuration = enterprise_trace.load_enterprise_config()
    assert configuration is not None
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "https://changed.example/traces")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "https://changed.example/metrics")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "authorization=Bearer rotated")

    client = enterprise_trace.EnterpriseTraceClient(configuration)

    assert client.otlp.metrics_http is not None
    assert client.otlp.http.endpoint == "https://trace.example/ingest"
    assert client.otlp.metrics_http.endpoint == "https://metric.example/ingest"
    assert client.otlp.http.headers == client.otlp.metrics_http.headers == {"authorization": "Bearer original"}


@pytest.mark.parametrize("protocol", ["grpc", "http/protobuf"])
def test_empty_signal_ca_suppresses_generic_certificates(
    protocol: str, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(ENTERPRISE_OTLP_PROTOCOL=protocol, ENTERPRISE_OTLP_ENDPOINT="https://collector.example:4317")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example:4317")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_CERTIFICATE", "/must/not/be/read")
    for signal in ("TRACES", "METRICS"):
        monkeypatch.setenv(f"OTEL_EXPORTER_OTLP_{signal}_CERTIFICATE", "")

    configuration = enterprise_trace.load_enterprise_config()

    assert configuration is not None
    assert all(settings["tls"] == {} for settings in configuration["signals"].values())
    client = enterprise_trace.EnterpriseTraceClient(configuration)
    assert client.otlp.metrics_http is not None
    if protocol == "grpc":
        assert client.otlp.grpc_credentials == {}
        assert all(settings.get("verify", True) for settings in configuration["signals"].values())
    else:
        for transport in (client.otlp.http, client.otlp.metrics_http):
            assert transport.ssl_context is not None
            assert transport.ssl_context.verify_mode == ssl.CERT_NONE


@pytest.mark.parametrize("endpoint_source", ["base", "signal"])
@pytest.mark.parametrize("signal_certificate", ["", "signal-ca"])
def test_environment_grpc_endpoint_uses_general_credentials(
    endpoint_source: str,
    signal_certificate: str,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(ENTERPRISE_OTLP_PROTOCOL="grpc")
    certificates = {}
    for field in ("certificate", "client_key", "client_certificate"):
        path = tmp_path / field
        path.write_bytes(f"general {field}".encode())
        certificates[field] = base64.b64encode(path.read_bytes()).decode()
        monkeypatch.setenv(f"OTEL_EXPORTER_OTLP_{field.upper()}", str(path))
    if endpoint_source == "base":
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example")
    for signal in ("TRACES", "METRICS"):
        if endpoint_source == "signal":
            monkeypatch.setenv(f"OTEL_EXPORTER_OTLP_{signal}_ENDPOINT", "https://collector.example")
        monkeypatch.setenv(f"OTEL_EXPORTER_OTLP_{signal}_CERTIFICATE", signal_certificate)
        monkeypatch.setenv(f"OTEL_EXPORTER_OTLP_{signal}_CLIENT_KEY", "/unused/key/not/read")
        monkeypatch.setenv(f"OTEL_EXPORTER_OTLP_{signal}_CLIENT_CERTIFICATE", "/unused/cert/not/read")

    configuration = enterprise_trace.load_enterprise_config()

    assert configuration is not None
    assert all(settings["tls"] == certificates for settings in configuration["signals"].values())


@pytest.mark.parametrize("environment_name", ["REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"])
def test_http_tls_preserves_requests_ca_fallback_and_ignores_unused_client_key(
    environment_name: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    certificate = tmp_path / "ca.pem"
    certificate.write_bytes(b"request CA")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example")
    monkeypatch.setenv(environment_name, str(certificate))
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_CLIENT_KEY", "/unused/key/not/read")
    configuration = enterprise_trace.load_enterprise_config()
    assert configuration is not None
    assert all(
        settings["tls"] == {"certificate": base64.b64encode(b"request CA").decode()}
        for settings in configuration["signals"].values()
    )


def test_blank_ca_bundle_environment_keeps_http_tls_verification_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example")
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", "")
    monkeypatch.setenv("CURL_CA_BUNDLE", "")
    configuration = enterprise_trace.load_enterprise_config()
    assert configuration is not None
    assert all(settings["tls"] == {} for settings in configuration["signals"].values())
    assert all(settings.get("verify", True) for settings in configuration["signals"].values())
    client = enterprise_trace.EnterpriseTraceClient(configuration)
    assert client.otlp.http.ssl_context is not None
    assert client.otlp.http.ssl_context.verify_mode == ssl.CERT_REQUIRED
    assert client.otlp.http.ssl_context.check_hostname is True


@pytest.mark.parametrize("protocol", ["http/protobuf", "grpc"])
def test_http_ca_directory_rotation_changes_the_configuration_fingerprint(
    protocol: str,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(ENTERPRISE_OTLP_PROTOCOL=protocol, ENTERPRISE_OTLP_ENDPOINT="https://collector.example")
    certificate = tmp_path / "12345678.0"
    certificate.write_bytes(b"original certificate")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_CERTIFICATE", str(tmp_path))
    if protocol == "grpc":
        with pytest.raises(ValueError, match="^Cannot read TLS configuration$"):
            enterprise_trace.load_enterprise_config()
        return

    captured = enterprise_trace.load_enterprise_config()

    assert captured is not None
    assert all("certificate_directory" in settings["tls"] for settings in captured["signals"].values())
    fingerprint = _settings_hash("tenant", captured)
    certificate.write_bytes(b"rotated certificate")
    rotated = enterprise_trace.load_enterprise_config()
    assert rotated is not None
    assert _settings_hash("tenant", rotated) != fingerprint
    assert _settings_hash("tenant", captured) == fingerprint


def test_enterprise_config_respects_enablement_and_parses_headers(config_overrides: Callable[..., None]) -> None:
    config_overrides(DEPLOYMENT_EDITION="ENTERPRISE", ENTERPRISE_TELEMETRY_ENABLED=False)
    assert enterprise_trace.load_enterprise_config() is None
    config_overrides(
        ENTERPRISE_TELEMETRY_ENABLED=True,
        ENTERPRISE_OTLP_ENDPOINT="https://collector.example",
        ENTERPRISE_OTLP_HEADERS="authorization=Bearer%20token",
        ENTERPRISE_OTLP_API_KEY="private-key",
        ENTERPRISE_INCLUDE_CONTENT=False,
        ENTERPRISE_OTEL_SAMPLING_RATE=0.25,
    )
    settings = enterprise_trace.load_enterprise_config()
    assert settings is not None
    assert settings["endpoint"] == "https://collector.example"
    assert settings["headers"] == {"authorization": "Bearer token"}
    assert settings["api_key"] == "private-key"
    assert settings["include_content"] is False
    assert settings["sampling_rate"] == 0.25
