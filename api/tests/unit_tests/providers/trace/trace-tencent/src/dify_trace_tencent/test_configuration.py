"""Tencent configuration checks must reject malformed input without provider I/O."""

from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Never

import grpc  # type: ignore[import-untyped]
import pytest
from dify_trace_tencent.configuration import (
    TencentConfigurationError,
    console_url,
    normalize_configuration,
    verify_configuration,
)
from opentelemetry.context import _SUPPRESS_INSTRUMENTATION_KEY, get_value
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)


def configuration_values(**overrides: object) -> dict[str, object]:
    return {
        "endpoint": "https://collector.example:4320",
        "service_name": "dify-agent",
        "token": "synthetic-token",
        **overrides,
    }


@pytest.fixture(autouse=True)
def _forbid_provider_io(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    attempts: list[str] = []

    def forbidden(*_args: object, **_kwargs: object) -> Never:
        attempts.append("provider_io")
        raise AssertionError("Local configuration validation must not construct clients or perform network I/O")

    for target in (
        "dify_trace_tencent.tencent_trace.TencentDataTrace.__init__",
        "dify_trace_tencent.client.TencentTraceClient.__init__",
        "socket.socket",
        "socket.create_connection",
        "socket.getaddrinfo",
        "grpc.secure_channel",
        "grpc.insecure_channel",
    ):
        monkeypatch.setattr(target, forbidden)
    yield
    assert attempts == []


def test_normalization_accepts_read_only_mapping_and_preserves_opaque_token() -> None:
    values = configuration_values(
        endpoint=" https://COLLECTOR.Example:4320/ ",
        service_name=" dify-agent ",
        token=" opaque token/+== ",
    )
    original = dict(values)

    result = normalize_configuration(MappingProxyType(values))

    assert result.model_dump() == {
        "endpoint": "https://collector.example:4320",
        "service_name": "dify-agent",
        "token": " opaque token/+== ",
    }
    assert values == original


@pytest.mark.parametrize("service_name", ["a", "a" * 63, "app-1", "a--b"])
def test_accepts_documented_service_name_boundaries(service_name: str) -> None:
    result = normalize_configuration(configuration_values(service_name=service_name))

    assert result.service_name == service_name


@pytest.mark.parametrize(
    "service_name",
    [None, 42, "", "   ", "dify_app", "Dify", "1app", "-app", "app-", "a" * 64, "应用", "a.b", "a/b", "a b", "a\nb"],
)
def test_rejects_invalid_service_names_before_provider_io(service_name: object) -> None:
    with pytest.raises(TencentConfigurationError) as caught:
        normalize_configuration(configuration_values(service_name=service_name))

    assert caught.value.code == "invalid_service_name"


@pytest.mark.parametrize(
    ("endpoint", "expected"),
    [
        ("https://COLLECTOR.Example:4320/", "https://collector.example:4320"),
        ("http://collector.example:4319", "http://collector.example:4319"),
        ("https://collector.example/", "https://collector.example"),
        ("http://collector.example", "http://collector.example"),
        ("https://collector.example:443", "https://collector.example:443"),
        ("http://127.0.0.1:1/", "http://127.0.0.1:1"),
        ("https://[2001:DB8::1]:65535/", "https://[2001:db8::1]:65535"),
        ("https://BÜCHER.example:4320/", "https://xn--bcher-kva.example:4320"),
    ],
)
def test_normalizes_origins_without_changing_explicit_port(endpoint: str, expected: str) -> None:
    result = normalize_configuration(configuration_values(endpoint=endpoint))

    assert result.endpoint == expected


@pytest.mark.parametrize(
    "endpoint",
    [
        None,
        4320,
        "",
        "   ",
        "collector.example:4320",
        "ftp://collector.example:4320",
        "https://",
        "https:///",
        "https://user:synthetic-secret@collector.example:4320",
        "https://@collector.example:4320",
        "https://collector.example:4320/v1/traces",
        "https://collector.example:4320//",
        "https://collector.example:4320?token=synthetic-secret",
        "https://collector.example:4320?",
        "https://collector.example:4320#project",
        "https://collector.example:4320#",
        "https://collector.example\\@other.example:4320",
        "https://col lector.example:4320",
        "https://collector.example:\n4320",
        "https://collector.example:\t4320",
        "https://collector\x00.example:4320",
        "https://collector.example:0",
        "https://collector.example:65536",
        "https://collector.example:-1",
        "https://collector.example:invalid",
        "https://collector.example:",
        "https://[2001:db8::1",
        "https://[not-an-ipv6-address]:4320",
    ],
)
def test_rejects_invalid_endpoints_before_provider_io(endpoint: object) -> None:
    with pytest.raises(TencentConfigurationError) as caught:
        normalize_configuration(configuration_values(endpoint=endpoint))

    assert caught.value.code == "invalid_endpoint"
    assert "synthetic-secret" not in str(caught.value)
    assert "synthetic-token" not in str(caught.value)


@pytest.mark.parametrize("token", [None, 42, "", " ", "\t\n"])
def test_rejects_missing_or_blank_tokens_without_provider_io(token: object) -> None:
    with pytest.raises(TencentConfigurationError) as caught:
        normalize_configuration(configuration_values(token=token))

    assert caught.value.code == "invalid_token"


def test_masked_token_survives_local_validation_for_patch_restoration() -> None:
    result = normalize_configuration(configuration_values(token="***"))

    assert result.token == "***"


@pytest.mark.parametrize(
    ("field", "error_code"),
    [("endpoint", "invalid_endpoint"), ("service_name", "invalid_service_name"), ("token", "invalid_token")],
)
def test_missing_fields_do_not_receive_legacy_defaults(field: str, error_code: str) -> None:
    values = configuration_values()
    del values[field]

    with pytest.raises(TencentConfigurationError) as caught:
        normalize_configuration(values)

    assert caught.value.code == error_code


def test_console_url_is_constant_without_configuration_or_provider_io() -> None:
    assert console_url() == "https://console.cloud.tencent.com/apm"


@dataclass
class ExportCall:
    request: ExportTraceServiceRequest
    metadata: tuple[tuple[str, str], ...]
    timeout: float
    wait_for_ready: bool


@dataclass
class CollectorChannel:
    target: str
    secure: bool
    options: tuple[tuple[str, int], ...]
    response_bytes: bytes
    failure: Exception | None = None
    fail_stub_construction: bool = False
    calls: list[ExportCall] = field(default_factory=list)
    close_count: int = 0

    def unary_unary(
        self,
        method: str,
        request_serializer: Callable[[ExportTraceServiceRequest], bytes],
        response_deserializer: Callable[[bytes], ExportTraceServiceResponse],
        **_kwargs: object,
    ) -> Callable[..., ExportTraceServiceResponse]:
        assert method == "/opentelemetry.proto.collector.trace.v1.TraceService/Export"
        if self.fail_stub_construction:
            raise RuntimeError("private-stub-detail synthetic-token")

        def invoke(
            payload: ExportTraceServiceRequest,
            metadata: Sequence[tuple[str, str]],
            timeout: float,
            wait_for_ready: bool,
        ) -> ExportTraceServiceResponse:
            assert get_value(_SUPPRESS_INSTRUMENTATION_KEY) is True
            request = ExportTraceServiceRequest.FromString(request_serializer(payload))
            self.calls.append(
                ExportCall(request=request, metadata=tuple(metadata), timeout=timeout, wait_for_ready=wait_for_ready)
            )
            if self.failure is not None:
                raise self.failure
            return response_deserializer(self.response_bytes)

        return invoke

    def close(self) -> None:
        self.close_count += 1


@dataclass
class CollectorBoundary:
    response_bytes: bytes = b""
    failure: Exception | None = None
    fail_stub_construction: bool = False
    fail_channel_construction: bool = False
    channels: list[CollectorChannel] = field(default_factory=list)

    def open_channel(self, target: str, secure: bool, options: Sequence[tuple[str, int]]) -> CollectorChannel:
        if self.fail_channel_construction:
            raise RuntimeError("private-channel-detail synthetic-token")
        channel = CollectorChannel(
            target=target,
            secure=secure,
            options=tuple(options),
            response_bytes=self.response_bytes,
            failure=self.failure,
            fail_stub_construction=self.fail_stub_construction,
        )
        self.channels.append(channel)
        return channel

    def secure_channel(self, target: str, credentials: object, options: Sequence[tuple[str, int]]) -> CollectorChannel:
        assert credentials is not None
        return self.open_channel(target, secure=True, options=options)

    def insecure_channel(self, target: str, options: Sequence[tuple[str, int]]) -> CollectorChannel:
        return self.open_channel(target, secure=False, options=options)


@pytest.fixture
def collector(monkeypatch: pytest.MonkeyPatch, _forbid_provider_io: None) -> Iterator[CollectorBoundary]:
    prior_suppression = get_value(_SUPPRESS_INSTRUMENTATION_KEY)
    boundary = CollectorBoundary()
    monkeypatch.setattr("grpc.secure_channel", boundary.secure_channel)
    monkeypatch.setattr("grpc.insecure_channel", boundary.insecure_channel)
    yield boundary
    assert get_value(_SUPPRESS_INSTRUMENTATION_KEY) == prior_suppression


@pytest.mark.parametrize(
    ("endpoint", "target", "secure"),
    [
        ("https://collector.example", "collector.example:4317", True),
        ("http://collector.example", "collector.example:4317", False),
        ("https://collector.example:4320", "collector.example:4320", True),
        ("http://collector.example:4319", "collector.example:4319", False),
        ("https://[2001:db8::1]:4320", "[2001:db8::1]:4320", True),
    ],
)
def test_probe_serializes_one_empty_export_and_closes_channel(
    collector: CollectorBoundary, endpoint: str, target: str, secure: bool
) -> None:
    config = normalize_configuration(configuration_values(endpoint=endpoint))

    assert verify_configuration(config) == config

    assert len(collector.channels) == 1
    channel = collector.channels[0]
    assert (channel.target, channel.secure) == (target, secure)
    assert dict(channel.options) == {"grpc.enable_retries": 0, "grpc.max_receive_message_length": 4 * 1024 * 1024}
    assert len(channel.calls) == 1
    call = channel.calls[0]
    assert list(call.request.resource_spans) == []
    assert call.request.SerializeToString() == b""
    assert call.metadata == (("authorization", "Bearer synthetic-token"),)
    assert call.timeout == 10
    assert call.wait_for_ready is False
    assert channel.close_count == 1


def test_probe_credentials_belong_to_each_request(collector: CollectorBoundary) -> None:
    for token in ("first-synthetic-token", "second-synthetic-token"):
        verify_configuration(normalize_configuration(configuration_values(token=token)))

    assert len(collector.channels) == 2
    assert [channel.calls[0].metadata for channel in collector.channels] == [
        (("authorization", "Bearer first-synthetic-token"),),
        (("authorization", "Bearer second-synthetic-token"),),
    ]
    assert all(channel.close_count == 1 for channel in collector.channels)


@pytest.mark.parametrize(
    ("rejected_spans", "error_message"),
    [(1, ""), (0, "private-collector-detail synthetic-token")],
)
def test_probe_rejects_partial_response_and_closes_channel(
    collector: CollectorBoundary, rejected_spans: int, error_message: str
) -> None:
    response = ExportTraceServiceResponse()
    response.partial_success.rejected_spans = rejected_spans
    response.partial_success.error_message = error_message
    collector.response_bytes = response.SerializeToString()

    with pytest.raises(TencentConfigurationError) as caught:
        verify_configuration(normalize_configuration(configuration_values()))

    assert caught.value.code == "unexpected_response"
    assert "private-collector-detail" not in str(caught.value)
    assert "synthetic-token" not in str(caught.value)
    assert collector.channels[0].close_count == 1


@pytest.mark.parametrize(
    "failure",
    [
        grpc.RpcError("private-rpc-detail synthetic-token"),
        ValueError("private-serialization-detail synthetic-token"),
    ],
)
def test_probe_transport_failures_are_safe_and_close_channel(collector: CollectorBoundary, failure: Exception) -> None:
    collector.failure = failure

    with pytest.raises(TencentConfigurationError) as caught:
        verify_configuration(normalize_configuration(configuration_values()))

    assert caught.value.code == "connection_failed"
    assert "private-" not in str(caught.value)
    assert "synthetic-token" not in str(caught.value)
    assert len(collector.channels[0].calls) == 1
    assert collector.channels[0].close_count == 1


def test_probe_unreadable_response_is_safe_and_closes_channel(collector: CollectorBoundary) -> None:
    collector.response_bytes = b"\xff"

    with pytest.raises(TencentConfigurationError) as caught:
        verify_configuration(normalize_configuration(configuration_values()))

    assert caught.value.code == "connection_failed"
    assert collector.channels[0].close_count == 1


def test_probe_stub_construction_failure_is_safe_and_closes_channel(collector: CollectorBoundary) -> None:
    collector.fail_stub_construction = True

    with pytest.raises(TencentConfigurationError) as caught:
        verify_configuration(normalize_configuration(configuration_values()))

    assert caught.value.code == "connection_failed"
    assert "private-stub-detail" not in str(caught.value)
    assert "synthetic-token" not in str(caught.value)
    assert collector.channels[0].calls == []
    assert collector.channels[0].close_count == 1


def test_probe_channel_construction_failure_has_fixed_safe_error(collector: CollectorBoundary) -> None:
    collector.fail_channel_construction = True

    with pytest.raises(TencentConfigurationError) as caught:
        verify_configuration(normalize_configuration(configuration_values()))

    assert caught.value.code == "connection_failed"
    assert "private-channel-detail" not in str(caught.value)
    assert "synthetic-token" not in str(caught.value)
    assert collector.channels == []
