import pytest
from dify_trace_otel.config import OTelConfig
from dify_trace_otel.provider import OTelProvider
from dify_trace_sdk.errors import (
    EgressBlockedError,
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.testing import RecordingEgress, message_trace, response, tool_fragment, workflow_trace
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

ENDPOINT = "http://collector.internal:4318/v1/traces"


def _decode(egress: RecordingEgress) -> ExportTraceServiceRequest:
    return ExportTraceServiceRequest.FromString(egress.requests[-1].content or b"")


def test_verify_exports_no_spans_or_resources_and_has_no_console_link() -> None:
    egress = RecordingEgress([response(200, b"")], grpc_target=None)
    provider = OTelProvider(egress)
    config = OTelConfig(endpoint=ENDPOINT, headers='{"Authorization":"Bearer secret"}')
    assert provider.verify(config) == config
    assert list(_decode(egress).resource_spans) == []
    assert egress.requests[0].url == ENDPOINT
    assert egress.requests[0].headers["Authorization"] == "Bearer secret"
    assert egress.requests[0].sensitive_url is True
    assert provider.project_url(config) is None


@pytest.mark.parametrize("trace", [message_trace(), workflow_trace(), tool_fragment()])
def test_export_retains_canonical_tree_timing_errors_and_ids(trace) -> None:
    egress = RecordingEgress([response(200, b"")], grpc_target=None)
    config = OTelConfig(
        endpoint=ENDPOINT, service_name="my-dify", resource_attributes='{"env":"test","zones":["a","b"]}'
    )
    result = OTelProvider(egress).send(config, trace)
    resource = _decode(egress).resource_spans[0]
    attributes = {a.key: a.value for a in resource.resource.attributes}
    assert attributes["service.name"].string_value == "my-dify"
    assert attributes["env"].string_value == "test"
    assert [v.string_value for v in attributes["zones"].array_value.values] == ["a", "b"]
    spans = resource.scope_spans[0].spans
    assert len(spans) == len(trace.spans)
    for actual, source in zip(spans, trace.spans, strict=True):
        assert actual.trace_id.hex() == trace.trace_id
        assert actual.span_id.hex() == source.span_id
        assert actual.parent_span_id.hex() == (source.parent_span_id or "")
        assert actual.name == source.name
        assert actual.start_time_unix_nano > 0
        assert actual.end_time_unix_nano >= actual.start_time_unix_nano
        assert actual.status.code == (2 if source.error else 1)
    assert result.trace_id == trace.trace_id
    assert result.trace_url is None
    assert not result.span_urls
    assert egress.requests[0].headers["Content-Type"] == "application/x-protobuf"
    assert egress.requests[0].sensitive_url is True


def test_llm_attributes_are_queryable_and_wrapper_does_not_double_count_usage(monkeypatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=unrelated-secret")
    monkeypatch.setenv("OTEL_SERVICE_NAME", "ambient-service")
    egress = RecordingEgress([response(200, b"")], grpc_target=None)
    OTelProvider(egress).send(OTelConfig(endpoint=ENDPOINT), message_trace())
    root, llm = _decode(egress).resource_spans[0].scope_spans[0].spans
    root_attrs = {a.key: a.value for a in root.attributes}
    attrs = {a.key: a.value for a in llm.attributes}
    assert "gen_ai.usage.input_tokens" not in root_attrs
    assert attrs["gen_ai.usage.input_tokens"].int_value == 12
    assert attrs["gen_ai.usage.output_tokens"].int_value == 8
    assert attrs["gen_ai.request.model"].string_value == "gpt-4o"
    assert attrs["gen_ai.provider.name"].string_value == "openai"
    assert attrs["dify.span.kind"].string_value == "llm"
    assert attrs["dify.span.start_time"].string_value == "2026-10-01T08:00:00.000Z"
    assert "Authorization" not in egress.requests[0].headers


@pytest.mark.parametrize(
    ("status", "error"),
    [
        (401, ExportRejectedError),
        (403, ExportRejectedError),
        (404, ExportRejectedError),
        (429, ExportRetryableError),
        (503, ExportRetryableError),
        (501, ExportRejectedError),
    ],
)
def test_http_failures_use_pipeline_classification_without_response_secrets(status, error) -> None:
    egress = RecordingEgress([response(status, "secret-canary")], grpc_target=None)
    with pytest.raises(error) as caught:
        OTelProvider(egress).send(OTelConfig(endpoint=ENDPOINT), message_trace())
    assert "secret-canary" not in str(caught.value)
    assert len(egress.requests) == 1


@pytest.mark.parametrize(
    ("failure", "error"),
    [
        (EgressError("secret-canary", request_sent=False), ExportRetryableError),
        (EgressError("secret-canary", request_sent=True), ExportOutcomeUnknownError),
        (EgressBlockedError("secret-canary"), ExportRejectedError),
    ],
)
def test_transport_failures_have_no_hidden_retry_or_secret_leak(failure, error) -> None:
    egress = RecordingEgress([failure], grpc_target=None)
    with pytest.raises(error) as caught:
        OTelProvider(egress).send(OTelConfig(endpoint=ENDPOINT), message_trace())
    assert "secret-canary" not in str(caught.value)
    assert caught.value.__suppress_context__
    assert len(egress.requests) == 1


@pytest.mark.parametrize(
    "body", [b"not-protobuf", {"partialSuccess": {"rejectedSpans": 1, "errorMessage": "secret-canary"}}]
)
def test_partial_or_unreadable_acknowledgments_are_not_retryable(body) -> None:
    egress = RecordingEgress([response(200, body)], grpc_target=None)
    with pytest.raises(ExportOutcomeUnknownError) as caught:
        OTelProvider(egress).send(OTelConfig(endpoint=ENDPOINT), message_trace())
    assert "secret-canary" not in str(caught.value)


@pytest.mark.parametrize(
    ("reply", "code"),
    [
        (response(401, "secret-canary"), "authentication_failed"),
        (response(403, "secret-canary"), "permission_denied"),
        (response(500, "secret-canary"), "endpoint_unavailable"),
        (response(200, b"not-protobuf"), "unexpected_response"),
        (EgressError("secret-canary", request_sent=False), "connection_failed"),
    ],
)
def test_verification_reports_fixed_safe_codes(reply, code) -> None:
    egress = RecordingEgress([reply], grpc_target=None)
    with pytest.raises(VerificationError) as caught:
        OTelProvider(egress).verify(OTelConfig(endpoint=ENDPOINT))
    assert caught.value.code == code
