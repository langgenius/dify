from concurrent import futures
from typing import override

import grpc  # type: ignore[import-untyped]
import pytest
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressBlockedError,
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
)
from dify_trace_sdk.exporting import EXPORT_TIMEOUT_SECONDS, export_endpoint, send_export_request
from dify_trace_sdk.otlp import encode_trace, export_otlp_grpc, post_otlp, read_otlp_ack
from dify_trace_sdk.testing import RecordingEgress, message_trace, response, tool_fragment
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceResponse
from opentelemetry.proto.collector.trace.v1.trace_service_pb2_grpc import add_TraceServiceServicer_to_server


def _send(egress: RecordingEgress) -> None:
    send_export_request(
        egress,
        "POST",
        "https://collector.example.com/v1/traces",
        destination="Example",
        headers={},
        content=b"{}",
        sensitive_url=False,
    )


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (EgressError("refused", request_sent=False), ExportRetryableError),
        (EgressError("read timeout", request_sent=True), ExportOutcomeUnknownError),
        (EgressBlockedError("private address"), ExportRejectedError),
        (response(503, {}), ExportRetryableError),
        (response(429, {}), ExportRetryableError),
        (response(401, {}), ExportRejectedError),
        (response(501, {}), ExportRejectedError),
    ],
)
def test_export_failures_are_classified(outcome: EgressResponse | Exception, expected: type[Exception]) -> None:
    egress = RecordingEgress([outcome], grpc_target=None)
    with pytest.raises(expected):
        _send(egress)
    assert egress.requests[0].timeout == EXPORT_TIMEOUT_SECONDS


def test_export_endpoint_validation() -> None:
    assert export_endpoint("https://collector.example.com/") == "https://collector.example.com"
    for value in ("ftp://x", "https://u:p@x.example.com", "https://x.example.com/?token=1"):
        with pytest.raises(ExportRejectedError):
            export_endpoint(value)


def test_otlp_encoding_keeps_ids_and_external_parent() -> None:
    fragment = tool_fragment()
    request = encode_trace(fragment, resource={"service.name": "dify"}, attributes=lambda span: {"a": 1, "b": None})
    (span,) = request.resource_spans[0].scope_spans[0].spans
    assert span.trace_id.hex() == fragment.trace_id
    assert span.span_id.hex() == fragment.root.span_id
    assert fragment.parent is not None
    assert span.parent_span_id.hex() == fragment.parent.span_id
    assert [attribute.key for attribute in span.attributes] == ["a"]


def test_otlp_ack_partial_success_is_outcome_unknown() -> None:
    partial = ExportTraceServiceResponse()
    partial.partial_success.rejected_spans = 1
    with pytest.raises(ExportOutcomeUnknownError):
        read_otlp_ack(response(200, partial.SerializeToString()), "Example")
    with pytest.raises(ExportOutcomeUnknownError):
        read_otlp_ack(response(200, b"not-protobuf-\xff"), "Example")
    read_otlp_ack(response(200, ExportTraceServiceResponse().SerializeToString()), "Example")


def test_post_otlp_sends_protobuf() -> None:
    egress = RecordingEgress([response(200, b"")], grpc_target=None)
    request = encode_trace(message_trace(), resource={}, attributes=lambda span: {})
    post_otlp(egress, "https://c.example.com/v1/traces", request, destination="Example", headers={}, sensitive_url=True)
    (sent,) = egress.requests
    assert sent.headers["Content-Type"] == "application/x-protobuf"
    assert sent.content == request.SerializeToString()
    assert sent.sensitive_url is True


class _Collector:
    """An in-process OTLP collector; gRPC dispatches to ``Export`` by name."""

    def __init__(self) -> None:
        self.received = []

    def Export(self, request, context):  # noqa: N802 - gRPC method name
        self.received.append((request, dict(context.invocation_metadata())))
        return ExportTraceServiceResponse()


def test_otlp_grpc_export_uses_the_egress_channel() -> None:
    collector = _Collector()
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=1))
    add_TraceServiceServicer_to_server(collector, server)
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    try:
        egress = RecordingEgress([], grpc_target=f"127.0.0.1:{port}")
        request = encode_trace(message_trace(), resource={}, attributes=lambda span: {})
        export_otlp_grpc(egress, "https://collector.example.com", request, destination="Example", metadata={"k": "v"})
    finally:
        server.stop(None)
    assert egress.grpc_endpoints == ["https://collector.example.com"]
    ((received, metadata),) = collector.received
    assert received == request
    assert metadata["k"] == "v"


def test_otlp_grpc_invalid_metadata_is_rejected_without_echoing_it() -> None:
    egress = RecordingEgress([], grpc_target="127.0.0.1:9")
    request = encode_trace(message_trace(), resource={}, attributes=lambda span: {})
    with pytest.raises(ExportRejectedError) as raised:
        export_otlp_grpc(
            egress, "https://collector.example.com", request, destination="Example", metadata={"api_key": "s3cret\n"}
        )
    assert "s3cret" not in str(raised.value)
    assert raised.value.__cause__ is None


class _UnresolvableEgress(RecordingEgress):
    @override
    def grpc_channel(self, endpoint: str) -> grpc.Channel:
        raise EgressError("name resolution failed", request_sent=False)


def test_otlp_grpc_unresolvable_endpoint_is_retryable() -> None:
    request = encode_trace(message_trace(), resource={}, attributes=lambda span: {})
    with pytest.raises(ExportRetryableError):
        export_otlp_grpc(
            _UnresolvableEgress([], grpc_target=None),
            "https://collector.example.com",
            request,
            destination="Example",
            metadata={},
        )


def test_otlp_grpc_blocked_endpoint_is_rejected() -> None:
    egress = RecordingEgress([], grpc_target=None)
    request = encode_trace(message_trace(), resource={}, attributes=lambda span: {})
    with pytest.raises(ExportRejectedError):
        export_otlp_grpc(egress, "https://169.254.169.254", request, destination="Example", metadata={})
