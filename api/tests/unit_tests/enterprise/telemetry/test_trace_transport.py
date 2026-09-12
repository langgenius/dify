"""Enterprise collector addresses preserve gRPC compatibility and SSRF proxy policy."""

import base64
from collections.abc import Callable
from pathlib import Path
from unittest.mock import MagicMock, Mock

import grpc  # pyrefly: ignore[untyped-import]
import httpx
import pytest

from core.ops.provider_export import TraceExportError
from enterprise.telemetry.enterprise_trace import EnterpriseTraceClient


@pytest.mark.parametrize(
    ("endpoint", "target", "secure"),
    [
        ("localhost:4317", "localhost:4317", False),
        ("collector.example.com:4317", "collector.example.com:4317", False),
        ("[::1]:4317", "[::1]:4317", False),
        ("collector.example.com", "collector.example.com:443", False),
        ("http://collector.example.com", "collector.example.com:443", False),
        ("https://collector.example.com", "collector.example.com:443", True),
        ("http://collector.example.com:4317", "collector.example.com:4317", False),
        ("https://collector.example.com:4317", "collector.example.com:4317", True),
    ],
)
def test_grpc_addresses_keep_tls_and_proxy_policy(
    endpoint: str, target: str, secure: bool, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(
        SSRF_PROXY_ALL_URL="",
        SSRF_PROXY_HTTP_URL="http://http-proxy:3128",
        SSRF_PROXY_HTTPS_URL="http://https-proxy:3128",
    )
    monkeypatch.setenv("no_grpc_proxy", "")
    channel = MagicMock()
    channel.unary_unary.return_value = Mock(return_value=b"")
    secure_channel, insecure_channel = Mock(return_value=channel), Mock(return_value=channel)
    monkeypatch.setattr(grpc, "secure_channel", secure_channel)
    monkeypatch.setattr(grpc, "insecure_channel", insecure_channel)
    client = EnterpriseTraceClient({"endpoint": endpoint, "protocol": "grpc"})

    for signal in ("trace", "metrics"):
        assert client.otlp._send(signal, b"") == b""

    chosen, unused = (secure_channel, insecure_channel) if secure else (insecure_channel, secure_channel)
    assert chosen.call_count == 2
    assert chosen.call_args is not None
    assert chosen.call_args.args[0] == target
    expected_proxy = "http://https-proxy:3128" if secure else "http://http-proxy:3128"
    assert chosen.call_args.kwargs["options"] == [("grpc.http_proxy", expected_proxy)]
    unused.assert_not_called()


def test_bare_grpc_address_cannot_bypass_configured_proxy(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(SSRF_PROXY_ALL_URL="http://ssrf-proxy:3128")
    monkeypatch.setenv("no_grpc_proxy", "localhost")
    insecure_channel = Mock()
    monkeypatch.setattr(grpc, "insecure_channel", insecure_channel)
    client = EnterpriseTraceClient({"endpoint": "localhost:4317", "protocol": "grpc"})
    with pytest.raises(TraceExportError, match="grpc_proxy_bypass_disabled"):
        client.otlp._send("trace", b"")
    insecure_channel.assert_not_called()


@pytest.mark.parametrize("endpoint", ["user:secret@collector.example:4317", "ftp://collector.example:4317"])
def test_grpc_addresses_still_reject_credentials_and_unsupported_schemes(endpoint: str) -> None:
    with pytest.raises(ValueError, match="HTTP endpoint without embedded credentials"):
        EnterpriseTraceClient({"endpoint": endpoint, "protocol": "grpc"})


def test_http_protocol_still_requires_a_url() -> None:
    with pytest.raises(ValueError, match="HTTP endpoint without embedded credentials"):
        EnterpriseTraceClient({"endpoint": "localhost:4318", "protocol": "http/protobuf"})


@pytest.mark.parametrize("protocol", ["grpc", "http"])
def test_signal_tls_contents_reach_the_transport_and_client_key_files_are_removed(
    protocol: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    contexts = [MagicMock(), MagicMock()]
    ssl_context = Mock(side_effect=contexts)
    monkeypatch.setattr("core.helper.ssl_context.ssl.create_default_context", ssl_context)
    credentials = Mock(side_effect=["trace-credentials", "metric-credentials"])
    monkeypatch.setattr(grpc, "ssl_channel_credentials", credentials)
    signals = {
        signal: {
            "endpoint": f"https://{signal}.example:443",
            "headers": {"authorization": signal},
            "tls": {
                field: base64.b64encode(f"{signal}-{field}".encode()).decode()
                for field in ("certificate", "client_key", "client_certificate")
            },
        }
        for signal in ("trace", "metrics")
    }
    loaded_client_files: list[Path] = []
    for signal, context in zip(signals, contexts, strict=True):

        def load_chain(certificate_path: str, key_path: str, *, current_signal: str = signal) -> None:
            certificate, key = Path(certificate_path), Path(key_path)
            assert certificate.read_bytes() == f"{current_signal}-client_certificate".encode()
            assert key.read_bytes() == f"{current_signal}-client_key".encode()
            assert certificate.stat().st_mode & 0o077 == key.stat().st_mode & 0o077 == 0
            loaded_client_files.extend((certificate, key))

        context.load_cert_chain.side_effect = load_chain

    client = EnterpriseTraceClient({"protocol": protocol, "signals": signals})
    if protocol == "grpc":
        assert client.otlp.grpc_credentials == {"trace": "trace-credentials", "metrics": "metric-credentials"}
        assert credentials.call_args_list[0].kwargs == {
            "root_certificates": b"trace-certificate",
            "private_key": b"trace-client_key",
            "certificate_chain": b"trace-client_certificate",
        }
        assert credentials.call_args_list[1].kwargs["root_certificates"] == b"metrics-certificate"
        ssl_context.assert_not_called()
    else:
        assert client.otlp.http.ssl_context is contexts[0]
        assert client.otlp.metrics_http is not None
        assert client.otlp.metrics_http.ssl_context is contexts[1]
        assert ssl_context.call_args_list[0].kwargs["cadata"] == b"trace-certificate"
        assert ssl_context.call_args_list[1].kwargs["cadata"] == b"metrics-certificate"
        assert len(loaded_client_files) == 4
        assert not any(path.exists() for path in loaded_client_files)
        credentials.assert_not_called()


def test_standard_signal_http_endpoint_paths_are_sent_exactly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "https://trace.example/custom/")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "https://metrics.example/other/")
    request = Mock(return_value=httpx.Response(200, content=b""))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    client = EnterpriseTraceClient({"endpoint": "", "protocol": "http"})
    client.otlp._send("trace", b"trace")
    client.otlp._send("metrics", b"metrics")
    assert [call.args[1] for call in request.call_args_list] == [
        "https://trace.example/custom/",
        "https://metrics.example/other/",
    ]
