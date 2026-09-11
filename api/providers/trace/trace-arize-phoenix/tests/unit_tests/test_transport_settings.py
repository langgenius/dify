import os
from pathlib import Path
from unittest.mock import MagicMock, Mock

import pytest
from dify_trace_arize_phoenix.arize_phoenix_trace import create_trace_client
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig


@pytest.mark.parametrize(
    ("provider", "endpoint", "environment", "expected"),
    [
        ("arize", "https://collector.example", {}, {"tls": {"certificate": "general-ca"}, "insecure": False}),
        ("phoenix", "https://collector.example", {}, {"tls": {"certificate": "general-ca"}, "verify": True}),
        (
            "phoenix",
            "https://collector.example",
            {
                "OTEL_EXPORTER_OTLP_CERTIFICATE": None,
                "REQUESTS_CA_BUNDLE": "requests-ca",
                "CURL_CA_BUNDLE": "curl-ca",
            },
            {"tls": {"certificate": "requests-ca"}, "verify": True},
        ),
        (
            "phoenix",
            "https://collector.example",
            {"OTEL_EXPORTER_OTLP_CERTIFICATE": None, "REQUESTS_CA_BUNDLE": "", "CURL_CA_BUNDLE": "curl-ca"},
            {"tls": {"certificate": "curl-ca"}, "verify": True},
        ),
        (
            "phoenix",
            "https://collector.example",
            {"OTEL_EXPORTER_OTLP_CERTIFICATE": None, "REQUESTS_CA_BUNDLE": "", "CURL_CA_BUNDLE": ""},
            {"tls": {}, "verify": True},
        ),
        (
            "phoenix",
            "https://collector.example",
            {"REQUESTS_CA_BUNDLE": "requests-ca"},
            {"tls": {"certificate": "general-ca"}, "verify": True},
        ),
        (
            "phoenix",
            "https://collector.example",
            {"OTEL_EXPORTER_OTLP_CLIENT_KEY": "unused-key"},
            {"tls": {"certificate": "general-ca"}, "verify": True},
        ),
        (
            "arize",
            "https://collector.example",
            {"OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE": "trace-ca", "OTEL_EXPORTER_OTLP_CLIENT_KEY": "general-key"},
            {"tls": {"certificate": "trace-ca"}, "insecure": False},
        ),
        (
            "phoenix",
            "https://collector.example",
            {
                "OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE": "trace-ca",
                "OTEL_EXPORTER_OTLP_CLIENT_KEY": "general-key",
                "OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE": "general-client",
            },
            {
                "tls": {"certificate": "trace-ca", "client_key": "general-key", "client_certificate": "general-client"},
                "verify": True,
            },
        ),
        (
            "arize",
            "https://collector.example",
            {
                "OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE": "trace-ca",
                "OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY": "trace-key",
                "OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE": "trace-client",
            },
            {
                "tls": {"certificate": "trace-ca", "client_key": "trace-key", "client_certificate": "trace-client"},
                "insecure": False,
            },
        ),
        (
            "arize",
            "https://collector.example",
            {"OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE": ""},
            {"tls": {}, "insecure": False},
        ),
        (
            "phoenix",
            "https://collector.example",
            {"OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE": "", "REQUESTS_CA_BUNDLE": "requests-ca"},
            {"tls": {}, "verify": False},
        ),
        (
            "arize",
            "https://collector.example",
            {"OTEL_EXPORTER_OTLP_CERTIFICATE": "", "OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE": "client-pem"},
            {"tls": {}, "insecure": False},
        ),
        (
            "phoenix",
            "https://collector.example",
            {"OTEL_EXPORTER_OTLP_CERTIFICATE": "", "OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE": "client-pem"},
            {"tls": {"client_certificate": "client-pem"}, "verify": False},
        ),
        (
            "arize",
            "https://collector.example",
            {"OTEL_EXPORTER_OTLP_TRACES_INSECURE": "true", "OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE": "trace-ca"},
            {"tls": {"certificate": "general-ca"}, "insecure": False},
        ),
        (
            "arize",
            "http://collector.example",
            {"OTEL_EXPORTER_OTLP_INSECURE": "false"},
            {"tls": {"certificate": "general-ca"}, "insecure": False},
        ),
        ("arize", "http://collector.example", {}, {"tls": {}, "insecure": True}),
    ],
)
def test_runtime_tls_settings_preserve_sdk_precedence(
    provider: str, endpoint: str, environment: dict[str, str | None], expected: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in ("REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"):
        monkeypatch.delenv(name, raising=False)
    for prefix in ("OTEL_EXPORTER_OTLP", "OTEL_EXPORTER_OTLP_TRACES"):
        for suffix in ("CERTIFICATE", "CLIENT_KEY", "CLIENT_CERTIFICATE", "INSECURE"):
            monkeypatch.delenv(f"{prefix}_{suffix}", raising=False)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_CERTIFICATE", "general-ca")
    for key, value in environment.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)
    monkeypatch.setattr(
        "dify_trace_arize_phoenix.config.read_tls_files",
        lambda filenames, **kwargs: {key: value for key, value in filenames.items() if value},
    )
    config_class = ArizeConfig if provider == "arize" else PhoenixConfig
    assert config_class.load_runtime_settings({"endpoint": endpoint}) == expected


