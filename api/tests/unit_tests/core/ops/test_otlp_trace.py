"""OTLP batching preserves complete recordings and each export attempt's transport policy."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, Mock
from uuid import uuid4

import grpc  # pyrefly: ignore[untyped-import]
import httpx
import pytest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2_grpc import add_TraceServiceServicer_to_server
from opentelemetry.proto.common.v1.common_pb2 import InstrumentationScope
from opentelemetry.proto.resource.v1.resource_pb2 import Resource
from opentelemetry.proto.trace.v1.trace_pb2 import ResourceSpans, ScopeSpans, Span

from core.ops.otlp_trace import OtlpTraceClient, limit_span_attributes, otlp_attributes
from core.ops.provider_export import TraceExportError, TraceProviderHttpClient
from core.ops.trace_data import CompletedTrace, TraceSource
from core.ops.workflow_trace import WorkflowTraceRecorder
from graphon.engine_events import GraphRunSucceededEvent, NodeRunStartedEvent, NodeRunSucceededEvent
from graphon.node_events import NodeRunResult
from tests.unit_tests.core.ops.test_workflow_trace_limits import workflow_node


def test_explicit_attribute_limits_preserve_nested_otlp_values_and_count_drops() -> None:
    attributes = {
        "first": "oldest",
        "nested": ["abcdefgh", 42, {"deep": "αβγδε", "enabled": True}, [1.5, "longtext"]],
        "last": "last value",
    }
    span = Span(attributes=otlp_attributes(attributes), dropped_attributes_count=4)

    assert limit_span_attributes(span, max_attributes=2, max_value_length=3) is span

    assert span.attributes == otlp_attributes(
        {"nested": ["abc", 42, {"deep": "αβγ", "enabled": True}, [1.5, "lon"]], "last": "las"}
    )
    assert span.dropped_attributes_count == 5
    assert attributes["last"] == "last value"
    span.attributes[0].value.array_value.values.add()
    limit_span_attributes(span, max_value_length=0)
    assert span.attributes[0].value.array_value.values[0].string_value == ""
    assert span.attributes[0].value.array_value.values[-1].WhichOneof("value") is None
    assert span.attributes[1].value.string_value == ""
    limit_span_attributes(span, max_attributes=0)
    assert not span.attributes
    assert span.dropped_attributes_count == 7


def test_omitted_attribute_limits_preserve_the_complete_protocol_message() -> None:
    span = Span(attributes=otlp_attributes({f"field-{index}": "full value" for index in range(160)}))
    before = span.SerializeToString()

    limit_span_attributes(span)

    assert span.SerializeToString() == before


@pytest.mark.parametrize("limits", [{"max_attributes": -1}, {"max_value_length": -1}])
def test_negative_attribute_limits_fail_before_changing_the_span(limits: dict[str, int]) -> None:
    span = Span(attributes=otlp_attributes({"field": "value"}))
    before = span.SerializeToString()
    with pytest.raises(ValueError, match="must be non-negative"):
        limit_span_attributes(span, **limits)
    assert span.SerializeToString() == before


def make_trace_request(span_count: int = 5, text_size: int = 2_000_000) -> ExportTraceServiceRequest:
    trace_id = uuid4().bytes
    return ExportTraceServiceRequest(
        resource_spans=[
            ResourceSpans(
                resource=Resource(attributes=otlp_attributes({"tenant.id": "tenant"})),
                scope_spans=[
                    ScopeSpans(
                        scope=InstrumentationScope(name="recorder", version="1"),
                        spans=[
                            Span(
                                trace_id=trace_id,
                                span_id=(index + 1).to_bytes(8),
                                parent_span_id=index.to_bytes(8) if index else b"",
                                name=f"span-{index}",
                                attributes=otlp_attributes({"input": "x" * text_size}),
                            )
                            for index in range(span_count)
                        ],
                    )
                ],
            )
        ]
    )


def span_records(request: ExportTraceServiceRequest) -> list[tuple[Resource, str, InstrumentationScope, str, Span]]:
    return [
        (resource.resource, resource.schema_url, scope.scope, scope.schema_url, span)
        for resource in request.resource_spans
        for scope in resource.scope_spans
        for span in scope.spans
    ]


@pytest.mark.parametrize("bypass_setting", ["no_grpc_proxy", "no_proxy"])
def test_complete_workflow_recording_reaches_default_grpc_receiver(
    bypass_setting: str, config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> None:
    config_overrides(SSRF_PROXY_ALL_URL="", SSRF_PROXY_HTTP_URL="", SSRF_PROXY_HTTPS_URL="")
    monkeypatch.setenv("grpc_proxy", "http://unused.invalid:3128")
    monkeypatch.delenv("no_grpc_proxy", raising=False)
    monkeypatch.setenv(bypass_setting, "127.0.0.1")
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    submitted: list[CompletedTrace] = []

    def submit(trace: CompletedTrace) -> bool:
        submitted.append(trace)
        return True

    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=submit,
    )
    started_at = datetime(2026, 9, 9, tzinfo=UTC)
    for index in range(180):
        node = workflow_node(source)
        node.id = f"node-{index}"
        with recorder.node_run_context(node):
            recorder.record_workflow_event(
                NodeRunStartedEvent(
                    id=node.execution_id,
                    node_id=node.id,
                    node_type="code",
                    node_title=node.title,
                    start_at=started_at,
                )
            )
            recorder.record_workflow_event(
                NodeRunSucceededEvent(
                    id=node.execution_id,
                    node_id=node.id,
                    node_type="code",
                    start_at=started_at,
                    finished_at=started_at + timedelta(seconds=1),
                    node_run_result=NodeRunResult(inputs={"text": "a" * 12_000}, outputs={"text": "b" * 12_000}),
                )
            )
    recorder.record_workflow_event(GraphRunSucceededEvent(outputs={}))
    assert recorder.finish_workflow_trace()
    trace = submitted[0]
    canonical_recording = trace.model_dump_json()
    assert trace.complete
    assert len(trace.spans) == 181
    assert len(canonical_recording.encode()) < 8 * 1024 * 1024

    received: list[ExportTraceServiceRequest] = []
    credentials: list[dict[str, str | bytes]] = []

    class TraceReceiver:
        def Export(  # noqa: N802 -- OTLP defines the gRPC service method name.
            self, request: ExportTraceServiceRequest, context: grpc.ServicerContext
        ) -> ExportTraceServiceResponse:
            received.append(request)
            credentials.append(dict(context.invocation_metadata()))
            return ExportTraceServiceResponse()

    with ThreadPoolExecutor(max_workers=1) as executor:
        server = grpc.server(executor)
        add_TraceServiceServicer_to_server(TraceReceiver(), server)
        port = server.add_insecure_port("127.0.0.1:0")
        server.start()
        try:
            client = OtlpTraceClient(
                f"http://127.0.0.1:{port}",
                {"authorization": "tenant-key"},
                {"tenant.id": source.tenant_id},
                "",
                protocol="grpc",
            )
            projected_spans = [client.build_span(trace, span) for span in trace.spans]
            full_request = ExportTraceServiceRequest(
                resource_spans=[
                    ResourceSpans(
                        resource=client.resource,
                        scope_spans=[ScopeSpans(scope=InstrumentationScope(name="dify.ops"), spans=projected_spans)],
                    )
                ]
            )
            assert full_request.ByteSize() > 4 * 1024 * 1024
            receipts = client.export_trace(trace)
        finally:
            server.stop(grace=0).wait(timeout=5)

    assert len(received) > 1
    assert all(request.ByteSize() <= 4 * 1024 * 1024 for request in received)
    assert all(headers["authorization"] == "tenant-key" for headers in credentials)
    assert [record for request in received for record in span_records(request)] == span_records(full_request)
    assert set(receipts.spans) == {span.span_id for span in trace.spans}
    assert trace.model_dump_json() == canonical_recording


def test_http_batches_include_resource_and_scope_metadata_without_mutating_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = make_trace_request(span_count=3, text_size=1_300_000)
    resource = request.resource_spans[0]
    resource.schema_url = "https://schema.example/resource"
    resource.resource.attributes.extend(otlp_attributes({"resource.detail": "r" * 250_000}))
    resource.resource.dropped_attributes_count = 2
    scope = resource.scope_spans[0]
    scope.schema_url = "https://schema.example/scope"
    scope.scope.attributes.extend(otlp_attributes({"scope.detail": "s" * 50_000}))
    scope.scope.dropped_attributes_count = 3
    resource.scope_spans.add().CopyFrom(ScopeSpans(scope=InstrumentationScope(name="empty-scope")))
    other_resource = request.resource_spans.add()
    other_resource.CopyFrom(make_trace_request(span_count=2, text_size=100).resource_spans[0])
    other_resource.resource.attributes.extend(otlp_attributes({"tenant.id": "other-tenant"}))
    request.resource_spans.add().CopyFrom(ResourceSpans(resource=Resource(dropped_attributes_count=4)))
    original = request.SerializeToString()
    assert len(original) > 4 * 1024 * 1024
    send = Mock(return_value=httpx.Response(200, content=b""))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", send)
    client = OtlpTraceClient("https://collector.example/custom/traces", {"authorization": "tenant-key"}, {}, "")

    client.send_traces(request)

    batches = [ExportTraceServiceRequest.FromString(call.kwargs["content"]) for call in send.call_args_list]
    assert len(batches) > 1
    assert all(batch.ByteSize() <= 4 * 1024 * 1024 for batch in batches)
    assert [record for batch in batches for record in span_records(batch)] == span_records(request)
    assert any(
        resource.scope_spans[1] == sent_scope
        for batch in batches
        for sent_resource in batch.resource_spans
        for sent_scope in sent_resource.scope_spans
    )
    assert batches[-1].resource_spans[0] == request.resource_spans[-1]
    assert request.SerializeToString() == original
    for call in send.call_args_list:
        assert call.args == ("POST", "https://collector.example/custom/traces")
        assert call.kwargs["headers"] == {
            "authorization": "tenant-key",
            "Content-Type": "application/x-protobuf",
        }
        assert call.kwargs["max_retries"] == 0
        assert call.kwargs["follow_redirects"] is False
        assert 0 < call.kwargs["timeout"] <= 30


def test_http_preserves_single_spans_larger_than_default_grpc_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    request = make_trace_request(span_count=1, text_size=4 * 1024 * 1024)
    request.resource_spans[0].scope_spans[0].spans.extend(
        make_trace_request(2, 100).resource_spans[0].scope_spans[0].spans
    )
    send = Mock(return_value=httpx.Response(200, content=b""))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", send)
    client = OtlpTraceClient("https://collector.example/v1/traces", {}, {}, "")

    client.send_traces(request)

    batches = [ExportTraceServiceRequest.FromString(call.kwargs["content"]) for call in send.call_args_list]
    assert len(batches) == 2
    assert batches[0].ByteSize() > 4 * 1024 * 1024
    assert len(span_records(batches[0])) == 1
    assert batches[1].ByteSize() <= 4 * 1024 * 1024
    assert [record for batch in batches for record in span_records(batch)] == span_records(request)


@pytest.mark.parametrize("partial_rejection", [True, False])
def test_http_stops_batches_on_provider_rejection(partial_rejection: bool, monkeypatch: pytest.MonkeyPatch) -> None:
    rejected = ExportTraceServiceResponse()
    rejected.partial_success.rejected_spans = 1
    response = (
        httpx.Response(200, content=rejected.SerializeToString())
        if partial_rejection
        else httpx.Response(429, headers={"Retry-After": "10"})
    )
    send = Mock(side_effect=[httpx.Response(200, content=b""), response])
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", send)
    client = OtlpTraceClient("https://collector.example/v1/traces", {}, {}, "")

    with pytest.raises(
        TraceExportError, match="provider_rejected_spans" if partial_rejection else "provider_http_429"
    ) as failed:
        client.send_traces(make_trace_request())

    assert send.call_count == 2
    assert failed.value.retryable is not partial_rejection
    assert failed.value.retry_after == (None if partial_rejection else 10)


def test_http_batches_share_one_export_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    client = OtlpTraceClient("https://collector.example/v1/traces", {}, {}, "")
    client.http.deadline = 10
    monkeypatch.setattr("core.ops.provider_export.monotonic", Mock(side_effect=[9.0, 11.0]))
    send = Mock(return_value=httpx.Response(200, content=b""))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", send)

    with pytest.raises(TraceExportError, match="export_deadline_exceeded") as failed:
        client.send_traces(make_trace_request())

    assert failed.value.retryable
    assert client.http.deadline == 10
    assert send.call_count == 1
    assert send.call_args is not None
    assert send.call_args.kwargs["timeout"] == 1


@pytest.mark.parametrize("remaining", [100.0, 7.0, 0.0])
@pytest.mark.parametrize("trace_timeout", [60.0, float("nan"), float("inf")])
@pytest.mark.parametrize(
    ("protocol", "separate_metrics"), [("http/protobuf", False), ("http/protobuf", True), ("grpc", True)]
)
def test_signal_timeouts_share_one_export_deadline(
    protocol: str,
    separate_metrics: bool,
    remaining: float,
    trace_timeout: float,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(SSRF_PROXY_ALL_URL="", SSRF_PROXY_HTTP_URL="", SSRF_PROXY_HTTPS_URL="")
    clock = Mock(return_value=0.0)
    monkeypatch.setattr("core.ops.provider_export.monotonic", clock)
    monkeypatch.setattr("core.ops.otlp_trace.monotonic", clock)
    metrics_client = (
        TraceProviderHttpClient("https://collector.example/metrics", {}, request_timeout=70)
        if separate_metrics
        else None
    )
    client = OtlpTraceClient(
        "https://collector.example/traces",
        {},
        {},
        "",
        protocol=protocol,
        request_timeout=trace_timeout,
        metrics_http=metrics_client,
    )
    if metrics_client is not None:
        metrics_client.deadline = 1_000
    if protocol == "grpc":
        send = Mock(return_value=b"")
        channel = MagicMock()
        channel.unary_unary.return_value = send
        monkeypatch.setattr(grpc, "secure_channel", Mock(return_value=channel))
    else:
        send = Mock(return_value=httpx.Response(200, content=b""))
        monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", send)
    clock.return_value = 100 - remaining

    for signal, request_timeout in (("trace", trace_timeout), ("metrics", 70 if separate_metrics else trace_timeout)):
        if remaining == 0:
            with pytest.raises(TraceExportError, match="export_deadline_exceeded"):
                client._send(signal, b"")
            send.assert_not_called()
        else:
            assert client._send(signal, b"") == b""
            assert send.call_args.kwargs["timeout"] == min(remaining, request_timeout)

    assert client.http.deadline == 100
    if metrics_client is not None:
        assert metrics_client.deadline == client.http.deadline
