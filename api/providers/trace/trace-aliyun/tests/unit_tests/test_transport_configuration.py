"""Keep the former OTel HTTP exporter's transport settings across queued delivery."""

import base64
import json
import os
import ssl
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest
from dify_trace_aliyun import aliyun_trace
from dify_trace_aliyun.config import AliyunConfig
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

from configs import dify_config
from core.ops.provider_config import provider_config_identity, resolve_provider_config
from core.ops.trace_source import _settings_hash

# Pytest importlib mode resolves these hyphenated provider packages.
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


@pytest.fixture(autouse=True)
def clear_otlp_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in tuple(os.environ):
        if name.startswith("OTEL_EXPORTER_OTLP") or name in {"REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"}:
            monkeypatch.delenv(name)


def test_headers_keep_sdk_precedence_and_do_not_log_malformed_secrets(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "x-token=base-token")
    config = make_provider_config()
    assert AliyunConfig.load_runtime_settings(config)["headers"] == {"x-token": "base-token"}
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "x-token=trace%20token,invalid-secret-value")
    assert AliyunConfig.load_runtime_settings(config)["headers"] == {"x-token": "trace token"}
    assert "invalid-secret-value" not in caplog.text
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "")
    assert AliyunConfig.load_runtime_settings(config)["headers"] == {}


