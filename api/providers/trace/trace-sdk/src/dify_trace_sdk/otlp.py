"""OTLP encoding and delivery for providers that ingest OpenTelemetry traces."""

from collections.abc import Callable, Mapping

import grpc  # type: ignore[import-untyped]
from google.protobuf.json_format import ParseDict, ParseError
from google.protobuf.message import DecodeError
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2_grpc import TraceServiceStub
from opentelemetry.proto.common.v1.common_pb2 import AnyValue, KeyValue
from opentelemetry.proto.trace.v1.trace_pb2 import Span as OtlpSpan
from opentelemetry.proto.trace.v1.trace_pb2 import Status

from dify_trace_sdk.egress import Egress, EgressResponse
from dify_trace_sdk.errors import EgressError, ExportOutcomeUnknownError, ExportRejectedError, ExportRetryableError
from dify_trace_sdk.exporting import classify_egress_error, json_value, nanos, send_export_request
from dify_trace_sdk.model import Span, SpanStatus, Trace

type AttributeMapper = Callable[[Span], Mapping[str, object]]

OTLP_GRPC_TIMEOUT_SECONDS = 30.0


def _attribute(key: str, value: object) -> KeyValue:
    if isinstance(value, bool):
        encoded = AnyValue(bool_value=value)
    elif isinstance(value, int):
        encoded = AnyValue(int_value=value)
    elif isinstance(value, float):
        encoded = AnyValue(double_value=value)
    elif isinstance(value, str):
        encoded = AnyValue(string_value=value)
    else:
        encoded = AnyValue(string_value=json_value(value))
    return KeyValue(key=key, value=encoded)


def encode_trace(
    trace: Trace, *, resource: Mapping[str, object], attributes: AttributeMapper
) -> ExportTraceServiceRequest:
    """Encode one trace unit; ``None`` attribute values are omitted."""
    payload = ExportTraceServiceRequest()
    resource_spans = payload.resource_spans.add()
    resource_spans.resource.attributes.extend(_attribute(k, v) for k, v in resource.items() if v is not None)
    scope = resource_spans.scope_spans.add()
    scope.scope.name = "dify"
    scope.scope.version = "1"
    trace_id = bytes.fromhex(trace.trace_id)
    for span in trace.spans:
        target = scope.spans.add(
            trace_id=trace_id,
            span_id=bytes.fromhex(span.span_id),
            parent_span_id=bytes.fromhex(span.parent_span_id) if span.parent_span_id else b"",
            name=span.name,
            kind=OtlpSpan.SPAN_KIND_INTERNAL,
            start_time_unix_nano=nanos(span.start_time),
            end_time_unix_nano=nanos(span.end_time),
            flags=1,
        )
        target.status.code = Status.STATUS_CODE_ERROR if span.status is SpanStatus.ERROR else Status.STATUS_CODE_OK
        if span.error:
            target.status.message = span.error
        target.attributes.extend(_attribute(k, v) for k, v in attributes(span).items() if v is not None)
    return payload


def read_otlp_ack(response: EgressResponse, destination: str) -> None:
    """Accept a standard OTLP acknowledgment; partial acceptance is never retried."""
    result = ExportTraceServiceResponse()
    if response.content:
        try:
            if "json" in response.headers.get("content-type", "").lower():
                body = response.json()
                if not isinstance(body, dict):
                    raise ValueError("acknowledgment is not an object")
                ParseDict(body, result)
            else:
                result.ParseFromString(response.content)
        except (DecodeError, ParseError, ValueError):
            raise ExportOutcomeUnknownError(f"{destination} returned an unreadable acknowledgment") from None
    if result.partial_success.rejected_spans:
        raise ExportOutcomeUnknownError(f"{destination} accepted part of the trace")


def post_otlp(
    egress: Egress,
    url: str,
    request: ExportTraceServiceRequest,
    *,
    destination: str,
    headers: Mapping[str, str],
    sensitive_url: bool,
) -> EgressResponse:
    """POST protobuf OTLP; the caller reads the acknowledgment."""
    return send_export_request(
        egress,
        "POST",
        url,
        destination=destination,
        headers={"Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf", **headers},
        content=request.SerializeToString(),
        sensitive_url=sensitive_url,
    )


def export_otlp_grpc(
    egress: Egress,
    endpoint: str,
    request: ExportTraceServiceRequest,
    *,
    destination: str,
    metadata: Mapping[str, str],
) -> None:
    try:
        channel = egress.grpc_channel(endpoint)
    except EgressError as error:
        raise classify_egress_error(error, destination) from None
    try:
        result = TraceServiceStub(channel).Export(
            request, metadata=tuple(metadata.items()), timeout=OTLP_GRPC_TIMEOUT_SECONDS
        )
    except grpc.RpcError as error:
        code = error.code()
        if code in {grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.RESOURCE_EXHAUSTED, grpc.StatusCode.ABORTED}:
            raise ExportRetryableError(f"{destination} ingestion temporarily unavailable") from None
        if code in {grpc.StatusCode.DEADLINE_EXCEEDED, grpc.StatusCode.CANCELLED, grpc.StatusCode.UNKNOWN}:
            raise ExportOutcomeUnknownError(f"{destination} ingestion outcome is unknown") from None
        raise ExportRejectedError(f"{destination} ingestion rejected") from None
    except ValueError:
        # gRPC rejects invalid metadata before sending and echoes it, credentials included, in the message.
        raise ExportRejectedError(f"{destination} export metadata is invalid") from None
    finally:
        channel.close()
    if result.partial_success.rejected_spans:
        raise ExportOutcomeUnknownError(f"{destination} accepted part of the trace")
