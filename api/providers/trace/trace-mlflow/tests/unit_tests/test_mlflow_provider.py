import base64
import json
from urllib.parse import parse_qs, urlsplit

import pytest
from dify_trace_mlflow.config import MLflowConfig
from dify_trace_mlflow.provider import MLflowProvider
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressBlockedError,
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.ids import trace_id_for
from dify_trace_sdk.model import Cost, Span, TokenUsage, Trace
from dify_trace_sdk.testing import (
    MESSAGE_ID,
    WORKFLOW_RUN_ID,
    RecordingEgress,
    message_trace,
    response,
    tool_fragment,
    workflow_trace,
)
from mlflow.entities import Span as MlflowSpan
from mlflow.entities import SpanStatusCode
from mlflow.tracing.constant import SpanAttributeKey
from mlflow.tracing.otel.translation import translate_span_when_storing
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from pydantic import JsonValue

CONFIG = MLflowConfig(
    tracking_uri="https://mlflow.example/proxy", experiment_id="42", username="admin", password="s3cret"
)
BASIC_AUTH = "Basic " + base64.b64encode(b"admin:s3cret").decode()
ACK = EgressResponse(status_code=200, headers={"content-type": "application/x-protobuf"}, content=b"")
EXPERIMENT = {"experiment": {"experiment_id": "42", "name": "Dify", "lifecycle_stage": "active"}}


def _provider(*responses: EgressResponse | Exception) -> tuple[MLflowProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=None)
    return MLflowProvider(egress), egress


def _otlp(egress: RecordingEgress) -> ExportTraceServiceRequest:
    (sent,) = egress.requests
    assert sent.content is not None
    return ExportTraceServiceRequest.FromString(sent.content)


def _exported(egress: RecordingEgress) -> list[MlflowSpan]:
    """Read the export the way the MLflow server's OTLP endpoint does."""
    return [MlflowSpan.from_otel_proto(span) for span in _otlp(egress).resource_spans[0].scope_spans[0].spans]


def _stored_attribute(span: MlflowSpan, key: str) -> JsonValue:
    """An attribute as the MLflow server's tracking store keeps it."""
    return json.loads(translate_span_when_storing(span)["attributes"][key])


def _with_span(trace: Trace, index: int, span: Span) -> Trace:
    return trace.model_copy(update={"spans": (*trace.spans[:index], span, *trace.spans[index + 1 :])})


def _ack(rejected_spans: int) -> EgressResponse:
    ack = ExportTraceServiceResponse()
    ack.partial_success.rejected_spans = rejected_spans
    return EgressResponse(
        status_code=200, headers={"content-type": "application/x-protobuf"}, content=ack.SerializeToString()
    )


def test_verify_reads_the_experiment_and_normalizes_the_destination() -> None:
    provider, egress = _provider(response(200, EXPERIMENT))
    config = MLflowConfig(
        tracking_uri="https://MLflow.Example/proxy/", experiment_id="042", username="admin", password="s3cret"
    )

    verified = provider.verify(config)

    assert verified.tracking_uri == "https://mlflow.example/proxy"
    assert verified.experiment_id == "42"
    assert (verified.username, verified.password) == ("admin", "s3cret")
    (sent,) = egress.requests
    assert sent.method == "GET"
    assert sent.url == "https://mlflow.example/proxy/api/2.0/mlflow/experiments/get?experiment_id=42"
    assert sent.headers == {"Accept": "application/json", "Authorization": BASIC_AUTH}
    assert sent.content is None


def test_verify_without_credentials_sends_no_authorization() -> None:
    provider, egress = _provider(response(200, EXPERIMENT))
    provider.verify(MLflowConfig(tracking_uri="http://localhost:5000", experiment_id="42"))
    (sent,) = egress.requests
    assert sent.headers == {"Accept": "application/json"}


@pytest.mark.parametrize(
    ("outcome", "code"),
    [
        (response(401, {}), "authentication_failed"),
        (response(403, {}), "permission_denied"),
        (response(404, {"error_code": "RESOURCE_DOES_NOT_EXIST"}), "experiment_not_found_or_inaccessible"),
        (response(503, {}), "endpoint_unavailable"),
        (response(302, {}), "endpoint_unavailable"),
        (response(200, b"<html></html>"), "malformed_response"),
        (response(200, ["not", "an", "object"]), "malformed_response"),
        (response(200, {}), "malformed_response"),
        (response(200, {"experiment": {"experiment_id": ["42"]}}), "malformed_response"),
        (response(200, {"experiment": {"experiment_id": "7", "lifecycle_stage": "active"}}), "experiment_id_mismatch"),
        (response(200, {"experiment": {"experiment_id": "42", "lifecycle_stage": "deleted"}}), "experiment_not_active"),
        (EgressError("connection refused", request_sent=False), "connection_failed"),
        (EgressBlockedError("private address"), "connection_failed"),
    ],
)
def test_verify_failures_have_stable_codes(outcome: EgressResponse | Exception, code: str) -> None:
    provider, _ = _provider(outcome)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == code


