"""Protocol fixtures for complete trees, fixed destinations and synchronous acceptance."""

import os
import ssl
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import monotonic
from typing import Never, TypedDict, Unpack
from unittest.mock import MagicMock, Mock, patch
from uuid import UUID, uuid4

import grpc  # pyrefly: ignore[untyped-import]
import httpx
import pytest
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceResponse,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient, counter, histogram, otlp_span, otlp_value
from core.ops.provider_config import (
    decrypt_provider_config,
    encrypt_provider_config,
    get_provider_config_fields,
    mask_provider_config,
)
from core.ops.provider_export import (
    TraceExportError,
    TraceProviderHttpClient,
    create_provider_client,
    export_trace,
    provider_uuid,
    span_attributes,
    span_id_bytes,
    timestamp_ns,
)
from core.ops.trace_data import (
    CompletedTrace,
    TraceProviderSettings,
    TraceSource,
    TraceSpan,
    make_span_id,
    make_trace_id,
)


class RequestArguments(TypedDict, total=False):
    headers: dict[str, str]
    json: dict[str, JsonValue]
    content: bytes
    max_retries: int
    follow_redirects: bool
    timeout: float
    http_client: httpx.Client


@pytest.fixture(autouse=True)
def isolate_deployment_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(Path, "home", Mock(return_value=tmp_path))
    monkeypatch.setattr(Path, "cwd", Mock(return_value=tmp_path))
    with patch.dict(os.environ, {}, clear=True):
        yield


