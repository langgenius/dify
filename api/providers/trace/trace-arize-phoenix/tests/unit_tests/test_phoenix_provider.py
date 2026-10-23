from collections.abc import Iterable

import pytest
from dify_trace_arize_phoenix.config import PhoenixConfig
from dify_trace_arize_phoenix.provider import PhoenixProvider
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressBlockedError,
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.exporting import json_value
from dify_trace_sdk.testing import (
    WORKFLOW_RUN_ID,
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
from opentelemetry.proto.common.v1.common_pb2 import AnyValue, KeyValue
from opentelemetry.proto.trace.v1.trace_pb2 import Status

CONFIG = PhoenixConfig(api_key="phx-secret-key", project="dify-app", endpoint="https://phoenix.example.com/s/space")
EMPTY_PAGE = {"data": [], "next_cursor": None}


def _provider(*responses: EgressResponse | Exception) -> tuple[PhoenixProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=None)
    return PhoenixProvider(egress), egress


def _config(**changes: str | None) -> PhoenixConfig:
    return PhoenixConfig.model_validate({**CONFIG.model_dump(), **changes})


def _value(value: AnyValue) -> object:
    match value.WhichOneof("value"):
        case "string_value":
            return value.string_value
        case "int_value":
            return value.int_value
        case "double_value":
            return value.double_value
        case "bool_value":
            return value.bool_value
        case other:
            raise AssertionError(f"unexpected attribute value type {other}")


def _attributes(attributes: Iterable[KeyValue]) -> dict[str, object]:
    return {attribute.key: _value(attribute.value) for attribute in attributes}


def _sent(egress: RecordingEgress) -> ExportTraceServiceRequest:
    (sent,) = egress.requests
    return ExportTraceServiceRequest.FromString(sent.content or b"")


def _partial_ack() -> bytes:
    ack = ExportTraceServiceResponse()
    ack.partial_success.rejected_spans = 1
    return ack.SerializeToString()


def test_verify_normalizes_the_destination_and_reads_one_project_page() -> None:
    provider, egress = _provider(response(200, EMPTY_PAGE))
    verified = provider.verify(
        _config(endpoint=" HTTP://Phoenix.EXAMPLE.com:6006/proxy/s/space/ ", project=" project name ")
    )
    assert (verified.endpoint, verified.project) == ("http://phoenix.example.com:6006/proxy/s/space", "project name")
    (sent,) = egress.requests
    assert (sent.method, sent.url, sent.content) == (
        "GET",
        "http://phoenix.example.com:6006/proxy/s/space/v1/projects?limit=1",
        None,
    )
    assert sent.headers == {"Accept": "application/json", "Authorization": "Bearer phx-secret-key"}
    assert sent.sensitive_url is False


@pytest.mark.parametrize("api_key", [None, ""])
def test_verify_without_a_key_sends_no_authorization(api_key: str | None) -> None:
    provider, egress = _provider(response(200, EMPTY_PAGE))
    provider.verify(PhoenixConfig(api_key=api_key))
    (sent,) = egress.requests
    assert sent.url == "https://app.phoenix.arize.com/v1/projects?limit=1"
    assert sent.headers == {"Accept": "application/json"}


def test_verify_does_not_require_the_configured_project_or_follow_the_cursor() -> None:
    page = {"data": [{"id": "UHJvamVjdDox", "name": "other", "description": None}], "next_cursor": "opaque"}
    provider, egress = _provider(response(200, page))
    assert provider.verify(CONFIG).project == "dify-app"
    assert len(egress.requests) == 1


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"endpoint": "https://phoenix.example.com/v1/traces"}, "invalid_endpoint"),
        ({"endpoint": "https://phoenix.example.com/s/../space"}, "invalid_endpoint"),
        ({"endpoint": "https://phoenix.example.com/s%2fspace"}, "invalid_endpoint"),
        ({"endpoint": "https://phoenix.example.com//space"}, "invalid_endpoint"),
        ({"endpoint": "https://phoenix.example.com/s?token=secret"}, "invalid_endpoint"),
        ({"endpoint": "https://phoenix.example.com:0"}, "invalid_endpoint"),
        ({"project": ".."}, "invalid_project"),
        ({"project": "line\nbreak"}, "invalid_project"),
        ({"api_key": "******"}, "invalid_api_key"),
        ({"api_key": "two words"}, "invalid_api_key"),
        ({"api_key": "ключ"}, "invalid_api_key"),
    ],
)
def test_invalid_values_fail_before_any_request(changes: dict[str, str], code: str) -> None:
    provider, egress = _provider()
    with pytest.raises(VerificationError) as caught:
        provider.verify(_config(**changes))
    assert caught.value.code == code
    assert egress.requests == []