@pytest.mark.parametrize(
    ("values", "code"),
    [
        ({"tracking_uri": "https://mlflow.example/a/../b"}, "invalid_tracking_uri"),
        ({"tracking_uri": "https://mlflow.example/a%2Fb"}, "invalid_tracking_uri"),
        ({"tracking_uri": "https://mlflow.example//proxy"}, "invalid_tracking_uri"),
        ({"tracking_uri": "https://mlflow.example/proxy?token=1"}, "invalid_tracking_uri"),
        ({"tracking_uri": "https://mlflow.example/my proxy"}, "invalid_tracking_uri"),
        ({"tracking_uri": "https://mlflow.example:0"}, "invalid_tracking_uri"),
        ({"password": None}, "incomplete_basic_auth"),
        ({"username": None}, "incomplete_basic_auth"),
        ({"username": " "}, "incomplete_basic_auth"),
        ({"username": "ad:min"}, "incomplete_basic_auth"),
        ({"password": "s3cret\n"}, "incomplete_basic_auth"),
    ],
)
def test_verify_rejects_unusable_configurations_without_requests(values: dict[str, str | None], code: str) -> None:
    provider, egress = _provider()
    config = MLflowConfig.model_validate({**CONFIG.model_dump(), **values})
    with pytest.raises(VerificationError) as caught:
        provider.verify(config)
    assert caught.value.code == code
    assert egress.requests == []


def test_project_url_is_normalized_without_requests() -> None:
    provider, egress = _provider()
    config = MLflowConfig(tracking_uri="https://MLflow.Example/proxy/", experiment_id="042")
    assert provider.project_url(config) == "https://mlflow.example/proxy/#/experiments/42/traces"
    assert provider.project_url(MLflowConfig(tracking_uri="https://mlflow.example/a/../b")) is None
    assert egress.requests == []


def test_message_trace_is_exported_as_mlflow_spans_over_otlp() -> None:
    provider, egress = _provider(ACK)
    trace = message_trace()

    result = provider.send(CONFIG, trace)

    (sent,) = egress.requests
    assert sent.method == "POST"
    assert sent.url == "https://mlflow.example/proxy/v1/traces"
    assert sent.headers["Content-Type"] == "application/x-protobuf"
    assert sent.headers["x-mlflow-experiment-id"] == "42"
    assert sent.headers["Authorization"] == BASIC_AUTH
    assert not sent.sensitive_url
    (otlp_span, _) = _otlp(egress).resource_spans[0].scope_spans[0].spans
    assert otlp_span.trace_id.hex() == trace.trace_id
    root, llm = _exported(egress)
    request_id = f"tr-{trace.trace_id}"
    assert root.trace_id == request_id
    assert llm.trace_id == request_id
    assert (root.span_id, root.parent_id) == (trace.spans[0].span_id, None)
    assert (llm.span_id, llm.parent_id) == (trace.spans[1].span_id, trace.spans[0].span_id)
    assert root.span_type == "CHAIN"
    assert llm.span_type == "LLM"
    assert (root.start_time_ns, root.end_time_ns) == (1790841600000000000, 1790841602000000000)
    assert root.status.status_code == SpanStatusCode.OK
    assert root.inputs == {"query": "What is Dify?"}
    assert root.outputs == "An LLM application platform."
    assert root.get_attribute("message_id") == MESSAGE_ID
    assert root.get_attribute("tenant_id") == "tenant-1"
    assert root.get_attribute(SpanAttributeKey.EXPERIMENT_ID) == "42"
    assert root.get_attribute(SpanAttributeKey.SESSION_ID) == "conversation-1"
    assert root.get_attribute(SpanAttributeKey.USER_ID) == "end-user-1"
    assert root.get_attribute(SpanAttributeKey.CHAT_USAGE) is None
    assert llm.get_attribute(SpanAttributeKey.SESSION_ID) is None
    assert llm.inputs == [{"role": "user", "content": "What is Dify?"}]
    assert llm.model_name == "gpt-4o"
    assert llm.get_attribute(SpanAttributeKey.MODEL_PROVIDER) == "openai"
    usage = {"input_tokens": 12, "output_tokens": 8, "total_tokens": 20}
    assert _stored_attribute(llm, SpanAttributeKey.CHAT_USAGE) == usage
    assert _stored_attribute(llm, SpanAttributeKey.LLM_COST) == {"total_cost": 0.0004}
    assert result.trace_id == request_id
    assert result.span_urls == {}
    assert result.trace_url is not None
    link = urlsplit(result.trace_url)
    path, _, query = link.fragment.partition("?")
    assert f"{link.scheme}://{link.netloc}{link.path}" == "https://mlflow.example/proxy/"
    assert path == "/experiments/42/traces"
    assert parse_qs(query) == {
        "traceId": [request_id],
        "selectedTraceId": [request_id],
        "selectedEvaluationId": [request_id],
    }