def make_completed_trace() -> CompletedTrace:
    tenant_id, operation_id, app_id = (str(uuid4()) for _ in range(3))
    root_id, child_id, nested_id = (make_span_id(tenant_id, operation_id, name) for name in ("root", "tool", "nested"))
    started_at = datetime(2026, 9, 9, 8, tzinfo=UTC)
    ended_at = started_at + timedelta(seconds=2)
    return CompletedTrace(
        source=TraceSource(tenant_id=tenant_id, operation_id=operation_id, app_id=app_id, session_id="session"),
        trace_id=make_trace_id(tenant_id, operation_id),
        root_span_id=root_id,
        spans=(
            TraceSpan(
                span_id=root_id,
                span_name="Workflow",
                span_type="workflow",
                started_at=started_at,
                ended_at=ended_at,
                inputs={"query": "hello"},
                outputs={"answer": "world"},
                usage={"total_tokens": 8},
            ),
            TraceSpan(
                span_id=child_id,
                parent_span_id=root_id,
                span_name="Nested workflow",
                span_type="tool",
                started_at=started_at,
                ended_at=ended_at,
                inputs={"query": "hello"},
                outputs="world",
            ),
            TraceSpan(
                span_id=nested_id,
                parent_span_id=child_id,
                span_name="Model",
                span_type="llm",
                node_execution_id=str(uuid4()),
                started_at=started_at,
                ended_at=ended_at,
                inputs={"messages": [{"role": "user", "content": "hello"}]},
                outputs="world",
                attributes={"model_name": "model", "model_provider": "provider"},
                usage={"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8, "total_cost": "0.02"},
            ),
        ),
    )


def provider_config(provider: str, secret: str = "tenant-secret") -> dict[str, str]:
    return {
        "langsmith": {"api_key": secret, "project": "project", "endpoint": "https://langsmith.example"},
        "langfuse": {"public_key": "public", "secret_key": secret, "host": "https://langfuse.example"},
        "opik": {"api_key": secret, "workspace": "workspace", "project": "project", "url": "https://opik.example/api/"},
        "weave": {"api_key": secret, "entity": "entity", "project": "project", "endpoint": "https://weave.example"},
        "phoenix": {"api_key": secret, "project": "project", "endpoint": "https://phoenix.example"},
        "arize": {"api_key": secret, "project": "project", "space_id": "space", "endpoint": "https://arize.example"},
        "aliyun": {"license_key": secret, "app_name": "project", "endpoint": "https://aliyun.example"},
        "tencent": {"token": secret, "service_name": "project", "endpoint": "https://tencent.example:4317"},
        "mlflow": {
            "username": "user",
            "password": secret,
            "experiment_id": "1",
            "tracking_uri": "https://mlflow.example",
        },
        "databricks": {"personal_access_token": secret, "experiment_id": "1", "host": "https://databricks.example"},
    }[provider]


def settings_for(trace: CompletedTrace, provider: str) -> TraceProviderSettings:
    return TraceProviderSettings(
        tenant_id=trace.source.tenant_id,
        app_id=trace.source.app_id,
        provider_name=provider,
        config_id=str(uuid4()),
        config_revision=2,
    )


@pytest.mark.parametrize(
    "provider",
    ["langsmith", "langfuse", "opik", "weave", "phoenix", "arize", "aliyun", "tencent", "mlflow", "databricks"],
)
def test_every_provider_exports_complete_tree_with_repeatable_ids(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    requests: list[tuple[str, str, RequestArguments]] = []

    def request(method: str, url: str, **kwargs: Unpack[RequestArguments]) -> httpx.Response:
        requests.append((method, url, kwargs))
        if "credentials-for-data-upload" in url:
            return httpx.Response(
                200,
                json={
                    "credential_info": {
                        "signed_uri": "https://storage.example/traces.json?signature=upload-only",
                        "type": "AWS_PRESIGNED_URL",
                        "headers": [],
                    }
                },
            )
        if method == "GET":
            return httpx.Response(404, json={})
        if "ingestion" in url:
            return httpx.Response(207, json={"errors": []})
        if kwargs.get("headers", {}).get("Content-Type") == "application/x-protobuf":
            return httpx.Response(200, content=b"")
        return httpx.Response(200, json={})

    def grpc_request(
        client: OtlpTraceClient, signal: str, serialized: bytes, *, http_client: TraceProviderHttpClient | None = None
    ) -> bytes:
        transport = http_client if http_client is not None else client.http
        requests.append(("GRPC", signal, {"content": serialized, "headers": dict(transport.headers)}))
        return b""

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    monkeypatch.setattr(OtlpTraceClient, "_send_grpc", grpc_request)
    trace = make_completed_trace()
    settings = settings_for(trace, provider)
    environment = dict(os.environ)
    first = export_trace(trace, settings, provider_config(provider))
    second = export_trace(trace, settings, provider_config(provider))
    assert first == second
    assert len(first.spans) == 3
    assert all(receipt["tenant_id"] == trace.source.tenant_id for receipt in first.spans.values())
    assert dict(os.environ) == environment
    assert requests
    for method, _, kwargs in requests:
        if method != "GRPC":
            assert kwargs["max_retries"] == 0
            assert kwargs["follow_redirects"] is False
            assert 0 < kwargs["timeout"] <= 30


def test_tenant_and_parent_destination_mismatch_rejected_before_client_creation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    trace = make_completed_trace()
    settings = settings_for(trace, "langsmith")

    def unexpected(*_args: object) -> Never:
        pytest.fail("No provider client may be created for mismatched ownership")

    monkeypatch.setattr("core.ops.provider_export.create_provider_client", unexpected)
    with pytest.raises(TraceExportError, match="trace_tenant_mismatch"):
        export_trace(trace, settings.model_copy(update={"tenant_id": str(uuid4())}), {})
    with pytest.raises(TraceExportError, match="trace_app_mismatch"):
        export_trace(trace, settings.model_copy(update={"app_id": str(uuid4())}), {})
    with pytest.raises(TraceExportError, match="trace_parent_destination_mismatch"):
        export_trace(trace, settings, {}, {"tenant_id": str(uuid4())})


def test_http_errors_and_otlp_partial_acceptance_are_not_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.make_request",
        lambda *_args, **_kwargs: httpx.Response(429, headers={"retry-after": "60"}),
    )
    with pytest.raises(TraceExportError) as raised:
        TraceProviderHttpClient("https://provider.example").request("POST")
    assert raised.value.retryable
    assert raised.value.retry_after == 60
    rejected = ExportTraceServiceResponse()
    rejected.partial_success.rejected_spans = 1
    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.make_request",
        lambda *_args, **_kwargs: httpx.Response(200, content=rejected.SerializeToString()),
    )
    with pytest.raises(TraceExportError, match="provider_rejected_spans"):
        OtlpTraceClient("https://provider.example", {}, {}, "").export_trace(make_completed_trace())


