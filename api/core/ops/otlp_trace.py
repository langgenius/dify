"""Build deterministic OTLP messages without a global tracer or SDK span queue."""

import os
from datetime import datetime
from ipaddress import ip_address, ip_network
from time import monotonic
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceRequest,
    ExportMetricsServiceResponse,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from opentelemetry.proto.common.v1.common_pb2 import AnyValue, ArrayValue, InstrumentationScope, KeyValue, KeyValueList
from opentelemetry.proto.metrics.v1.metrics_pb2 import (
    AggregationTemporality,
    Histogram,
    HistogramDataPoint,
    Metric,
    NumberDataPoint,
    ResourceMetrics,
    ScopeMetrics,
    Sum,
)
from opentelemetry.proto.resource.v1.resource_pb2 import Resource
from opentelemetry.proto.trace.v1.trace_pb2 import ResourceSpans, ScopeSpans, Span, Status
from pydantic import JsonValue

from core.ops.provider_export import (
    TraceExportError,
    TraceProviderHttpClient,
    export_span_id,
    json_text,
    provider_uuid,
    span_attributes,
    span_id_bytes,
    timestamp_ns,
)
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceSpan


def otlp_value(value: Any) -> AnyValue:
    match value:
        case bool():
            return AnyValue(bool_value=value)
        case int() if -(2**63) <= value < 2**63:
            return AnyValue(int_value=value)
        case float():
            return AnyValue(double_value=value)
        case str():
            return AnyValue(string_value=value)
        case dict():
            return AnyValue(kvlist_value=KeyValueList(values=otlp_attributes(value)))
        case list() | tuple():
            return AnyValue(array_value=ArrayValue(values=[otlp_value(item) for item in value]))
        case _:
            return AnyValue(string_value=json_text(value))


def otlp_attributes(attributes: dict[str, Any]) -> list[KeyValue]:
    return [KeyValue(key=key, value=otlp_value(value)) for key, value in attributes.items() if value is not None]


def otlp_span(
    completed_trace: CompletedTrace, span: TraceSpan, parent_span: dict[str, JsonValue] | None = None
) -> Span:
    trace_id = str(parent_span["trace_id"]) if parent_span else provider_uuid(completed_trace.trace_id)
    parent_id = export_span_id(completed_trace, span.parent_span_id) if span.parent_span_id else None
    if span.span_id == completed_trace.root_span_id and parent_span:
        parent_id = str(parent_span["span_id"])
    events: list[Span.Event] = []
    for event in span.events:
        occurred_at = event.get("timestamp") or event.get("time")
        try:
            event_time = datetime.fromisoformat(occurred_at) if isinstance(occurred_at, str) else None
        except ValueError:
            event_time = None
        events.append(
            Span.Event(
                name=str(event.get("name", "execution")),
                time_unix_nano=timestamp_ns(event_time),
                attributes=otlp_attributes(event),
            )
        )
    return Span(
        trace_id=UUID(trace_id).bytes,
        span_id=span_id_bytes(export_span_id(completed_trace, span.span_id)),
        parent_span_id=span_id_bytes(parent_id) if parent_id else b"",
        name=span.span_name,
        kind=Span.SPAN_KIND_INTERNAL,
        start_time_unix_nano=timestamp_ns(span.started_at),
        end_time_unix_nano=timestamp_ns(span.ended_at),
        attributes=otlp_attributes(span_attributes(completed_trace, span)),
        status=Status(
            code=Status.STATUS_CODE_ERROR if span.status == "error" else Status.STATUS_CODE_OK, message=span.error or ""
        ),
        events=events,
        flags=1,
    )


def histogram(name: str, value: float, span: TraceSpan, attributes: dict[str, Any], unit: str = "s") -> Metric:
    return Metric(
        name=name,
        unit=unit,
        histogram=Histogram(
            aggregation_temporality=AggregationTemporality.AGGREGATION_TEMPORALITY_DELTA,
            data_points=[
                HistogramDataPoint(
                    attributes=otlp_attributes(attributes),
                    start_time_unix_nano=timestamp_ns(span.started_at),
                    time_unix_nano=timestamp_ns(span.ended_at),
                    count=1,
                    sum=value,
                    min=value,
                    max=value,
                )
            ],
        ),
    )


