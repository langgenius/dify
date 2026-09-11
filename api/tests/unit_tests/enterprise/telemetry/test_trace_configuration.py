"""Enterprise destinations are resolved before their configuration is fingerprinted."""

import base64
import os
from collections.abc import Callable
from pathlib import Path
from unittest.mock import Mock

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
        if name.startswith("OTEL_EXPORTER_OTLP"):
            monkeypatch.delenv(name)


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
        assert configuration["signals"][signal] == {"endpoint": expected, "headers": {}, "tls": {}}


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
    config_overrides(ENTERPRISE_OTLP_PROTOCOL=protocol)
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