@pytest.mark.parametrize(
    ("outcome", "code"),
    [
        (response(401, {"detail": "phx-secret-key is invalid"}), "authentication_failed"),
        (response(403, {}), "permission_denied"),
        (response(404, {}), "endpoint_unavailable"),
        (response(302, {}), "endpoint_unavailable"),
        (response(500, {}), "endpoint_unavailable"),
        (response(204, b""), "endpoint_unavailable"),
        (response(200, b"<html>login</html>"), "malformed_response"),
        (response(200, []), "malformed_response"),
        (response(200, {"data": []}), "malformed_response"),
        (response(200, {"data": [], "next_cursor": 3}), "malformed_response"),
        (response(200, {"data": [{"id": "1"}], "next_cursor": None}), "malformed_response"),
        (response(200, {"data": [{"id": "1", "name": ""}], "next_cursor": None}), "malformed_response"),
        (
            response(200, {"data": [{"id": "1", "name": "p", "description": {}}], "next_cursor": None}),
            "malformed_response",
        ),
        (response(200, {**EMPTY_PAGE, "padding": "x" * 1024 * 1024}), "malformed_response"),
        (EgressError("connect timeout", request_sent=False), "connection_failed"),
        (EgressBlockedError("private address"), "connection_failed"),
    ],
)
def test_verify_failures_have_stable_codes(outcome: EgressResponse | Exception, code: str) -> None:
    provider, egress = _provider(outcome)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == code
    assert "phx-secret-key" not in str(caught.value)
    assert caught.value.__context__ is None or caught.value.__suppress_context__
    assert len(egress.requests) == 1


def test_project_url_redirects_by_name_without_io() -> None:
    provider, egress = _provider()
    config = PhoenixConfig(endpoint="https://Phoenix.example.com:8443/s/space/", project="A /? & #中文")
    assert provider.project_url(config) == (
        "https://phoenix.example.com:8443/s/space/redirects/projects/A%20%2F%3F%20%26%20%23%E4%B8%AD%E6%96%87"
    )
    assert provider.project_url(PhoenixConfig()) == "https://app.phoenix.arize.com/redirects/projects/default"
    assert provider.project_url(PhoenixConfig(endpoint="https://phoenix.example.com/v1/traces")) is None
    assert egress.requests == []


def test_message_trace_becomes_openinference_spans() -> None:
    provider, egress = _provider(response(200, ExportTraceServiceResponse().SerializeToString()))
    trace = message_trace()
    result = provider.send(CONFIG, trace)

    (sent,) = egress.requests
    assert sent.url == "https://phoenix.example.com/s/space/v1/traces"
    assert sent.headers["Content-Type"] == "application/x-protobuf"
    assert (sent.headers["api_key"], sent.headers["authorization"]) == ("phx-secret-key", "Bearer phx-secret-key")
    (resource_spans,) = _sent(egress).resource_spans
    assert _attributes(resource_spans.resource.attributes) == {
        "service.name": "dify-application",
        "openinference.project.name": "dify-app",
        "model_id": "dify-app",
    }
    message, llm = resource_spans.scope_spans[0].spans
    assert [(span.trace_id.hex(), span.span_id.hex(), span.parent_span_id.hex()) for span in (message, llm)] == [
        (trace.trace_id, trace.spans[0].span_id, ""),
        (trace.trace_id, trace.spans[1].span_id, trace.spans[0].span_id),
    ]
    assert (message.name, message.status.code) == ("message", Status.STATUS_CODE_OK)
    assert _attributes(message.attributes) == {
        "openinference.span.kind": "CHAIN",
        "input.value": '{"query": "What is Dify?"}',
        "input.mime_type": "application/json",
        "output.value": '"An LLM application platform."',
        "output.mime_type": "application/json",
        "metadata": json_value(trace.spans[0].attributes),
        "session.id": "conversation-1",
        "user.id": "end-user-1",
        "dify.span.id": trace.spans[0].span_id,
    }
    llm_attributes = _attributes(llm.attributes)
    assert llm_attributes["openinference.span.kind"] == "LLM"
    assert llm_attributes["input.value"] == '[{"role": "user", "content": "What is Dify?"}]'
    assert {key: value for key, value in llm_attributes.items() if key.startswith("llm.")} == {
        "llm.model_name": "gpt-4o",
        "llm.provider": "openai",
        "llm.token_count.prompt": 12,
        "llm.token_count.completion": 8,
        "llm.token_count.total": 20,
    }
    assert (result.trace_id, result.trace_url, result.span_urls) == (trace.trace_id, None, {})


