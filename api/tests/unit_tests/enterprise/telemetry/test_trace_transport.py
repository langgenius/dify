"""Enterprise collector addresses preserve gRPC compatibility and SSRF proxy policy."""

from collections.abc import Callable
from unittest.mock import MagicMock, Mock

import grpc  # pyrefly: ignore[untyped-import]
import pytest

from core.ops.provider_export import TraceExportError
from enterprise.telemetry.enterprise_trace import EnterpriseTraceClient


@pytest.mark.parametrize(
    ("endpoint", "target", "secure"),
    [
        ("localhost:4317", "localhost:4317", False),
        ("collector.example.com:4317", "collector.example.com:4317", False),
        ("[::1]:4317", "[::1]:4317", False),
        ("collector.example.com", "collector.example.com:4317", False),
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
