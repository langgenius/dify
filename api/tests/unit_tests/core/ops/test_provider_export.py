"""Protocol fixtures for complete trees, fixed destinations and synchronous acceptance."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Never, TypedDict, Unpack
from uuid import UUID, uuid4

import httpx
import pytest
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import ExportMetricsServiceRequest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient
from core.ops.provider_export import TraceExportError, TraceProviderHttpClient, create_provider_client, export_trace
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
