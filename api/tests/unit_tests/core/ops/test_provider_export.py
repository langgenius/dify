"""Protocol fixtures for complete trees, fixed destinations and synchronous acceptance."""

import json
import os
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from time import monotonic
from typing import Never, TypedDict, Unpack
from unittest.mock import MagicMock, Mock
from uuid import UUID, uuid4

import grpc  # pyrefly: ignore[untyped-import]
import httpx
import pytest
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceRequest,
    ExportMetricsServiceResponse,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient, counter, otlp_span, otlp_value
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
    ("endpoint", "trace_path"),
    [
        ("https://log.aliyuncs.com", "api/v1/traces"),
        ("https://project.cn-heyuan.log.aliyuncs.com", "api/v1/traces"),
        ("https://PROJECT.LOG.ALIYUNCS.COM:443", "api/v1/traces"),
        ("https://evillog.aliyuncs.com", "api/otlp/traces"),
        ("https://log.aliyuncs.com.evil.example", "api/otlp/traces"),
        ("https://evil.example/log.aliyuncs.com", "api/otlp/traces"),
        ("https://evil.example/?host=log.aliyuncs.com", "api/otlp/traces"),
    ],
)
def test_aliyun_trace_path_matches_complete_hostname(endpoint: str, trace_path: str) -> None:
    client = create_provider_client("aliyun", {**provider_config("aliyun"), "endpoint": endpoint})

    assert client.http.endpoint.endswith(f"/adapt_tenant-secret/{trace_path}")


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
        if "ingestion" in url:
            return httpx.Response(207, json={"errors": []})
        if kwargs.get("headers", {}).get("Content-Type") == "application/x-protobuf":
            return httpx.Response(200, content=b"")
        return httpx.Response(200, json={})

    def grpc_request(client: OtlpTraceClient, signal: str, serialized: bytes) -> bytes:
        requests.append(("GRPC", signal, {"content": serialized, "headers": dict(client.http.headers)}))
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
    if provider in {"phoenix", "arize", "aliyun", "tencent", "mlflow"}:
        serialized = requests[0][2]["content"]
        spans = ExportTraceServiceRequest.FromString(serialized).resource_spans[0].scope_spans[0].spans
        assert len(spans) == 3
        assert spans[1].parent_span_id == spans[0].span_id
        assert spans[2].parent_span_id == spans[1].span_id
        assert len({span.trace_id for span in spans}) == 1
        assert spans[0].trace_id == UUID(trace.trace_id).bytes
    elif provider == "langsmith":
        runs: list[dict[str, JsonValue]] = []
        for request in requests[:3]:
            posted = request[2]["json"]["post"]
            assert isinstance(posted, list)
            assert isinstance(posted[0], dict)
            runs.append(posted[0])
        assert runs[2]["parent_run_id"] == runs[1]["id"]
        child_order, parent_order = runs[2]["dotted_order"], runs[1]["dotted_order"]
        assert isinstance(child_order, str)
        assert isinstance(parent_order, str)
        assert child_order.startswith(parent_order + ".")
    elif provider == "langfuse":
        events = requests[0][2]["json"]["batch"]
        assert isinstance(events, list)
        assert len(events) == 4
        child_event, parent_event = events[3], events[2]
        assert isinstance(child_event, dict)
        assert isinstance(parent_event, dict)
        child_body, parent_body = child_event["body"], parent_event["body"]
        assert isinstance(child_body, dict)
        assert isinstance(parent_body, dict)
        assert child_body["parentObservationId"] == parent_body["id"]
    elif provider == "databricks":
        uploaded = json.loads(next(kwargs["content"] for method, _, kwargs in requests if method == "PUT"))
        assert len(uploaded["spans"]) == 3
        assert uploaded["spans"][2]["parent_span_id"] == uploaded["spans"][1]["span_id"]
        assert all("Authorization" not in kwargs["headers"] for method, _, kwargs in requests if method == "PUT")


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


def test_overlapping_exports_keep_credentials_and_parent_order_separate(monkeypatch: pytest.MonkeyPatch) -> None:
    from threading import Barrier

    barrier = Barrier(2)
    sent: list[RequestArguments] = []

    def request(_method: str, _url: str, **kwargs: Unpack[RequestArguments]) -> httpx.Response:
        if not any(item["headers"]["x-api-key"] == kwargs["headers"]["x-api-key"] for item in sent):
            barrier.wait(timeout=5)
        sent.append(kwargs)
        return httpx.Response(202, json={})

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    trace_a, trace_b = make_completed_trace(), make_completed_trace()
    with ThreadPoolExecutor(2) as pool:
        jobs = [
            pool.submit(export_trace, trace, settings_for(trace, "langsmith"), provider_config("langsmith", key))
            for trace, key in ((trace_a, "secret-a"), (trace_b, "secret-b"))
        ]
        assert all(len(job.result().spans) == 3 for job in jobs)
    for request in sent:
        expected_tenant = (
            trace_a.source.tenant_id if request["headers"]["x-api-key"] == "secret-a" else trace_b.source.tenant_id
        )
        posted = request["json"]["post"]
        assert isinstance(posted, list)
        assert isinstance(posted[0], dict)
        extra = posted[0]["extra"]
        assert isinstance(extra, dict)
        metadata = extra["metadata"]
        assert isinstance(metadata, dict)
        assert metadata["dify.tenant_id"] == expected_tenant


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
        create_provider_client("phoenix", provider_config("phoenix")).export_trace(make_completed_trace())