def test_send_without_credentials_sends_no_authorization() -> None:
    provider, egress = _provider(ACK)
    provider.send(MLflowConfig(tracking_uri="http://localhost:5000/", username="admin"), message_trace())
    (sent,) = egress.requests
    assert sent.url == "http://localhost:5000/v1/traces"
    assert sent.headers["x-mlflow-experiment-id"] == "0"
    assert "Authorization" not in sent.headers


def test_workflow_spans_keep_hierarchy_and_errors() -> None:
    provider, egress = _provider(ACK)
    trace = workflow_trace()

    provider.send(CONFIG, trace)

    run, llm, tool = _exported(egress)
    assert llm.parent_id == run.span_id
    assert tool.parent_id == llm.span_id
    assert tool.span_type == "TOOL"
    assert run.status.status_code == SpanStatusCode.ERROR
    assert run.status.description == "Tool failed"
    assert [(event.name, event.attributes) for event in tool.events] == [
        ("exception", {"exception.type": "Error", "exception.message": "Tool failed"})
    ]
    assert llm.status.status_code == SpanStatusCode.OK
    assert llm.events == []
    assert run.get_attribute(SpanAttributeKey.SESSION_ID) == WORKFLOW_RUN_ID
    assert run.get_attribute(SpanAttributeKey.USER_ID) == "account-1"
    assert run.get_attribute("workflow_run_id") == WORKFLOW_RUN_ID
    assert llm.get_attribute("node_type") == "llm"
    assert llm.get_attribute(SpanAttributeKey.LLM_COST) is None


def test_usage_and_cost_are_reported_by_model_calls_only_and_in_usd() -> None:
    trace = message_trace()
    usage = TokenUsage(prompt_tokens=12, completion_tokens=8, total_tokens=20)
    trace = _with_span(trace, 0, trace.spans[0].model_copy(update={"usage": usage}))
    trace = _with_span(trace, 1, trace.spans[1].model_copy(update={"cost": Cost(amount=0.03, currency="CNY")}))
    provider, egress = _provider(ACK)

    provider.send(CONFIG, trace)

    root, llm = _exported(egress)
    assert root.get_attribute(SpanAttributeKey.CHAT_USAGE) is None
    assert llm.get_attribute(SpanAttributeKey.CHAT_USAGE) == {
        "input_tokens": 12,
        "output_tokens": 8,
        "total_tokens": 20,
    }
    assert llm.get_attribute(SpanAttributeKey.LLM_COST) is None


FLAT_TOOL = {
    "type": "function",
    "name": "calculate",
    "description": "Add numbers",
    "parameters": {"type": "object", "properties": {"value": {"type": "integer"}}, "$comment": "kept"},
    "strict": True,
}
NESTED_TOOL = {"type": "function", "function": {"name": "already_nested", "description": "Nested definition"}}


@pytest.mark.parametrize(
    ("definitions", "expected"),
    [
        (
            [FLAT_TOOL, NESTED_TOOL],
            [{"type": "function", "function": {k: v for k, v in FLAT_TOOL.items() if k != "type"}}, NESTED_TOOL],
        ),
        (json.dumps([NESTED_TOOL]), [NESTED_TOOL]),
        ([None, 12, {"type": "other"}, {"type": "function"}, {**FLAT_TOOL, "parameters": "schema"}], []),
        ("not json", None),
    ],
)
def test_tool_definitions_become_native_chat_tools(definitions: JsonValue, expected: JsonValue) -> None:
    trace = message_trace()
    llm = trace.spans[1]
    attributes = {**llm.attributes, "gen_ai.tool.definitions": definitions}
    provider, egress = _provider(ACK)

    provider.send(CONFIG, _with_span(trace, 1, llm.model_copy(update={"attributes": attributes})))

    _, exported = _exported(egress)
    assert exported.get_attribute(SpanAttributeKey.CHAT_TOOLS) == expected
    assert exported.get_attribute("gen_ai.tool.definitions") == definitions


