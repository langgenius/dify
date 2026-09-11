"""Preserve Tencent's signal-specific transport choices without rereading queued settings."""

import base64
import os
import ssl
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_tencent import tencent_trace
from dify_trace_tencent.config import TencentConfig
from opentelemetry.proto.metrics.v1.metrics_pb2 import Metric

from configs import dify_config
from tests.unit_tests.core.ops.test_provider_export import provider_config


@pytest.fixture(autouse=True)
def clear_otlp_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in tuple(os.environ):
        if name.startswith("OTEL_EXPORTER_OTLP") or name in {"REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"}:
            monkeypatch.delenv(name)


@pytest.mark.parametrize("protocol", ["grpc", "http/protobuf", " http-protobuf ", "http/json", "http-json"])
def test_metric_protocol_is_captured_and_dispatches_separately_from_traces(
    monkeypatch: pytest.MonkeyPatch, protocol: str
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", protocol)
    config = provider_config("tencent")
    runtime = TencentConfig.load_runtime_settings(config)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "changed")
    monkeypatch.setattr(TencentConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot was reread")))
    client = tencent_trace.create_trace_client({**config, "_runtime_settings": runtime})
    client.export_state = Mock()
    client.export_state.has_completed_signal.return_value = False
    client.export_state.prepare_metrics.side_effect = lambda metrics, resource, scope_name: metrics
    grpc_send = Mock(return_value=b"")
    monkeypatch.setattr(client, "_send_grpc", grpc_send)
    if protocol == "grpc":
        client.send_metrics([Metric(name="tokens")])
        assert client.metrics_protocol == "grpc"
        assert grpc_send.call_args.args[0] == "metrics"
    else:
        assert client.metrics_http is not None
        assert client.metrics_http.endpoint == config["endpoint"]
        assert client.metrics_http.headers == {"authorization": "Bearer tenant-secret"}
        http_send = Mock(return_value=httpx.Response(200, content=b""))
        monkeypatch.setattr(client.metrics_http, "request", http_send)
        client.send_metrics([Metric(name="tokens")])
        assert client.metrics_protocol == "http/protobuf"
        http_send.assert_called_once()
        grpc_send.assert_not_called()
    assert client.protocol == "grpc"


@pytest.mark.parametrize("protocol", ["grpc", "http/protobuf"])
def test_tls_selection_preserves_sdk_signal_precedence_and_frozen_credentials(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, protocol: str
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", protocol)
    generic = {}
    for field in ("certificate", "client_key", "client_certificate"):
        path = tmp_path / field
        path.write_text("generic " + field)
        generic[field] = base64.b64encode(path.read_bytes()).decode()
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_" + field.upper(), str(path))
    trace_ca = tmp_path / "trace-ca"
    trace_ca.write_text("trace certificate")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", str(trace_ca))
    metric_key = tmp_path / "metric-key"
    metric_key.write_text("metric key")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY", str(metric_key))
    config = provider_config("tencent")
    runtime = TencentConfig.load_runtime_settings(config)
    assert runtime["trace_tls"] == {"certificate": base64.b64encode(trace_ca.read_bytes()).decode()}
    assert runtime["metrics_tls"] == {
        **generic,
        **({"client_key": base64.b64encode(metric_key.read_bytes()).decode()} if protocol != "grpc" else {}),
    }
    trace_ca.write_text("rotated certificate")
    assert TencentConfig.load_runtime_settings(config) != runtime
    monkeypatch.setattr(TencentConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot was reread")))
    credentials = Mock(side_effect=lambda tls: dict(tls))
    monkeypatch.setattr(tencent_trace, "create_grpc_credentials", credentials)
    context = ssl.create_default_context()
    create_context = Mock(return_value=context)
    monkeypatch.setattr(tencent_trace, "create_ssl_context", create_context)
    client = tencent_trace.create_trace_client({**config, "_runtime_settings": runtime})
    assert client.grpc_credentials["trace"] == runtime["trace_tls"]
    if protocol == "grpc":
        assert client.grpc_credentials["metrics"] == runtime["metrics_tls"]
        create_context.assert_not_called()
    else:
        assert client.metrics_http is not None
        assert client.metrics_http.ssl_context is context
        create_context.assert_called_once_with(runtime["metrics_tls"], verify=True)


def test_empty_grpc_signal_ca_suppresses_generic_credentials(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    ca = tmp_path / "ca"
    ca.write_text("generic CA")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_CERTIFICATE", str(ca))
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", "")
    runtime = TencentConfig.load_runtime_settings(provider_config("tencent"))
    assert runtime["trace_tls"] == {}
    assert runtime["metrics_tls"] == {"certificate": base64.b64encode(ca.read_bytes()).decode()}


def test_explicit_empty_http_metric_ca_keeps_existing_verification_setting(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_METRICS_CERTIFICATE", "")
    client = tencent_trace.create_trace_client(provider_config("tencent"))
    assert client.metrics_http is not None
    assert client.metrics_http.ssl_context is not None
    assert client.metrics_http.ssl_context.verify_mode == ssl.CERT_NONE


@pytest.mark.parametrize("ca_source", ["CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "OTEL_EXPORTER_OTLP_CERTIFICATE"])
def test_http_metric_ca_fallback_and_unused_key_do_not_change_grpc_credentials(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, ca_source: str
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
    for name in ("CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "OTEL_EXPORTER_OTLP_CERTIFICATE"):
        path = tmp_path / name
        path.write_text(name)
        monkeypatch.setenv(name, str(path))
        if name == ca_source:
            break
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY", "/unused/missing-key.pem")
    runtime = TencentConfig.load_runtime_settings(provider_config("tencent"))
    expected = {"certificate": base64.b64encode(ca_source.encode()).decode()}
    assert runtime["metrics_tls"] == expected
    assert runtime["trace_tls"] == (expected if ca_source == "OTEL_EXPORTER_OTLP_CERTIFICATE" else {})


def test_resource_dimensions_are_preserved(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tencent_trace.socket, "gethostname", lambda: "tencent-worker")
    client = tencent_trace.create_trace_client(provider_config("tencent"))
    attributes = {attribute.key: attribute.value.string_value for attribute in client.resource.attributes}
    assert attributes == {
        "service.name": "project",
        "service.version": f"dify-{dify_config.project.version}-{dify_config.COMMIT_SHA}",
        "deployment.environment": f"{dify_config.DEPLOY_ENV}-{dify_config.DEPLOYMENT_EDITION.value}",
        "host.name": "tencent-worker",
        "telemetry.sdk.language": "python",
        "telemetry.sdk.name": "opentelemetry",
        "telemetry.sdk.version": tencent_trace.otel_sdk_version,
    }


def test_empty_requests_ca_bundles_keep_http_metric_verification(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", "")
    monkeypatch.setenv("CURL_CA_BUNDLE", "")
    runtime = TencentConfig.load_runtime_settings(provider_config("tencent"))
    assert runtime["metrics_verify"] is True
    assert runtime["metrics_tls"] == {}


@pytest.mark.parametrize("protocol", ["grpc", "http/protobuf"])
@pytest.mark.parametrize("signal", ["TRACES", "METRICS"])
def test_ca_directories_are_captured_only_for_http_metrics(
    protocol: str, signal: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    certificate = tmp_path / "12345678.0"
    certificate.write_bytes(b"original certificate")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", protocol)
    monkeypatch.setenv(f"OTEL_EXPORTER_OTLP_{signal}_CERTIFICATE", str(tmp_path))
    config = provider_config("tencent")
    if protocol == "grpc" or signal == "TRACES":
        with pytest.raises(ValueError, match="^Cannot read TLS configuration$"):
            TencentConfig.load_runtime_settings(config)
        return

    captured = TencentConfig.load_runtime_settings(config)

    assert captured["trace_tls"] == {}
    assert "certificate_directory" in captured["metrics_tls"]
    assert "certificate" not in captured["metrics_tls"]
    certificate.write_bytes(b"rotated certificate")
    assert TencentConfig.load_runtime_settings(config) != captured