def test_workflow_spans_keep_hierarchy_errors_and_tool_fields() -> None:
    provider, egress = _provider(response(200, b""))
    trace = workflow_trace()
    provider.send(CONFIG, trace)

    run, llm, tool = _sent(egress).resource_spans[0].scope_spans[0].spans
    assert [span.parent_span_id.hex() for span in (run, llm, tool)] == [
        "",
        trace.spans[0].span_id,
        trace.spans[1].span_id,
    ]
    assert (run.status.code, run.status.message) == (Status.STATUS_CODE_ERROR, "Tool failed")
    assert (llm.status.code, llm.status.message) == (Status.STATUS_CODE_OK, "")
    assert (tool.status.code, tool.status.message) == (Status.STATUS_CODE_ERROR, "Tool failed")
    tool_attributes = _attributes(tool.attributes)
    assert tool_attributes["openinference.span.kind"] == "TOOL"
    assert (tool_attributes["tool.name"], tool_attributes["tool.parameters"]) == ("tool_Search", '{"query": "tracing"}')
    assert (tool_attributes["session.id"], tool_attributes["user.id"]) == (WORKFLOW_RUN_ID, "account-1")
    assert not any(key.startswith("llm.") for key in tool_attributes)
    assert _attributes(llm.attributes)["llm.token_count.total"] == 40


def test_fragment_root_points_at_the_separately_sent_parent() -> None:
    provider, egress = _provider(response(200, b""))
    fragment = tool_fragment()
    provider.send(CONFIG, fragment)

    (span,) = _sent(egress).resource_spans[0].scope_spans[0].spans
    assert fragment.parent is not None
    assert (span.trace_id.hex(), span.span_id.hex(), span.parent_span_id.hex()) == (
        fragment.trace_id,
        fragment.root.span_id,
        fragment.parent.span_id,
    )
    attributes = _attributes(span.attributes)
    assert (attributes["openinference.span.kind"], attributes["tool.name"]) == ("TOOL", "weather")
    assert attributes["output.value"] == '"Sunny"'


def test_send_without_a_key_sends_no_credentials() -> None:
    provider, egress = _provider(response(200, b""))
    provider.send(PhoenixConfig(endpoint="http://phoenix.internal:6006/"), message_trace())
    (sent,) = egress.requests
    assert sent.url == "http://phoenix.internal:6006/v1/traces"
    assert sent.headers == {"Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf"}


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (response(503, {}), ExportRetryableError),
        (response(429, {}), ExportRetryableError),
        (response(401, {"detail": "phx-secret-key is invalid"}), ExportRejectedError),
        (EgressError("connection refused", request_sent=False), ExportRetryableError),
        (EgressError("read timeout", request_sent=True), ExportOutcomeUnknownError),
        (EgressBlockedError("private address"), ExportRejectedError),
        (response(200, _partial_ack()), ExportOutcomeUnknownError),
        (response(200, b"not-protobuf-\xff"), ExportOutcomeUnknownError),
    ],
)
def test_send_failures_are_classified(outcome: EgressResponse | Exception, expected: type[Exception]) -> None:
    provider, _ = _provider(outcome)
    with pytest.raises(expected) as caught:
        provider.send(CONFIG, message_trace())
    assert "phx-secret-key" not in str(caught.value)


@pytest.mark.parametrize("changes", [{"api_key": "line\nbreak"}, {"endpoint": "https://phoenix.example.com/?token=1"}])
def test_unusable_configuration_is_rejected_without_a_request(changes: dict[str, str]) -> None:
    provider, egress = _provider()
    with pytest.raises(ExportRejectedError):
        provider.send(_config(**changes), message_trace())
    assert egress.requests == []