@pytest.mark.parametrize(
    ("endpoint", "insecure", "expected_target"),
    [
        ("https://collector.example", False, "collector.example:443"),
        ("https://collector.example:4317", False, "collector.example:4317"),
        ("http://collector.example:4317", True, "collector.example:4317"),
        ("http://collector.example:4317", False, "collector.example:4317"),
    ],
)
def test_arize_keeps_grpc_receiver_and_uses_captured_credentials(
    endpoint: str, insecure: bool, expected_target: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    credentials = object()
    tls = {"certificate": "captured-ca", "client_certificate": "captured-client", "client_key": "captured-key"}
    build_credentials = Mock(return_value=credentials)
    monkeypatch.setattr("dify_trace_arize_phoenix.arize_phoenix_trace.create_grpc_credentials", build_credentials)
    monkeypatch.setattr(ArizeConfig, "load_runtime_settings", Mock(side_effect=AssertionError("must use snapshot")))
    for field in ("SSRF_PROXY_ALL_URL", "SSRF_PROXY_HTTP_URL", "SSRF_PROXY_HTTPS_URL"):
        monkeypatch.setattr(f"configs.dify_config.{field}", "")
    channel = MagicMock()
    channel.unary_unary.return_value.return_value = b""
    open_channel = Mock(return_value=channel)
    monkeypatch.setattr("grpc.insecure_channel" if insecure else "grpc.secure_channel", open_channel)

    client = create_trace_client(
        "arize",
        {
            "endpoint": endpoint,
            "api_key": "project-key",
            "space_id": "space",
            "_runtime_settings": {"tls": tls, "insecure": insecure},
        },
    )
    assert client.verify_credentials()
    assert open_channel.call_args.args == ((expected_target,) if insecure else (expected_target, credentials))
    channel.unary_unary.assert_called_once_with("/opentelemetry.proto.collector.trace.v1.TraceService/Export")
    assert dict(channel.unary_unary.return_value.call_args.kwargs["metadata"]) == {
        "api_key": "project-key",
        "space_id": "space",
        "authorization": "Bearer project-key",
    }
    build_credentials.assert_called_once_with(tls)


def test_phoenix_http_uses_captured_tls_without_reloading_files(monkeypatch: pytest.MonkeyPatch) -> None:
    ssl_context = object()
    tls = {"certificate": "captured-ca", "client_certificate": "captured-client", "client_key": "captured-key"}
    build_ssl_context = Mock(return_value=ssl_context)
    monkeypatch.setattr("dify_trace_arize_phoenix.arize_phoenix_trace.create_ssl_context", build_ssl_context)
    monkeypatch.setattr(PhoenixConfig, "load_runtime_settings", Mock(side_effect=AssertionError("must use snapshot")))
    client = create_trace_client(
        "phoenix",
        {"endpoint": "https://collector.example/project", "_runtime_settings": {"tls": tls, "verify": False}},
    )
    assert client.protocol == "http/protobuf"
    assert client.http.endpoint == "https://collector.example/project/v1/traces"
    assert client.http.ssl_context is ssl_context
    build_ssl_context.assert_called_once_with(tls, verify=False)


def test_phoenix_plain_http_does_not_read_an_unused_ca_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", "/missing/unused-ca.pem")
    assert PhoenixConfig.load_runtime_settings({"endpoint": "http://collector.example:6006"}) == {
        "tls": {},
        "verify": True,
    }


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
def test_ca_directories_are_captured_only_for_http(
    provider: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    for name in tuple(os.environ):
        if name.startswith("OTEL_EXPORTER_OTLP") or name in {"REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"}:
            monkeypatch.delenv(name)
    certificate = tmp_path / "12345678.0"
    certificate.write_bytes(b"original certificate")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", str(tmp_path))
    config = {"endpoint": "https://collector.example"}
    if provider == "arize":
        with pytest.raises(ValueError, match="^Cannot read TLS configuration$"):
            ArizeConfig.load_runtime_settings(config)
        return

    captured = PhoenixConfig.load_runtime_settings(config)

    assert "certificate_directory" in captured["tls"]
    assert "certificate" not in captured["tls"]
    certificate.write_bytes(b"rotated certificate")
    assert PhoenixConfig.load_runtime_settings(config) != captured