def test_native_chat_tools_take_precedence() -> None:
    native = [{"type": "function", "function": {"name": "native"}}]
    trace = message_trace()
    llm = trace.spans[1]
    attributes = {**llm.attributes, SpanAttributeKey.CHAT_TOOLS: native, "gen_ai.tool.definitions": [FLAT_TOOL]}
    provider, egress = _provider(ACK)

    provider.send(CONFIG, _with_span(trace, 1, llm.model_copy(update={"attributes": attributes})))

    _, exported = _exported(egress)
    assert exported.get_attribute(SpanAttributeKey.CHAT_TOOLS) == native


def test_fragment_is_sent_as_its_own_trace_linked_to_its_parent() -> None:
    provider, egress = _provider(ACK)
    fragment = tool_fragment()
    assert fragment.parent is not None
    own_trace_id = trace_id_for(f"{fragment.trace_id}:{fragment.root.span_id}")

    result = provider.send(CONFIG, fragment)

    (otlp_span,) = _otlp(egress).resource_spans[0].scope_spans[0].spans
    assert otlp_span.trace_id.hex() == own_trace_id
    assert otlp_span.parent_span_id == b""
    (tool,) = _exported(egress)
    assert tool.trace_id == f"tr-{own_trace_id}"
    assert tool.span_id == fragment.root.span_id
    assert tool.parent_id is None
    assert tool.get_attribute("dify.parent_trace_id") == fragment.trace_id
    assert tool.get_attribute("dify.parent_span_id") == fragment.parent.span_id
    assert tool.get_attribute(SpanAttributeKey.SESSION_ID) == "conversation-1"
    assert result.trace_id == f"tr-{own_trace_id}"
    assert own_trace_id != fragment.trace_id


def test_runs_that_share_a_caller_trace_id_become_separate_traces() -> None:
    first = message_trace().model_copy(update={"external_trace_id": "caller-trace"})
    second = workflow_trace().model_copy(update={"external_trace_id": "caller-trace"})
    provider, _ = _provider(ACK, ACK)

    first_result = provider.send(CONFIG, first)
    second_result = provider.send(CONFIG, second)

    assert first_result.trace_id != second_result.trace_id
    assert first_result.trace_id == f"tr-{trace_id_for(f'{first.trace_id}:{first.root.span_id}')}"


def test_runs_without_a_caller_trace_id_keep_their_own_trace_id() -> None:
    provider, _ = _provider(ACK)
    trace = message_trace()

    assert provider.send(CONFIG, trace).trace_id == f"tr-{trace.trace_id}"


def test_redelivery_keeps_identifiers() -> None:
    first, first_egress = _provider(ACK)
    second, second_egress = _provider(ACK)
    assert first.send(CONFIG, tool_fragment()) == second.send(CONFIG, tool_fragment())
    assert first_egress.requests[0].content == second_egress.requests[0].content


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (_ack(1), ExportOutcomeUnknownError),
        (
            EgressResponse(status_code=200, headers={"content-type": "application/json"}, content=b"[]"),
            ExportOutcomeUnknownError,
        ),
        (response(400, {"error_code": "INVALID_PARAMETER_VALUE"}), ExportRejectedError),
        (response(401, {}), ExportRejectedError),
        (response(503, {}), ExportRetryableError),
        (EgressError("connection reset", request_sent=True), ExportOutcomeUnknownError),
        (EgressError("connection refused", request_sent=False), ExportRetryableError),
        (EgressBlockedError("private address"), ExportRejectedError),
    ],
)
def test_send_failures_are_classified(outcome: EgressResponse | Exception, expected: type[Exception]) -> None:
    provider, _ = _provider(outcome)
    with pytest.raises(expected) as caught:
        provider.send(CONFIG, message_trace())
    assert "s3cret" not in str(caught.value)


@pytest.mark.parametrize(
    "update",
    [{"inputs": {"score": float("nan")}}, {"attributes": {"count": 2**70}}],
)
def test_unencodable_traces_are_rejected_before_sending(update: dict[str, JsonValue]) -> None:
    trace = message_trace()
    provider, egress = _provider()
    with pytest.raises(ExportRejectedError):
        provider.send(CONFIG, _with_span(trace, 0, trace.spans[0].model_copy(update=update)))
    assert egress.requests == []
