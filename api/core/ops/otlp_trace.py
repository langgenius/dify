"""Build deterministic OTLP messages without a global tracer or SDK span queue."""

from __future__ import annotations

import os
from bisect import bisect_left
from collections.abc import Iterator, Mapping, Sequence
from datetime import datetime
from ipaddress import ip_address, ip_network
from ssl import SSLContext
from time import monotonic
from typing import TYPE_CHECKING, Any
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

if TYPE_CHECKING:
    from core.ops.trace_export_state import TraceExportState


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


def otlp_trace_id(completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None) -> str:
    """Use protocol-valid external correlation; an explicitly attached parent takes precedence."""
    if parent_span:
        return str(UUID(str(parent_span["trace_id"])))
    if completed_trace.source.external_trace_id:
        try:
            external_id = UUID(completed_trace.source.external_trace_id)
            if external_id.int:
                return str(external_id)
        except ValueError:
            pass
    return provider_uuid(completed_trace.trace_id)


def otlp_span(
    completed_trace: CompletedTrace,
    span: TraceSpan,
    parent_span: dict[str, JsonValue] | None = None,
    *,
    attributes: Mapping[str, Any] | None = None,
) -> Span:
    trace_id = otlp_trace_id(completed_trace, parent_span)
    parent_id = export_span_id(completed_trace, span.parent_span_id) if span.parent_span_id else None
    if span.span_id == completed_trace.root_span_id and parent_span:
        parent_id = str(parent_span["span_id"])
    events: list[Span.Event] = []
    for event in span.events:
        occurred_at = event.get("timestamp") or event.get("time") or event.get("observed_at")
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
        attributes=otlp_attributes(
            dict(attributes) if attributes is not None else span_attributes(completed_trace, span)
        ),
        status=Status(
            code=(
                Status.STATUS_CODE_ERROR
                if span.status == "error" or (span.status == "handled_error" and span.span_type != "workflow")
                else Status.STATUS_CODE_OK
                if span.status in {"ok", "handled_error"}
                else Status.STATUS_CODE_UNSET
            ),
            message=span.error or "",
        ),
        events=events,
        flags=1,
    )


def histogram(
    name: str,
    value: float,
    span: TraceSpan,
    attributes: dict[str, Any],
    unit: str = "s",
    *,
    explicit_bounds: Sequence[float],
) -> Metric:
    """Encode one delta observation in the destination's upper-inclusive buckets."""
    bucket_counts = [0] * (len(explicit_bounds) + 1)
    bucket_counts[bisect_left(explicit_bounds, value)] = 1
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
                    explicit_bounds=explicit_bounds,
                    bucket_counts=bucket_counts,
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