def counter(name: str, value: int, span: TraceSpan, attributes: dict[str, Any]) -> Metric:
    return Metric(
        name=name,
        sum=Sum(
            aggregation_temporality=AggregationTemporality.AGGREGATION_TEMPORALITY_DELTA,
            is_monotonic=True,
            data_points=[
                NumberDataPoint(
                    attributes=otlp_attributes(attributes),
                    start_time_unix_nano=timestamp_ns(span.started_at),
                    time_unix_nano=timestamp_ns(span.ended_at),
                    as_int=value,
                )
            ],
        ),
    )


class OtlpTraceClient:
    def __init__(
        self,
        endpoint: str,
        headers: dict[str, str],
        resource_attributes: dict[str, Any],
        project_url: str,
        *,
        protocol: str = "http/protobuf",
        tencent_metrics: bool = False,
    ):
        self.http = TraceProviderHttpClient(endpoint, headers)
        self.resource = Resource(attributes=otlp_attributes(resource_attributes))
        self.project_url = project_url
        self.protocol = protocol
        self.tencent_metrics = tencent_metrics

    def get_project_url(self) -> str:
        return self.project_url

    def verify_credentials(self) -> bool:
        self.send_traces(ExportTraceServiceRequest())
        return True

    def send_traces(self, trace_request: ExportTraceServiceRequest) -> None:
        response = self._send("trace", trace_request.SerializeToString())
        accepted = ExportTraceServiceResponse.FromString(response)
        if accepted.partial_success.rejected_spans:
            raise TraceExportError("provider_rejected_spans")

    def send_metrics(self, metrics: list[Metric]) -> None:
        if not metrics:
            return
        request = ExportMetricsServiceRequest(
            resource_metrics=[
                ResourceMetrics(
                    resource=self.resource,
                    scope_metrics=[ScopeMetrics(scope=InstrumentationScope(name="dify.ops"), metrics=metrics)],
                )
            ]
        )
        response = self._send("metrics", request.SerializeToString())
        accepted = ExportMetricsServiceResponse.FromString(response)
        if accepted.partial_success.rejected_data_points:
            raise TraceExportError("provider_rejected_metrics")

    def _send(self, signal: str, serialized: bytes) -> bytes:
        if self.protocol == "grpc":
            return self._send_grpc(signal, serialized)
        endpoint = self.http.endpoint
        if signal == "metrics":
            endpoint = endpoint.rsplit("/", 1)[0] + "/metrics"
        client = self.http if endpoint == self.http.endpoint else TraceProviderHttpClient(endpoint, self.http.headers)
        client.deadline = self.http.deadline
        response = client.request("POST", content=serialized, headers={"Content-Type": "application/x-protobuf"})
        return response.content

    def _remaining_seconds(self) -> float:
        remaining = self.http.deadline - monotonic()
        if remaining <= 0:
            raise TraceExportError("export_deadline_exceeded", retryable=True)
        return min(30.0, remaining)

    def _send_grpc(self, signal: str, serialized: bytes) -> bytes:
        import grpc  # pyrefly: ignore[untyped-import]

        from configs import dify_config

        endpoint = urlsplit(self.http.endpoint)
        target = endpoint.netloc if endpoint.port else f"{endpoint.hostname}:4317"
        # gRPC supports an explicit HTTP CONNECT proxy option. Use Dify's SSRF
        # proxy policy instead of inheriting a user's process proxy environment.
        proxy = dify_config.SSRF_PROXY_ALL_URL or (
            dify_config.SSRF_PROXY_HTTPS_URL if endpoint.scheme == "https" else dify_config.SSRF_PROXY_HTTP_URL
        )
        if proxy:
            bypass_hosts = os.environ.get("no_grpc_proxy", os.environ.get("no_proxy", ""))  # noqa: SIM112 -- gRPC names are lowercase
            for entry in bypass_hosts.split(","):
                entry = entry.strip().lstrip(".")
                if not entry:
                    continue
                host = endpoint.hostname or ""
                matches = entry == "*" or host.endswith(entry)
                if "/" in entry:
                    try:
                        matches = ip_address(host) in ip_network(entry, strict=False)
                    except ValueError:
                        pass
                if matches:
                    raise TraceExportError("grpc_proxy_bypass_disabled")
        options = [("grpc.http_proxy", proxy)] if proxy else [("grpc.enable_http_proxy", 0)]
        channel = (
            grpc.secure_channel(target, grpc.ssl_channel_credentials(), options=options)
            if endpoint.scheme == "https"
            else grpc.insecure_channel(target, options=options)
        )
        service = "TraceService" if signal == "trace" else "MetricsService"
        try:
            with channel:
                send = channel.unary_unary(f"/opentelemetry.proto.collector.{signal}.v1.{service}/Export")
                return send(serialized, timeout=self._remaining_seconds(), metadata=tuple(self.http.headers.items()))
        except grpc.RpcError as error:
            raise TraceExportError(
                "provider_grpc_rejected",
                retryable=error.code()
                in {
                    grpc.StatusCode.UNAVAILABLE,
                    grpc.StatusCode.DEADLINE_EXCEEDED,
                    grpc.StatusCode.RESOURCE_EXHAUSTED,
                },
            ) from None

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        spans = [otlp_span(completed_trace, span, parent_span) for span in completed_trace.spans]
        if self.tencent_metrics:
            for exported_span, span in zip(spans, completed_trace.spans, strict=True):
                for attribute in exported_span.attributes:
                    if attribute.key == "gen_ai.span.kind":
                        attribute.value.string_value = {
                            "llm": "GENERATION",
                            "workflow": "WORKFLOW",
                            "operation": "WORKFLOW",
                        }.get(span.span_type, attribute.value.string_value)
                exported_span.attributes.extend(
                    otlp_attributes(
                        {
                            "gen_ai.is_entry": "true" if span.span_id == completed_trace.root_span_id else "false",
                            "gen_ai.entity.input": json_text(span.inputs),
                            "gen_ai.entity.output": json_text(span.outputs),
                        }
                    )
                )
        self.send_traces(
            ExportTraceServiceRequest(
                resource_spans=[
                    ResourceSpans(
                        resource=self.resource,
                        scope_spans=[ScopeSpans(scope=InstrumentationScope(name="dify.ops"), spans=spans)],
                    )
                ]
            )
        )
        if self.tencent_metrics:
            self.send_metrics(self._tencent_metrics(completed_trace))
        return ExportedParentSpans(
            spans={
                span.span_id: {
                    "trace_id": str(parent_span["trace_id"])
                    if parent_span
                    else provider_uuid(completed_trace.trace_id),
                    "span_id": export_span_id(completed_trace, span.span_id),
                }
                for span in completed_trace.spans
            }
        )

    def _tencent_metrics(self, completed_trace: CompletedTrace) -> list[Metric]:
        metrics: list[Metric] = []
        for span in completed_trace.spans:
            labels = {
                "gen_ai.operation.name": span.attributes.get("operation_type", span.span_type),
                "gen_ai.system": span.attributes.get("model_provider", ""),
                "gen_ai.request.model": span.attributes.get("model_name", ""),
                "gen_ai.response.model": span.attributes.get("model_name", ""),
                "dify.tenant_id": completed_trace.source.tenant_id,
                "dify.app_id": completed_trace.source.app_id or "",
            }
            if span.started_at and span.ended_at:
                seconds = (span.ended_at - span.started_at).total_seconds()
                if span.span_id == completed_trace.root_span_id:
                    metrics.append(histogram("gen_ai.trace.duration", seconds, span, labels))
                if span.span_type == "llm":
                    metrics.append(histogram("gen_ai.client.operation.duration", seconds, span, labels))
            if span.span_type == "llm":
                for field, token_type in (("prompt_tokens", "input"), ("completion_tokens", "output")):
                    if isinstance(tokens := span.usage.get(field), (int, float)):
                        metrics.append(
                            histogram(
                                "gen_ai.client.token.usage",
                                float(tokens),
                                span,
                                {**labels, "gen_ai.token.type": token_type},
                                "token",
                            )
                        )
                for field in ("gen_ai.server.time_to_first_token", "gen_ai.streaming.time_to_generate"):
                    if isinstance(streaming_seconds := span.attributes.get(field), (int, float)):
                        metrics.append(histogram(field, float(streaming_seconds), span, labels))
        return metrics