def test_ssrf_clients_close_and_do_not_share_response_cookies(monkeypatch: pytest.MonkeyPatch) -> None:
    received_cookies: list[str | None] = []
    clients: list[httpx.Client] = []

    def respond(request: httpx.Request) -> httpx.Response:
        received_cookies.append(request.headers.get("cookie"))
        return httpx.Response(200, headers={"set-cookie": "session=tenant-a; Path=/"})

    def create_client() -> httpx.Client:
        client = httpx.Client(transport=httpx.MockTransport(respond), trust_env=False)
        clients.append(client)
        return client

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.create_http_client", create_client)
    TraceProviderHttpClient("https://same-provider.example", {"Authorization": "tenant-a"}).request("GET")
    TraceProviderHttpClient("https://same-provider.example", {"Authorization": "tenant-b"}).request("GET")
    assert received_cookies == [None, None]
    assert all(client.is_closed for client in clients)


@pytest.mark.parametrize("separate_metrics", [False, True])
def test_otlp_http_preserves_signal_destination_authentication_tls_and_deadline(
    separate_metrics: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    trace_context, metrics_context = ssl.create_default_context(), ssl.create_default_context()
    contexts: list[ssl.SSLContext | None] = []
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, content=b"")

    def create_client(*, ssl_context: ssl.SSLContext | None = None) -> httpx.Client:
        contexts.append(ssl_context)
        return httpx.Client(transport=httpx.MockTransport(respond), trust_env=False)

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.create_http_client", create_client)
    metrics = TraceProviderHttpClient(
        "https://metrics.example/custom", {"Authorization": "metrics-key"}, ssl_context=metrics_context
    )
    client = OtlpTraceClient(
        "https://traces.example/v1/traces",
        {"Authorization": "trace-key"},
        {},
        "",
        ssl_context=trace_context,
        metrics_http=metrics if separate_metrics else None,
    )
    client.http.deadline = monotonic() + 10
    client._send("trace", b"trace")
    client._send("metrics", b"metrics")
    assert [(str(request.url), request.headers["authorization"], request.content) for request in requests] == [
        ("https://traces.example/v1/traces", "trace-key", b"trace"),
        (
            "https://metrics.example/custom" if separate_metrics else "https://traces.example/v1/metrics",
            "metrics-key" if separate_metrics else "trace-key",
            b"metrics",
        ),
    ]
    assert contexts == [trace_context, metrics_context if separate_metrics else trace_context]
    if separate_metrics:
        assert metrics.deadline == client.http.deadline
    client.http.deadline = monotonic() - 1
    with pytest.raises(TraceExportError, match="export_deadline_exceeded"):
        client._send("metrics", b"expired")
    assert len(requests) == 2


