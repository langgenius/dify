"""Encode completed spans with stable IDs and explicit provider ingestion ACKs.

No tracer or global SDK configuration is created: a replay must preserve the
original IDs and timestamps, and destination credentials belong to one export.
"""

import re
from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from core.ops.exceptions import RetryableTraceDispatchError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanStatus, CanonicalTrace
from services.tracing.provider_common import json_value, nanos, request
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportUncertainError


def _id(value: str, length: int) -> bytes:
    if not re.fullmatch(rf"[0-9a-f]{{{length}}}", value) or int(value, 16) == 0:
        raise TraceExportRejectedError("Application trace contains an invalid OpenTelemetry identifier")
    return bytes.fromhex(value)


def build_request(
    trace: CanonicalTrace,
    resource: Mapping[str, object],
    attributes: Callable[[CanonicalSpan], Mapping[str, object]],
) -> Any:
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
    from opentelemetry.proto.common.v1.common_pb2 import AnyValue, KeyValue
    from opentelemetry.proto.trace.v1.trace_pb2 import Status

    def attribute(key: str, value: object) -> Any:
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

    trace_id = _id(trace.trace_id, 32)
    payload = ExportTraceServiceRequest()
    resource_spans = payload.resource_spans.add()
    resource_spans.resource.attributes.extend(attribute(k, v) for k, v in resource.items() if v is not None)
    scope = resource_spans.scope_spans.add()
    scope.scope.name = "dify.application.tracing"
    scope.scope.version = "1"
    for span in trace.spans:
        if span.end_time is None or nanos(span.end_time) < nanos(span.start_time):
            raise TraceExportRejectedError("Application trace contains incomplete or invalid timestamps")
        target = scope.spans.add(
            trace_id=trace_id,
            span_id=_id(span.id, 16),
            parent_span_id=_id(span.parent_id, 16) if span.parent_id else b"",
            name=span.name,
            kind=1,
            start_time_unix_nano=nanos(span.start_time),
            end_time_unix_nano=nanos(span.end_time),
            flags=1,
        )
        target.status.code = (
            Status.STATUS_CODE_ERROR if span.status is CanonicalSpanStatus.ERROR else Status.STATUS_CODE_OK
        )
        if span.error:
            target.status.message = span.error
        target.attributes.extend(attribute(k, v) for k, v in attributes(span).items() if v is not None)
    return payload


def _check_response(response: Any, provider: str) -> None:
    if response.partial_success.rejected_spans:
        # Retrying the entire batch would duplicate the accepted subset.
        raise TraceExportUncertainError(f"{provider} partially accepted the trace; reconciliation is required")


def _langfuse_enqueue_ack(body: object) -> bool:
    """Recognize Langfuse's queue acknowledgement without exposing its auth data.

    The v4 HTTP route returns the job after blob upload and awaited queue.add,
    rather than an OTLP ExportTraceServiceResponse. This confirms enqueue only.
    Upstream: langfuse/langfuse@bc1ade0aacca75104bad934e92d70a454ec16e67,
    web/src/server/otel/processOtelIngestion.ts:277 and
    packages/shared/src/server/otel/OtelIngestionProcessor.ts:350.
    """
    if not isinstance(body, Mapping) or body.get("name") != "otel-ingestion-job":
        return False
    if any(key in body for key in ("partialSuccess", "partial_success", "error", "errors")) or body.get("failedReason"):
        return False
    data = body.get("data")
    if not isinstance(data, Mapping) or data.get("name") != "otel-ingestion-job":
        return False
    identifier, timestamp = data.get("id"), data.get("timestamp")
    if not isinstance(identifier, str) or not isinstance(timestamp, str):
        return False
    try:
        if UUID(identifier).int == 0 or datetime.fromisoformat(timestamp).tzinfo is None:
            return False
    except ValueError:
        return False
    payload = data.get("payload")
    if not isinstance(payload, Mapping):
        return False
    stored_data, auth = payload.get("data"), payload.get("authCheck")
    if not isinstance(stored_data, Mapping) or not isinstance(auth, Mapping) or auth.get("validKey") is not True:
        return False
    scope = auth.get("scope")
    if not isinstance(scope, Mapping) or scope.get("accessLevel") != "project":
        return False
    return all(
        isinstance(value, str) and bool(value.strip())
        for value in (stored_data.get("fileKey"), stored_data.get("publicKey"), scope.get("projectId"))
    )


def export_http(provider: str, url: str, headers: Mapping[str, str], payload: Any) -> None:
    from google.protobuf.json_format import ParseDict, ParseError
    from google.protobuf.message import DecodeError
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceResponse

    response = request(
        "POST",
        url,
        provider,
        headers={"Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf", **headers},
        content=payload.SerializeToString(),
    )
    result = ExportTraceServiceResponse()
    if response.content:
        try:
            if "json" in response.headers.get("content-type", "").lower():
                body = response.json()
                if not isinstance(body, dict):
                    raise ValueError("Invalid ingestion acknowledgment object")
                if (
                    provider == "langfuse"
                    and response.status_code == 200
                    and any(
                        key.lower() == "x-langfuse-ingestion-version" and value == "4" for key, value in headers.items()
                    )
                    and _langfuse_enqueue_ack(body)
                ):
                    return
                ParseDict(body, result)
            else:
                result.ParseFromString(response.content)
        except (DecodeError, ParseError, ValueError):
            raise TraceExportUncertainError(f"{provider} returned an unreadable ingestion acknowledgment") from None
    _check_response(result, provider)


def export_grpc(provider: str, url: str, headers: Mapping[str, str], payload: Any) -> None:
    """Use the provider's gRPC protocol; HTTP exports use the SSRF HTTP owner."""
    import grpc  # type: ignore[import-untyped]
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2_grpc import TraceServiceStub

    parsed = urlsplit(url)
    if not parsed.hostname or parsed.username or parsed.password or parsed.scheme not in {"http", "https"}:
        raise TraceExportRejectedError("Invalid OTLP gRPC endpoint")
    port = parsed.port or (4317 if provider == "tencent" else 443)
    host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
    target = f"{host}:{port}"
    channel = (
        grpc.insecure_channel(target)
        if parsed.scheme == "http"
        else grpc.secure_channel(target, grpc.ssl_channel_credentials())
    )
    try:
        result = TraceServiceStub(channel).Export(payload, metadata=tuple(headers.items()), timeout=30)
    except grpc.RpcError as error:
        code = error.code()
        if code in {
            grpc.StatusCode.DEADLINE_EXCEEDED,
            grpc.StatusCode.CANCELLED,
            grpc.StatusCode.UNKNOWN,
            grpc.StatusCode.UNAVAILABLE,
        }:
            raise TraceExportUncertainError(f"{provider} ingestion acknowledgment is unknown") from None
        if code in {grpc.StatusCode.RESOURCE_EXHAUSTED, grpc.StatusCode.ABORTED}:
            raise RetryableTraceDispatchError(f"{provider} ingestion temporarily unavailable") from None
        raise TraceExportRejectedError(f"{provider} ingestion rejected") from None
    finally:
        channel.close()
    _check_response(result, provider)
