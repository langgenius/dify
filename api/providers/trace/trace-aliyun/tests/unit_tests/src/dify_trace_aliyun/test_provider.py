import traceback
from collections.abc import Iterable
from urllib.parse import unquote, urlsplit

import pytest
from dify_trace_aliyun.config import AliyunConfig
from dify_trace_aliyun.provider import AliyunProvider
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressBlockedError,
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.provider import SendResult
from dify_trace_sdk.testing import (
    MESSAGE_ID,
    RecordedRequest,
    RecordingEgress,
    message_trace,
    response,
    tool_fragment,
    workflow_trace,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from opentelemetry.proto.common.v1.common_pb2 import KeyValue
from opentelemetry.proto.resource.v1.resource_pb2 import Resource
from opentelemetry.proto.trace.v1.trace_pb2 import Span as OtlpSpan
from opentelemetry.proto.trace.v1.trace_pb2 import Status

LICENSE_KEY = "SYNTHETIC-LICENSE@key_1"
CONFIG = AliyunConfig(
    app_name="test_app", license_key=LICENSE_KEY, endpoint="https://tracing-analysis-dc-qd.aliyuncs.com/prefix"
)
INGESTION_URL = f"https://tracing-analysis-dc-qd.aliyuncs.com/prefix/adapt_{LICENSE_KEY}/api/otlp/traces"
SUCCESS_ACK = response(200, b'"success"')


def _provider(*responses: EgressResponse | Exception) -> tuple[AliyunProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=None)
    return AliyunProvider(egress), egress


def _partial_success() -> bytes:
    partial = ExportTraceServiceResponse()
    partial.partial_success.rejected_spans = 1
    return partial.SerializeToString()


def _attributes(values: Iterable[KeyValue]) -> dict[str, object]:
    decoded: dict[str, object] = {}
    for item in values:
        match item.value.WhichOneof("value"):
            case "string_value":
                decoded[item.key] = item.value.string_value
            case "int_value":
                decoded[item.key] = item.value.int_value
            case "bool_value":
                decoded[item.key] = item.value.bool_value
            case "double_value":
                decoded[item.key] = item.value.double_value
            case other:
                raise AssertionError(f"unexpected attribute type: {other}")
    return decoded


def _payload(sent: RecordedRequest) -> ExportTraceServiceRequest:
    assert sent.method == "POST"
    assert sent.sensitive_url is True
    assert sent.headers["Content-Type"] == "application/x-protobuf"
    assert sent.content is not None
    return ExportTraceServiceRequest.FromString(sent.content)


def _exported(egress: RecordingEgress) -> tuple[Resource, list[OtlpSpan]]:
    (sent,) = egress.requests
    assert sent.url == INGESTION_URL
    (resource_spans,) = _payload(sent).resource_spans
    (scope_spans,) = resource_spans.scope_spans
    return resource_spans.resource, list(scope_spans.spans)


def _rendered(error: Exception) -> str:
    return str(error) + repr(error) + "".join(traceback.format_exception(error))


@pytest.mark.parametrize("ack", [SUCCESS_ACK, response(200, "success")])
def test_verify_posts_one_resource_without_spans_and_accepts_the_literal_ack(ack: EgressResponse) -> None:
    provider, egress = _provider(ack)
    assert provider.verify(CONFIG) == CONFIG

    (sent,) = egress.requests
    assert sent.url == INGESTION_URL
    assert sent.headers == {"Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf"}
    (resource_spans,) = _payload(sent).resource_spans
    assert list(resource_spans.scope_spans) == []
    assert _attributes(resource_spans.resource.attributes) == {"service.name": "test_app"}


@pytest.mark.parametrize(
    "outcome",
    [
        response(200, b""),
        response(200, b"{}"),
        response(200, b"success"),
        response(200, b'"success"\n'),
        response(200, b'"failure"'),
        response(201, b'"success"'),
        response(204, b""),
        response(401, b"private-response"),
        response(403, b"private-response"),
        response(405, b"private-response"),
        response(503, b"private-response"),
        EgressError("refused", request_sent=False),
        EgressError("read timeout", request_sent=True),
        EgressBlockedError("private address"),
    ],
)
def test_verify_failures_have_one_code_and_expose_neither_key_nor_body(outcome: EgressResponse | Exception) -> None:
    provider, egress = _provider(outcome)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == "verification_failed"
    rendered = _rendered(caught.value)
    assert LICENSE_KEY not in rendered
    assert "private-response" not in rendered
    assert len(egress.requests) == 1


def test_masked_license_keys_are_never_sent() -> None:
    masked = AliyunConfig.model_validate({**CONFIG.model_dump(), "license_key": "SYNTHETIC***key"})
    provider, egress = _provider()
    with pytest.raises(VerificationError) as caught:
        provider.verify(masked)
    assert caught.value.code == "invalid_license_key"
    with pytest.raises(ExportRejectedError):
        provider.send(masked, message_trace())
    assert egress.requests == []


def test_project_url_is_the_llm_console() -> None:
    provider, _ = _provider()
    assert provider.project_url(CONFIG) == "https://arms.console.aliyun.com/#/llm"


@pytest.mark.parametrize(
    ("endpoint", "expected"),
    [
        ("https://log.aliyuncs.com", "https://log.aliyuncs.com/adapt_k/api/v1/traces"),
        (
            "https://CN-QINGDAO.LOG.ALIYUNCS.COM.:443/prefix/",
            "https://cn-qingdao.log.aliyuncs.com.:443/prefix/adapt_k/api/v1/traces",
        ),
        ("https://log.aliyuncs.com.evil.test", "https://log.aliyuncs.com.evil.test/adapt_k/api/otlp/traces"),
        ("https://evil-log.aliyuncs.com", "https://evil-log.aliyuncs.com/adapt_k/api/otlp/traces"),
        ("https://collector.test/log.aliyuncs.com", "https://collector.test/log.aliyuncs.com/adapt_k/api/otlp/traces"),
        ("http://[::1]:4318/reverse/", "http://[::1]:4318/reverse/adapt_k/api/otlp/traces"),
    ],
)
def test_collector_route_depends_only_on_the_hostname(endpoint: str, expected: str) -> None:
    provider, egress = _provider(SUCCESS_ACK)
    provider.send(AliyunConfig(license_key="k", endpoint=endpoint), message_trace())
    (sent,) = egress.requests
    assert sent.url == expected


@pytest.mark.parametrize("key", ["raw%2F", "raw%252F", "a/b?c#d", "left@right_one+two", "密钥"])
def test_license_key_is_encoded_exactly_once_as_one_path_segment(key: str) -> None:
    provider, egress = _provider(SUCCESS_ACK)
    provider.verify(AliyunConfig(license_key=key, endpoint="https://collector.test"))
    (sent,) = egress.requests
    path = urlsplit(sent.url).path
    assert path.startswith("/adapt_")
    assert path.endswith("/api/otlp/traces")
    encoded = path.removeprefix("/adapt_").removesuffix("/api/otlp/traces")
    assert "/" not in encoded
    assert unquote(encoded) == key


def test_message_trace_is_exported_with_aliyun_genai_attributes() -> None:
    provider, egress = _provider(SUCCESS_ACK)
    trace = message_trace()
    assert provider.send(CONFIG, trace) == SendResult(trace_id=trace.trace_id, trace_url=None, span_urls={})

    resource, (root, llm) = _exported(egress)
    assert _attributes(resource.attributes) == {"service.name": "test_app", "acs.arms.service.feature": "genai_app"}
    assert root.trace_id.hex() == llm.trace_id.hex() == trace.trace_id == MESSAGE_ID.replace("-", "")
    assert (root.span_id.hex(), root.parent_span_id) == (trace.spans[0].span_id, b"")
    assert (llm.span_id.hex(), llm.parent_span_id.hex()) == (trace.spans[1].span_id, trace.spans[0].span_id)
    assert (root.name, llm.name) == ("message", "llm")
    assert root.status.code == llm.status.code == Status.STATUS_CODE_OK
    root_attributes = _attributes(root.attributes)
    assert (
        root_attributes.items()
        >= {
            "gen_ai.span.kind": "CHAIN",
            "gen_ai.framework": "dify",
            "gen_ai.session.id": "conversation-1",
            "gen_ai.user.id": "end-user-1",
            "input.value": '{"query": "What is Dify?"}',
            "output.value": '"An LLM application platform."',
            "dify.app_id": "app-1",
            "dify.tenant_id": "tenant-1",
            "dify.message_id": MESSAGE_ID,
        }.items()
    )
    assert "gen_ai.is_entry" not in root_attributes
    assert (
        _attributes(llm.attributes).items()
        >= {
            "gen_ai.span.kind": "LLM",
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.provider.name": "openai",
            "gen_ai.usage.input_tokens": 12,
            "gen_ai.usage.output_tokens": 8,
            "gen_ai.usage.total_tokens": 20,
            "gen_ai.response.time_to_first_token": 250_000_000,
            "dify.app_id": "app-1",
        }.items()
    )


def test_workflow_trace_keeps_hierarchy_kinds_and_errors() -> None:
    provider, egress = _provider(SUCCESS_ACK)
    trace = workflow_trace()
    provider.send(CONFIG, trace)

    _, (run, llm, tool) = _exported(egress)
    assert [span.span_id.hex() for span in (run, llm, tool)] == [span.span_id for span in trace.spans]
    assert (llm.parent_span_id.hex(), tool.parent_span_id.hex()) == (run.span_id.hex(), llm.span_id.hex())
    assert [_attributes(span.attributes)["gen_ai.span.kind"] for span in (run, llm, tool)] == ["CHAIN", "LLM", "TOOL"]
    assert (run.status.code, run.status.message) == (Status.STATUS_CODE_ERROR, "Tool failed")
    assert (tool.status.code, tool.status.message) == (Status.STATUS_CODE_ERROR, "Tool failed")
    assert llm.status.code == Status.STATUS_CODE_OK
    assert _attributes(tool.attributes)["gen_ai.tool.name"] == "tool_Search"


def test_fragment_root_points_at_the_separately_exported_message() -> None:
    provider, egress = _provider(SUCCESS_ACK)
    fragment = tool_fragment()
    provider.send(CONFIG, fragment)

    _, (tool,) = _exported(egress)
    assert fragment.parent is not None
    assert tool.trace_id.hex() == message_trace().trace_id
    assert tool.parent_span_id.hex() == fragment.parent.span_id == message_trace().root.span_id
    assert _attributes(tool.attributes)["gen_ai.span.kind"] == "TOOL"


@pytest.mark.parametrize(
    "ack",
    [response(200, b""), response(200, ExportTraceServiceResponse().SerializeToString()), response(200, {})],
)
def test_standard_otlp_acknowledgments_are_accepted(ack: EgressResponse) -> None:
    provider, _ = _provider(ack)
    provider.send(CONFIG, message_trace())


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (response(200, _partial_success()), ExportOutcomeUnknownError),
        (response(200, b"not-protobuf-\xff"), ExportOutcomeUnknownError),
        (response(200, "failure"), ExportOutcomeUnknownError),
        (response(201, b'"success"'), ExportOutcomeUnknownError),
        (response(503, b"private-response"), ExportRetryableError),
        (response(429, b"private-response"), ExportRetryableError),
        (response(403, b"private-response"), ExportRejectedError),
        (EgressError("refused", request_sent=False), ExportRetryableError),
        (EgressError("read timeout", request_sent=True), ExportOutcomeUnknownError),
        (EgressBlockedError("private address"), ExportRejectedError),
    ],
)
def test_send_failures_are_classified_without_exposing_the_key(
    outcome: EgressResponse | Exception, expected: type[Exception]
) -> None:
    provider, _ = _provider(outcome)
    with pytest.raises(expected) as caught:
        provider.send(CONFIG, message_trace())
    rendered = _rendered(caught.value)
    assert LICENSE_KEY not in rendered
    assert "private-response" not in rendered