def test_otlp_grpc_preserves_signal_destination_authentication_and_credentials(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(SSRF_PROXY_ALL_URL="", SSRF_PROXY_HTTP_URL="", SSRF_PROXY_HTTPS_URL="")
    credentials = {"trace": object(), "metrics": object()}
    channels = [MagicMock(), MagicMock()]
    for channel in channels:
        channel.unary_unary.return_value.return_value = b""
    secure_channel = Mock(side_effect=channels)
    monkeypatch.setattr(grpc, "secure_channel", secure_channel)
    metrics = TraceProviderHttpClient("https://metrics.example:9443", {"authorization": "metrics-key"})
    client = OtlpTraceClient(
        "https://traces.example:8443",
        {"authorization": "trace-key"},
        {},
        "",
        protocol="grpc",
        metrics_http=metrics,
        grpc_credentials=credentials,
    )
    for signal in ("trace", "metrics"):
        assert client._send(signal, signal.encode()) == b""
    assert [call.args for call in secure_channel.call_args_list] == [
        ("traces.example:8443", credentials["trace"]),
        ("metrics.example:9443", credentials["metrics"]),
    ]
    for channel, signal in zip(channels, ("trace", "metrics"), strict=True):
        send = channel.unary_unary.return_value
        assert send.call_args.args == (signal.encode(),)
        assert send.call_args.kwargs["metadata"] == (("authorization", f"{signal}-key"),)
        assert 0 < send.call_args.kwargs["timeout"] <= 30
        channel.__exit__.assert_called_once()
    assert metrics.deadline == client.http.deadline


def test_otlp_can_send_grpc_traces_and_http_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    metrics = TraceProviderHttpClient("https://metrics.example/exact")
    client = OtlpTraceClient(
        "https://traces.example:4317",
        {},
        {},
        "",
        protocol="grpc",
        metrics_http=metrics,
        metrics_protocol="http/protobuf",
    )
    send_grpc = Mock(return_value=b"")
    send_http = Mock(return_value=httpx.Response(200, content=b""))
    monkeypatch.setattr(client, "_send_grpc", send_grpc)
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", send_http)
    assert client._send("trace", b"traces") == b""
    assert client._send("metrics", b"metrics") == b""
    send_grpc.assert_called_once_with("trace", b"traces", http_client=client.http)
    assert send_http.call_args.args[:2] == ("POST", "https://metrics.example/exact")
    assert send_http.call_args.kwargs["content"] == b"metrics"
    assert metrics.deadline == client.http.deadline


@pytest.mark.parametrize(
    "provider",
    ["langsmith", "langfuse", "opik", "weave", "phoenix", "arize", "aliyun", "tencent", "mlflow", "databricks"],
)
def test_provider_credentials_round_trip_without_exposing_or_replacing_saved_secrets(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id = str(uuid4())

    def encrypt(owner: str, value: str) -> str:
        assert owner == tenant_id
        return f"encrypted:{owner}:{value}"

    def decrypt(owner: str, values: list[str]) -> list[str]:
        assert owner == tenant_id
        prefix = f"encrypted:{owner}:"
        assert all(value.startswith(prefix) for value in values)
        return [value.removeprefix(prefix) for value in values]

    monkeypatch.setattr("core.helper.encrypter.encrypt_token", encrypt)
    monkeypatch.setattr("core.helper.encrypter.batch_decrypt_token", decrypt)
    original = provider_config(provider)
    saved = encrypt_provider_config(tenant_id, provider, original)
    masked = mask_provider_config(provider, saved)
    schema = get_provider_config_fields(provider)

    assert (
        decrypt_provider_config(tenant_id, provider, saved) == schema.config_class.model_validate(original).model_dump()
    )
    assert encrypt_provider_config(tenant_id, provider, masked, previous=saved) == saved
    for field in schema.secret_keys:
        if original.get(field) is not None:
            assert saved[field] == f"encrypted:{tenant_id}:{original[field]}"
            assert "*" in masked[field]
    assert original == provider_config(provider)


def test_unknown_provider_is_rejected() -> None:
    with pytest.raises(ValueError, match="Unsupported tracing provider"):
        get_provider_config_fields("unknown")
    with pytest.raises(ValueError, match="Unsupported tracing provider"):
        create_provider_client("unknown", {})


@pytest.mark.parametrize(
    "endpoint", ["ftp://provider.example", "https:///missing-host", "https://user:secret@provider.example"]
)
def test_http_client_rejects_invalid_or_embedded_credentials(endpoint: str) -> None:
    with pytest.raises(ValueError, match="HTTP endpoint without embedded credentials"):
        TraceProviderHttpClient(endpoint)


def test_http_client_expires_before_io_and_hides_network_error_details(monkeypatch: pytest.MonkeyPatch) -> None:
    request = Mock(side_effect=httpx.ConnectError("secret provider token"))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    with pytest.raises(TraceExportError, match="export_deadline_exceeded") as expired:
        TraceProviderHttpClient("https://provider.example", timeout=-1).request("POST")
    assert expired.value.retryable
    request.assert_not_called()
    with pytest.raises(TraceExportError, match="provider_unreachable") as failed:
        TraceProviderHttpClient("https://provider.example").request("POST")
    assert failed.value.retryable
    assert "secret" not in str(failed.value)


def test_otlp_keeps_parent_ids_events_and_captured_fields() -> None:
    trace = make_completed_trace()
    root = trace.spans[0].model_copy(
        update={
            "span_type": "retrieval",
            "status": "error",
            "error": "search failed",
            "attributes": {"timing_source": "observed"},
            "events": (
                {"name": "received", "timestamp": "2026-09-09T08:00:00+00:00", "score": 0.5},
                {"name": "unknown time", "time": "invalid"},
                {"name": "no time", "time": 10},
                {"name": "pause", "observed_at": "2026-09-09T08:00:00+00:00"},
            ),
        }
    )
    parent_trace_id, parent_span_id = str(uuid4()), str(uuid4())
    exported = otlp_span(trace, root, {"trace_id": parent_trace_id, "span_id": parent_span_id})
    assert exported.trace_id == UUID(parent_trace_id).bytes
    assert exported.parent_span_id == span_id_bytes(parent_span_id)
    assert [event.name for event in exported.events] == ["received", "unknown time", "no time", "pause"]
    assert exported.events[0].time_unix_nano == timestamp_ns(root.started_at)
    assert [event.time_unix_nano for event in exported.events[1:3]] == [0, 0]
    assert exported.events[3].time_unix_nano == timestamp_ns(root.started_at)
    attributes = span_attributes(trace, root)
    assert attributes["dify.inputs"] == root.inputs
    assert attributes["dify.outputs"] == root.outputs
    assert attributes["error.message"] == "search failed"
    assert attributes["timing_source"] == "observed"
    assert not any(key.startswith(("gen_ai.", "llm.", "openinference.", "retrieval.")) for key in attributes)
    assert otlp_value((1.5, 2**64, None)).array_value.values[0].double_value == 1.5
    assert otlp_value(2**64).string_value == str(2**64)
    assert otlp_value(None).string_value == "null"
    assert provider_uuid("legacy-span") == provider_uuid("legacy-span")
    assert provider_uuid("legacy-span") != provider_uuid("other-span")


def test_otlp_probes_credentials_and_checks_partial_metric_acceptance(monkeypatch: pytest.MonkeyPatch) -> None:
    client = OtlpTraceClient("https://provider.example/v1/traces", {}, {}, "https://project.example")
    send = Mock(return_value=b"")
    monkeypatch.setattr(client, "_send", send)
    assert client.get_project_url() == "https://project.example"
    assert client.verify_credentials()
    send.assert_called_once_with("trace", b"")
    client.send_metrics([])
    assert send.call_count == 1
    rejected = ExportMetricsServiceResponse()
    rejected.partial_success.rejected_data_points = 1
    send.return_value = rejected.SerializeToString()
    with pytest.raises(TraceExportError, match="provider_rejected_metrics") as failed:
        client.send_metrics([counter("operations", 1, make_completed_trace().spans[0], {})])
    assert not failed.value.retryable


@pytest.mark.parametrize(
    ("value", "bucket_counts"),
    [(0, [1, 0, 0, 0]), (1, [0, 1, 0, 0]), (5, [0, 1, 0, 0]), (10, [0, 0, 1, 0]), (11, [0, 0, 0, 1])],
)
def test_otlp_histogram_preserves_upper_inclusive_buckets(value: float, bucket_counts: list[int]) -> None:
    metric = histogram("duration", value, make_completed_trace().spans[0], {}, explicit_bounds=(0, 5, 10))
    point = metric.histogram.data_points[0]
    assert list(point.explicit_bounds) == [0, 5, 10]
    assert list(point.bucket_counts) == bucket_counts
    assert sum(point.bucket_counts) == point.count == 1
    assert point.sum == point.min == point.max == value


@pytest.mark.parametrize("secure", [True, False])
def test_grpc_sends_through_explicit_proxy_and_closes_its_channel(
    secure: bool, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(SSRF_PROXY_ALL_URL="http://ssrf-proxy:3128")
    monkeypatch.setenv("no_grpc_proxy", ",.unrelated.example,invalid/network")
    channel = MagicMock()
    send = Mock(return_value=b"")
    channel.unary_unary.return_value = send
    secure_channel, insecure_channel = Mock(return_value=channel), Mock(return_value=channel)
    monkeypatch.setattr(grpc, "secure_channel", secure_channel)
    monkeypatch.setattr(grpc, "insecure_channel", insecure_channel)
    endpoint = "https://provider.example" if secure else "http://provider.example:4318"
    client = OtlpTraceClient(endpoint, {"authorization": "tenant-key"}, {}, "", protocol="grpc")
    assert client._send("metrics", b"request") == b""
    chosen, unused = (secure_channel, insecure_channel) if secure else (insecure_channel, secure_channel)
    assert chosen.call_args is not None
    assert chosen.call_args.args[0] == ("provider.example:4317" if secure else "provider.example:4318")
    assert chosen.call_args.kwargs["options"] == [("grpc.http_proxy", "http://ssrf-proxy:3128")]
    unused.assert_not_called()
    channel.unary_unary.assert_called_once_with("/opentelemetry.proto.collector.metrics.v1.MetricsService/Export")
    assert send.call_args is not None
    assert send.call_args.args == (b"request",)
    assert send.call_args.kwargs["metadata"] == (("authorization", "tenant-key"),)
    assert 0 < send.call_args.kwargs["timeout"] <= 30
    channel.__exit__.assert_called_once()


@pytest.mark.parametrize(
    ("endpoint", "bypass"),
    [
        ("https://provider.example", "*"),
        ("https://provider.example", ".provider.example"),
        ("http://10.1.2.3", "10.0.0.0/8"),
    ],
)
def test_grpc_rejects_proxy_bypass_before_opening_channel(
    endpoint: str, bypass: str, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(SSRF_PROXY_ALL_URL="http://ssrf-proxy:3128")
    monkeypatch.delenv("no_grpc_proxy", raising=False)
    monkeypatch.setenv("no_proxy", bypass)
    secure_channel, insecure_channel = Mock(), Mock()
    monkeypatch.setattr(grpc, "secure_channel", secure_channel)
    monkeypatch.setattr(grpc, "insecure_channel", insecure_channel)
    client = OtlpTraceClient(endpoint, {}, {}, "", protocol="grpc")
    with pytest.raises(TraceExportError, match="grpc_proxy_bypass_disabled"):
        client._send("trace", b"")
    secure_channel.assert_not_called()
    insecure_channel.assert_not_called()


@pytest.mark.parametrize("retryable", [True, False])
def test_grpc_errors_follow_provider_retry_policy_and_close_channel(
    retryable: bool, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(SSRF_PROXY_ALL_URL="", SSRF_PROXY_HTTP_URL="", SSRF_PROXY_HTTPS_URL="")
    error = grpc.RpcError()
    monkeypatch.setattr(
        error,
        "code",
        Mock(return_value=grpc.StatusCode.UNAVAILABLE if retryable else grpc.StatusCode.UNAUTHENTICATED),
        raising=False,
    )
    channel = MagicMock()
    channel.unary_unary.return_value = Mock(side_effect=error)
    create_channel = Mock(return_value=channel)
    monkeypatch.setattr(grpc, "secure_channel", create_channel)
    client = OtlpTraceClient("https://provider.example", {}, {}, "", protocol="grpc")
    with pytest.raises(TraceExportError, match="provider_grpc_rejected") as failed:
        client._send("trace", b"")
    assert failed.value.retryable is retryable
    assert create_channel.call_args is not None
    assert create_channel.call_args.kwargs["options"] == [("grpc.enable_http_proxy", 0)]
    channel.__exit__.assert_called_once()


def test_grpc_deadline_expiry_closes_channel_without_sending(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(SSRF_PROXY_ALL_URL="", SSRF_PROXY_HTTP_URL="", SSRF_PROXY_HTTPS_URL="")
    channel = MagicMock()
    send = Mock()
    channel.unary_unary.return_value = send
    monkeypatch.setattr(grpc, "secure_channel", Mock(return_value=channel))
    client = OtlpTraceClient("https://provider.example", {}, {}, "", protocol="grpc")
    client.http.deadline = monotonic() - 1
    with pytest.raises(TraceExportError, match="export_deadline_exceeded") as failed:
        client._send("trace", b"")
    assert failed.value.retryable
    send.assert_not_called()
    channel.__exit__.assert_called_once()


@pytest.mark.parametrize(
    ("span_type", "status", "code"),
    [
        ("workflow", "ok", 1),
        ("workflow", "handled_error", 1),
        ("llm", "handled_error", 2),
        ("llm", "error", 2),
        ("workflow", "cancelled", 0),
        ("llm", "incomplete", 0),
    ],
)
def test_otlp_preserves_unknown_and_handled_business_outcomes(span_type: str, status: str, code: int) -> None:
    trace = make_completed_trace()
    span = trace.spans[0].model_copy(update={"span_type": span_type, "status": status})
    assert otlp_span(trace, span).status.code == code
    exported = otlp_span(trace, span, attributes={"destination.field": "value"})
    assert [(item.key, item.value.string_value) for item in exported.attributes] == [("destination.field", "value")]


@pytest.mark.parametrize(
    "external_id",
    ["d306440561854c3f8ce4be8a8347c123", "d3064405-6185-4c3f-8ce4-be8a8347c123", "business-request", "0" * 32],
)
def test_otlp_external_correlation_and_receipts_use_the_sent_protocol_id(
    external_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    trace = make_completed_trace()
    trace = trace.model_copy(update={"source": trace.source.model_copy(update={"external_trace_id": external_id})})
    client = OtlpTraceClient("https://collector.example/v1/traces", {}, {}, "")
    sent: list[ExportTraceServiceRequest] = []
    monkeypatch.setattr(client, "send_traces", sent.append)
    receipts = client.export_trace(trace)
    expected_id = UUID(external_id) if external_id.startswith("d3064405") else UUID(trace.trace_id)
    spans = sent[-1].resource_spans[0].scope_spans[0].spans
    assert all(span.trace_id == expected_id.bytes for span in spans)
    assert all(receipt["trace_id"] == str(expected_id) for receipt in receipts.spans.values())
    assert not spans[0].parent_span_id
    assert spans[-1].parent_span_id == spans[-2].span_id

    parent_id, parent_span_id = str(uuid4()), str(uuid4())
    attached = client.export_trace(trace, {"trace_id": parent_id, "span_id": parent_span_id})
    attached_spans = sent[-1].resource_spans[0].scope_spans[0].spans
    assert all(span.trace_id == UUID(parent_id).bytes for span in attached_spans)
    assert attached_spans[0].parent_span_id == span_id_bytes(parent_span_id)
    assert all(receipt["trace_id"] == parent_id for receipt in attached.spans.values())