def test_tls_snapshot_matches_the_sdk_and_survives_file_and_environment_changes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    files = {}
    for field in ("certificate", "client_key", "client_certificate"):
        path = tmp_path / field
        path.write_text("original " + field)
        files[field] = path
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_" + field.upper(), str(path))
    trace_ca = tmp_path / "trace-ca"
    trace_ca.write_text("trace certificate")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", str(trace_ca))
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "x-token=original")
    config = make_provider_config()
    runtime = AliyunConfig.load_runtime_settings(config)
    old_exporter = OTLPSpanExporter(endpoint=config["endpoint"])
    try:
        assert old_exporter._certificate_file == str(trace_ca)
        assert old_exporter._client_cert == (str(files["client_certificate"]), str(files["client_key"]))
        assert runtime["headers"] == old_exporter._headers
    finally:
        old_exporter.shutdown()
    assert runtime["tls"] == {
        **{field: base64.b64encode(path.read_bytes()).decode() for field, path in files.items()},
        "certificate": base64.b64encode(trace_ca.read_bytes()).decode(),
    }
    trace_ca.write_text("rotated certificate")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "x-token=rotated")
    assert AliyunConfig.load_runtime_settings(config) != runtime
    context = ssl.create_default_context()
    create_context = Mock(return_value=context)
    monkeypatch.setattr(aliyun_trace, "create_ssl_context", create_context)
    monkeypatch.setattr(AliyunConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot was reread")))
    client = aliyun_trace.create_trace_client({**config, "_runtime_settings": runtime})
    create_context.assert_called_once_with(runtime["tls"], verify=True)
    assert client.http.ssl_context is context
    assert client.http.headers == {"x-token": "original"}


@pytest.mark.parametrize("prefix", ["OTEL_EXPORTER_OTLP_", "OTEL_EXPORTER_OTLP_TRACES_"])
def test_explicit_empty_ca_keeps_existing_verification_setting(monkeypatch: pytest.MonkeyPatch, prefix: str) -> None:
    monkeypatch.setenv(prefix + "CERTIFICATE", "")
    client = aliyun_trace.create_trace_client(make_provider_config())
    assert client.http.ssl_context is not None
    assert client.http.ssl_context.verify_mode == ssl.CERT_NONE
    assert client.http.ssl_context.check_hostname is False


def test_unreadable_tls_file_fails_without_disclosing_its_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", "/unavailable/private-certificate.pem")
    with pytest.raises(ValueError, match="^Cannot read TLS configuration$"):
        AliyunConfig.load_runtime_settings(make_provider_config())


@pytest.mark.parametrize("ca_source", ["CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "OTEL_EXPORTER_OTLP_CERTIFICATE"])
def test_requests_ca_fallback_and_unused_client_key_match_old_http_transport(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, ca_source: str
) -> None:
    for name in ("CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "OTEL_EXPORTER_OTLP_CERTIFICATE"):
        path = tmp_path / name
        path.write_text(name)
        monkeypatch.setenv(name, str(path))
        if name == ca_source:
            break
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY", "/unused/missing-key.pem")
    runtime = AliyunConfig.load_runtime_settings(make_provider_config())
    assert runtime["tls"] == {"certificate": base64.b64encode(ca_source.encode()).decode()}


def test_resource_dimensions_and_console_link_are_preserved(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(aliyun_trace.socket, "gethostname", lambda: "aliyun-worker")
    client = aliyun_trace.create_trace_client(make_provider_config())
    assert {attribute.key: attribute.value.string_value for attribute in client.resource.attributes} == {
        "service.name": "project",
        "service.version": f"dify-{dify_config.project.version}-{dify_config.COMMIT_SHA}",
        "deployment.environment": f"{dify_config.DEPLOY_ENV}-{dify_config.DEPLOYMENT_EDITION.value}",
        "host.name": "aliyun-worker",
        "acs.arms.service.feature": "genai_app",
    }
    assert client.get_project_url() == "https://arms.console.aliyun.com/#/llm"


def test_empty_requests_ca_bundles_keep_certificate_verification(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", "")
    monkeypatch.setenv("CURL_CA_BUNDLE", "")
    runtime = AliyunConfig.load_runtime_settings(make_provider_config())
    assert runtime["verify"] is True
    assert runtime["tls"] == {}


@pytest.mark.parametrize(
    "ca_source",
    ["REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "OTEL_EXPORTER_OTLP_CERTIFICATE", "OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE"],
)
def test_http_ca_directory_is_captured_and_detects_certificate_rotation(
    ca_source: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    certificate = tmp_path / "12345678.0"
    certificate.write_bytes(b"original certificate")
    monkeypatch.setenv(ca_source, str(tmp_path))
    config = make_provider_config()

    captured = AliyunConfig.load_runtime_settings(config)

    assert "certificate_directory" in captured["tls"]
    assert "certificate" not in captured["tls"]
    certificate.write_bytes(b"rotated certificate")
    assert AliyunConfig.load_runtime_settings(config) != captured


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {"OTEL_EXPORTER_OTLP_TIMEOUT": "60"},
        {"OTEL_EXPORTER_OTLP_TIMEOUT": "80", "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT": "70.5"},
        {"OTEL_EXPORTER_OTLP_TIMEOUT": "80", "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT": "0"},
        {"OTEL_EXPORTER_OTLP_TIMEOUT": "inf"},
        {"OTEL_EXPORTER_OTLP_TRACES_TIMEOUT": "nan"},
    ],
)
def test_timeout_matches_native_exporter_and_is_bound_to_captured_settings(
    environment: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(dify_config, "SECRET_KEY", "aliyun-timeout-test")
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    config = make_provider_config()
    captured = resolve_provider_config("aliyun", config)
    json.dumps(captured, allow_nan=False)
    native = OTLPSpanExporter(endpoint=config["endpoint"])
    try:
        native_timeout = native._timeout
        assert captured["_runtime_settings"]["request_timeout"] == str(native_timeout)
    finally:
        native.shutdown()
    tenant_id = str(uuid4())
    fingerprint = _settings_hash(tenant_id, provider_config_identity("aliyun", captured))
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", "90")
    rotated = resolve_provider_config("aliyun", config)
    assert _settings_hash(tenant_id, provider_config_identity("aliyun", rotated)) != fingerprint
    monkeypatch.setattr(AliyunConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot was reread")))

    client = aliyun_trace.create_trace_client(captured)

    assert str(client.http.request_timeout) == str(native_timeout)
    assert _settings_hash(tenant_id, provider_config_identity("aliyun", captured)) == fingerprint