def test_enterprise_metrics_keep_root_and_model_usage_distinct(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[tuple[str, bytes]] = []

    def request(_method: str, url: str, **kwargs: Unpack[RequestArguments]) -> httpx.Response:
        requests.append((url, kwargs["content"]))
        return httpx.Response(200, content=b"")

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    trace = make_completed_trace()
    attempt = trace.spans[-1].model_copy(
        update={
            "span_id": make_span_id(trace.source.tenant_id, trace.source.operation_id, "attempt"),
            "parent_span_id": trace.spans[-1].span_id,
            "attributes": {**trace.spans[-1].attributes, "metrics_from_parent": True},
        }
    )
    trace = trace.model_copy(update={"spans": (*trace.spans, attempt)})
    create_provider_client(
        "enterprise",
        {
            "endpoint": "https://enterprise.example",
            "protocol": "http/protobuf",
            "include_content": False,
            "sampling_rate": 1,
        },
    ).export_trace(trace)
    metrics = ExportMetricsServiceRequest.FromString(requests[-1][1]).resource_metrics[0].scope_metrics[0].metrics
    totals = [metric for metric in metrics if metric.name == "dify.tokens.total"]
    assert len(totals) == 2
    assert {
        next(
            attribute.value.string_value
            for attribute in metric.sum.data_points[0].attributes
            if attribute.key == "operation_type"
        )
        for metric in totals
    } == {"workflow", "node_execution"}
    assert all(metric.sum.data_points[0].as_int == 8 for metric in totals)
    spans = ExportTraceServiceRequest.FromString(requests[0][1]).resource_spans[0].scope_spans[0].spans
    assert len(spans) == 4
    assert spans[-1].parent_span_id == spans[-2].span_id
    for span in spans:
        inputs = next(attribute.value.string_value for attribute in span.attributes if attribute.key == "input.value")
        assert inputs.startswith("ref:operation_id=")


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


def test_provider_optional_credentials_do_not_call_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
    encrypt = Mock()
    decrypt = Mock()
    monkeypatch.setattr("core.helper.encrypter.encrypt_token", encrypt)
    monkeypatch.setattr("core.helper.encrypter.batch_decrypt_token", decrypt)
    settings = {"tracking_uri": "https://mlflow.example", "experiment_id": "1"}
    saved = encrypt_provider_config(str(uuid4()), "mlflow", settings)
    assert saved["password"] is None
    assert mask_provider_config("mlflow", saved) == saved
    assert decrypt_provider_config(str(uuid4()), "mlflow", saved) == saved
    encrypt.assert_not_called()
    decrypt.assert_not_called()
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


def test_otlp_keeps_parent_ids_events_and_retrieval_details() -> None:
    trace = make_completed_trace()
    root = trace.spans[0].model_copy(
        update={
            "span_type": "retrieval",
            "status": "error",
            "error": "search failed",
            "attributes": {"gen_ai_server_time_to_first_token": 0.25},
            "events": (
                {"name": "received", "timestamp": "2026-09-09T08:00:00+00:00", "score": 0.5},
                {"name": "unknown time", "time": "invalid"},
                {"name": "no time", "time": 10},
            ),
        }
    )
    parent_trace_id, parent_span_id = str(uuid4()), str(uuid4())
    exported = otlp_span(trace, root, {"trace_id": parent_trace_id, "span_id": parent_span_id})
    assert exported.trace_id == UUID(parent_trace_id).bytes
    assert exported.parent_span_id == span_id_bytes(parent_span_id)
    assert [event.name for event in exported.events] == ["received", "unknown time", "no time"]
    assert exported.events[0].time_unix_nano == timestamp_ns(root.started_at)
    assert [event.time_unix_nano for event in exported.events[1:]] == [0, 0]
    attributes = span_attributes(trace, root)
    assert attributes["retrieval.query"] == json.dumps(root.inputs, separators=(",", ":"))
    assert attributes["retrieval.document"] == json.dumps(root.outputs, separators=(",", ":"))
    assert attributes["error.message"] == "search failed"
    assert attributes["gen_ai.response.time_to_first_token"] == 250_000_000
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


def test_tencent_metrics_skip_unknown_measurements_and_preserve_stream_times() -> None:
    trace = make_completed_trace()
    model = trace.spans[-1].model_copy(
        update={
            "started_at": None,
            "ended_at": None,
            "usage": {"prompt_tokens": "unknown", "completion_tokens": 3},
            "attributes": {"gen_ai.server.time_to_first_token": 0.25, "gen_ai.streaming.time_to_generate": 0.5},
        }
    )
    trace = trace.model_copy(update={"spans": (*trace.spans[:-1], model)})
    client = OtlpTraceClient("https://provider.example", {}, {}, "", tencent_metrics=True)
    metrics = client._tencent_metrics(trace)
    assert [metric.name for metric in metrics] == [
        "gen_ai.trace.duration",
        "gen_ai.client.token.usage",
        "gen_ai.server.time_to_first_token",
        "gen_ai.streaming.time_to_generate",
    ]
    assert [metric.histogram.data_points[0].sum for metric in metrics] == [2, 3, 0.25, 0.5]