def _length_delimited_size(size: int) -> int:
    """Include a one-byte protobuf field tag and its variable-length size prefix."""
    return 1 + max(1, (size.bit_length() + 6) // 7) + size


def _trace_request_batches(trace_request: ExportTraceServiceRequest) -> Iterator[ExportTraceServiceRequest]:
    """Fit multi-span requests in the default gRPC receive limit without changing spans."""
    max_request_bytes = 4 * 1024 * 1024
    if trace_request.ByteSize() <= max_request_bytes or not trace_request.resource_spans:
        yield trace_request
        return

    request_metadata = ExportTraceServiceRequest()
    request_metadata.CopyFrom(trace_request)
    request_metadata.ClearField("resource_spans")
    request_metadata_size = request_metadata.ByteSize()
    for resource_spans in trace_request.resource_spans:
        resource_request = ExportTraceServiceRequest()
        resource_request.CopyFrom(request_metadata)
        resource_metadata = resource_request.resource_spans.add()
        resource_metadata.CopyFrom(resource_spans)
        resource_metadata.ClearField("scope_spans")
        if not resource_spans.scope_spans:
            yield resource_request
            continue
        resource_size = resource_metadata.ByteSize()
        for scope_spans in resource_spans.scope_spans:
            empty_batch = ExportTraceServiceRequest()
            empty_batch.CopyFrom(resource_request)
            scope_metadata = empty_batch.resource_spans[0].scope_spans.add()
            scope_metadata.CopyFrom(scope_spans)
            scope_metadata.ClearField("spans")
            scope_size = scope_metadata.ByteSize()
            batch = ExportTraceServiceRequest()
            batch.CopyFrom(empty_batch)
            batch_spans = batch.resource_spans[0].scope_spans[0].spans
            spans_size = 0
            for span in scope_spans.spans:
                span_size = _length_delimited_size(span.ByteSize())
                request_size = request_metadata_size + _length_delimited_size(
                    resource_size + _length_delimited_size(scope_size + spans_size + span_size)
                )
                if batch_spans and request_size > max_request_bytes:
                    yield batch
                    batch = ExportTraceServiceRequest()
                    batch.CopyFrom(empty_batch)
                    batch_spans = batch.resource_spans[0].scope_spans[0].spans
                    spans_size = 0
                # A single large span remains eligible for receivers configured with a higher limit.
                batch_spans.append(span)
                spans_size += span_size
            yield batch


class OtlpTraceClient:
    def __init__(
        self,
        endpoint: str,
        headers: dict[str, str],
        resource_attributes: dict[str, Any],
        project_url: str,
        *,
        protocol: str = "http/protobuf",
        request_timeout: float = 30,
        ssl_context: SSLContext | None = None,
        metrics_http: TraceProviderHttpClient | None = None,
        metrics_protocol: str | None = None,
        grpc_credentials: Mapping[str, Any] | None = None,
    ):
        self.http = TraceProviderHttpClient(endpoint, headers, request_timeout=request_timeout, ssl_context=ssl_context)
        self.metrics_http = metrics_http
        self.metrics_protocol = metrics_protocol or protocol
        self.grpc_credentials = dict(grpc_credentials or {})
        self.resource = Resource(attributes=otlp_attributes(resource_attributes))
        self.project_url = project_url
        self.protocol = protocol
        self.export_state: TraceExportState | None = None

    def get_project_url(self) -> str:
        return self.project_url

    def verify_credentials(self) -> bool:
        self.send_traces(ExportTraceServiceRequest())
        return True

    def send_traces(self, trace_request: ExportTraceServiceRequest) -> None:
        for batch in _trace_request_batches(trace_request):
            response = self._send("trace", batch.SerializeToString())
            accepted = ExportTraceServiceResponse.FromString(response)
            if accepted.partial_success.rejected_spans:
                raise TraceExportError("provider_rejected_spans")

    def send_metrics(self, metrics: list[Metric]) -> None:
        if not metrics:
            return
        if self.export_state is None:
            raise TraceExportError("metric_state_required")
        if self.export_state.has_completed_signal("metrics"):
            return
        resource = Resource()
        resource.CopyFrom(self.resource)
        metrics = self.export_state.prepare_metrics(metrics, resource, "dify.ops")
        request = ExportMetricsServiceRequest(
            resource_metrics=[
                ResourceMetrics(
                    resource=resource,
                    scope_metrics=[ScopeMetrics(scope=InstrumentationScope(name="dify.ops"), metrics=metrics)],
                )
            ]
        )
        response = self._send("metrics", request.SerializeToString())
        accepted = ExportMetricsServiceResponse.FromString(response)
        if accepted.partial_success.rejected_data_points:
            raise TraceExportError("provider_rejected_metrics")
        self.export_state.complete_signal("metrics")

    def _send(self, signal: str, serialized: bytes) -> bytes:
        client = self.metrics_http if signal == "metrics" and self.metrics_http is not None else self.http
        client.deadline = self.http.deadline
        protocol = self.metrics_protocol if signal == "metrics" else self.protocol
        if protocol == "grpc":
            return self._send_grpc(signal, serialized, http_client=client)
        endpoint = client.endpoint
        if signal == "metrics" and self.metrics_http is None:
            endpoint = endpoint.rsplit("/", 1)[0] + "/metrics"
        if endpoint != client.endpoint:
            client = TraceProviderHttpClient(
                endpoint,
                client.headers,
                request_timeout=client.request_timeout,
                connect_timeout=client.connect_timeout,
                pool_timeout=client.pool_timeout,
                ssl_context=client.ssl_context,
            )
        client.deadline = self.http.deadline
        response = client.request("POST", content=serialized, headers={"Content-Type": "application/x-protobuf"})
        return response.content

    def _remaining_seconds(self, request_timeout: float) -> float:
        remaining = self.http.deadline - monotonic()
        if remaining <= 0:
            raise TraceExportError("export_deadline_exceeded", retryable=True)
        return min(remaining, request_timeout)

    def _send_grpc(
        self, signal: str, serialized: bytes, *, http_client: TraceProviderHttpClient | None = None
    ) -> bytes:
        import grpc  # pyrefly: ignore[untyped-import]

        from configs import dify_config

        http_client = http_client if http_client is not None else self.http
        endpoint = urlsplit(http_client.endpoint)
        target = endpoint.netloc if endpoint.port else f"{endpoint.hostname}:4317"
        # An explicit Dify SSRF CONNECT proxy takes precedence. Otherwise let
        # gRPC discover process proxy settings and apply its native bypass rules.
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
        options = [("grpc.http_proxy", proxy)] if proxy else []
        credentials = self.grpc_credentials.get(signal)
        channel = (
            grpc.secure_channel(
                target, credentials if credentials is not None else grpc.ssl_channel_credentials(), options=options
            )
            if endpoint.scheme == "https"
            else grpc.insecure_channel(target, options=options)
        )
        service = "TraceService" if signal == "trace" else "MetricsService"
        try:
            with channel:
                send = channel.unary_unary(f"/opentelemetry.proto.collector.{signal}.v1.{service}/Export")
                return send(
                    serialized,
                    timeout=self._remaining_seconds(http_client.request_timeout),
                    metadata=tuple(http_client.headers.items()),
                )
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

    def build_span(
        self, completed_trace: CompletedTrace, span: TraceSpan, parent_span: dict[str, JsonValue] | None = None
    ) -> Span:
        """Let destinations project captured data without replacing OTLP transport."""
        return otlp_span(completed_trace, span, parent_span)

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        spans = [self.build_span(completed_trace, span, parent_span) for span in completed_trace.spans]
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
        return ExportedParentSpans(
            spans={
                span.span_id: {
                    "trace_id": otlp_trace_id(completed_trace, parent_span),
                    "span_id": export_span_id(completed_trace, span.span_id),
                }
                for span in completed_trace.spans
            }
        )
