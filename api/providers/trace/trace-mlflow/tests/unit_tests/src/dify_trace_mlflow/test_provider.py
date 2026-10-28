import ast
import base64
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import dify_trace_mlflow
import pytest
from dify_trace_mlflow.config import DatabricksConfig, MLflowConfig
from dify_trace_mlflow.provider import DatabricksProvider, MLflowProvider
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
from dify_trace_sdk.provider import SendResult
from dify_trace_sdk.testing import (
    MESSAGE_ID,
    WORKFLOW_RUN_ID,
    RecordedRequest,
    RecordingEgress,
    message_trace,
    response,
    tool_fragment,
    workflow_trace,
)
from mlflow.entities import Span as MlflowSpan
from mlflow.entities import SpanStatusCode, TraceData
from mlflow.tracing.constant import SpanAttributeKey
from mlflow.tracing.otel.translation import translate_span_when_storing
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from pydantic import JsonValue

MLFLOW_CONFIG = MLflowConfig(
    tracking_uri="https://mlflow.example/proxy", experiment_id="42", username="admin", password="s3cret"
)
BASIC_AUTH = "Basic " + base64.b64encode(b"admin:s3cret").decode()
ACK = EgressResponse(status_code=200, headers={"content-type": "application/x-protobuf"}, content=b"")
MLFLOW_EXPERIMENT = {"experiment": {"experiment_id": "42", "name": "Dify", "lifecycle_stage": "active"}}


def _mlflow_provider(*responses: EgressResponse | Exception) -> tuple[MLflowProvider, RecordingEgress]:
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


FLAT_TOOL = {
    "type": "function",
    "name": "calculate",
    "description": "Add numbers",
    "parameters": {"type": "object", "properties": {"value": {"type": "integer"}}, "$comment": "kept"},
    "strict": True,
}
NESTED_TOOL = {"type": "function", "function": {"name": "already_nested", "description": "Nested definition"}}


class TestMLflowProvider:
    @staticmethod
    def test_verify_reads_the_experiment_and_normalizes_the_destination() -> None:
        provider, egress = _mlflow_provider(response(200, MLFLOW_EXPERIMENT))
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

    @staticmethod
    def test_verify_without_credentials_sends_no_authorization() -> None:
        provider, egress = _mlflow_provider(response(200, MLFLOW_EXPERIMENT))
        provider.verify(MLflowConfig(tracking_uri="http://localhost:5000", experiment_id="42"))
        (sent,) = egress.requests
        assert sent.headers == {"Accept": "application/json"}

    @staticmethod
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
            (
                response(200, {"experiment": {"experiment_id": "7", "lifecycle_stage": "active"}}),
                "experiment_id_mismatch",
            ),
            (
                response(200, {"experiment": {"experiment_id": "42", "lifecycle_stage": "deleted"}}),
                "experiment_not_active",
            ),
            (EgressError("connection refused", request_sent=False), "connection_failed"),
            (EgressBlockedError("private address"), "connection_failed"),
        ],
    )
    def test_verify_failures_have_stable_codes(outcome: EgressResponse | Exception, code: str) -> None:
        provider, _ = _mlflow_provider(outcome)
        with pytest.raises(VerificationError) as caught:
            provider.verify(MLFLOW_CONFIG)
        assert caught.value.code == code

    @staticmethod
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
        provider, egress = _mlflow_provider()
        config = MLflowConfig.model_validate({**MLFLOW_CONFIG.model_dump(), **values})
        with pytest.raises(VerificationError) as caught:
            provider.verify(config)
        assert caught.value.code == code
        assert egress.requests == []

    @staticmethod
    def test_project_url_is_normalized_without_requests() -> None:
        provider, egress = _mlflow_provider()
        config = MLflowConfig(tracking_uri="https://MLflow.Example/proxy/", experiment_id="042")
        assert provider.project_url(config) == "https://mlflow.example/proxy/#/experiments/42/traces"
        assert provider.project_url(MLflowConfig(tracking_uri="https://mlflow.example/a/../b")) is None
        assert egress.requests == []

    @staticmethod
    def test_message_trace_is_exported_as_mlflow_spans_over_otlp() -> None:
        provider, egress = _mlflow_provider(ACK)
        trace = message_trace()

        result = provider.send(MLFLOW_CONFIG, trace)

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

    @staticmethod
    def test_send_without_credentials_sends_no_authorization() -> None:
        provider, egress = _mlflow_provider(ACK)
        provider.send(MLflowConfig(tracking_uri="http://localhost:5000/", username="admin"), message_trace())
        (sent,) = egress.requests
        assert sent.url == "http://localhost:5000/v1/traces"
        assert sent.headers["x-mlflow-experiment-id"] == "0"
        assert "Authorization" not in sent.headers

    @staticmethod
    def test_workflow_spans_keep_hierarchy_and_errors() -> None:
        provider, egress = _mlflow_provider(ACK)
        trace = workflow_trace()

        provider.send(MLFLOW_CONFIG, trace)

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

    @staticmethod
    def test_usage_and_cost_are_reported_by_model_calls_only_and_in_usd() -> None:
        trace = message_trace()
        usage = TokenUsage(prompt_tokens=12, completion_tokens=8, total_tokens=20)
        trace = _with_span(trace, 0, trace.spans[0].model_copy(update={"usage": usage}))
        trace = _with_span(trace, 1, trace.spans[1].model_copy(update={"cost": Cost(amount=0.03, currency="CNY")}))
        provider, egress = _mlflow_provider(ACK)

        provider.send(MLFLOW_CONFIG, trace)

        root, llm = _exported(egress)
        assert root.get_attribute(SpanAttributeKey.CHAT_USAGE) is None
        assert llm.get_attribute(SpanAttributeKey.CHAT_USAGE) == {
            "input_tokens": 12,
            "output_tokens": 8,
            "total_tokens": 20,
        }
        assert llm.get_attribute(SpanAttributeKey.LLM_COST) is None

    @staticmethod
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
        provider, egress = _mlflow_provider(ACK)

        provider.send(MLFLOW_CONFIG, _with_span(trace, 1, llm.model_copy(update={"attributes": attributes})))

        _, exported = _exported(egress)
        assert exported.get_attribute(SpanAttributeKey.CHAT_TOOLS) == expected
        assert exported.get_attribute("gen_ai.tool.definitions") == definitions

    @staticmethod
    def test_native_chat_tools_take_precedence() -> None:
        native = [{"type": "function", "function": {"name": "native"}}]
        trace = message_trace()
        llm = trace.spans[1]
        attributes = {**llm.attributes, SpanAttributeKey.CHAT_TOOLS: native, "gen_ai.tool.definitions": [FLAT_TOOL]}
        provider, egress = _mlflow_provider(ACK)

        provider.send(MLFLOW_CONFIG, _with_span(trace, 1, llm.model_copy(update={"attributes": attributes})))

        _, exported = _exported(egress)
        assert exported.get_attribute(SpanAttributeKey.CHAT_TOOLS) == native

    @staticmethod
    def test_fragment_is_sent_as_its_own_trace_linked_to_its_parent() -> None:
        provider, egress = _mlflow_provider(ACK)
        fragment = tool_fragment()
        assert fragment.parent is not None
        own_trace_id = trace_id_for(f"{fragment.trace_id}:{fragment.root.span_id}")

        result = provider.send(MLFLOW_CONFIG, fragment)

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

    @staticmethod
    def test_runs_that_share_a_caller_trace_id_become_separate_traces() -> None:
        first = message_trace().model_copy(update={"external_trace_id": "caller-trace"})
        second = workflow_trace().model_copy(update={"external_trace_id": "caller-trace"})
        provider, _ = _mlflow_provider(ACK, ACK)

        first_result = provider.send(MLFLOW_CONFIG, first)
        second_result = provider.send(MLFLOW_CONFIG, second)

        assert first_result.trace_id != second_result.trace_id
        assert first_result.trace_id == f"tr-{trace_id_for(f'{first.trace_id}:{first.root.span_id}')}"

    @staticmethod
    def test_runs_without_a_caller_trace_id_keep_their_own_trace_id() -> None:
        provider, _ = _mlflow_provider(ACK)
        trace = message_trace()

        assert provider.send(MLFLOW_CONFIG, trace).trace_id == f"tr-{trace.trace_id}"

    @staticmethod
    def test_redelivery_keeps_identifiers() -> None:
        first, first_egress = _mlflow_provider(ACK)
        second, second_egress = _mlflow_provider(ACK)
        assert first.send(MLFLOW_CONFIG, tool_fragment()) == second.send(MLFLOW_CONFIG, tool_fragment())
        assert first_egress.requests[0].content == second_egress.requests[0].content

    @staticmethod
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
        provider, _ = _mlflow_provider(outcome)
        with pytest.raises(expected) as caught:
            provider.send(MLFLOW_CONFIG, message_trace())
        assert "s3cret" not in str(caught.value)

    @staticmethod
    @pytest.mark.parametrize(
        "update",
        [{"inputs": {"score": float("nan")}}, {"attributes": {"count": 2**70}}],
    )
    def test_unencodable_traces_are_rejected_before_sending(update: dict[str, JsonValue]) -> None:
        trace = message_trace()
        provider, egress = _mlflow_provider()
        with pytest.raises(ExportRejectedError):
            provider.send(MLFLOW_CONFIG, _with_span(trace, 0, trace.spans[0].model_copy(update=update)))
        assert egress.requests == []


DATABRICKS_CONFIG = DatabricksConfig(experiment_id="42", host="https://dbc.example", personal_access_token="dapi-pat")
OAUTH_CONFIG = DatabricksConfig(
    experiment_id="42", host="https://dbc.example", client_id="client", client_secret="client-secret"
)
CLIENT_AUTH = "Basic " + base64.b64encode(b"client:client-secret").decode()
TOKEN = response(200, {"access_token": "oauth-token", "token_type": "Bearer", "expires_in": 3600})
DATABRICKS_EXPERIMENT = response(200, {"experiment": {"experiment_id": "42", "lifecycle_stage": "active"}})
SERVER_TRACE_ID = "tr-abcdef0123456789abcdef0123456789"
STARTED = response(200, {"trace": {"trace_info": {"trace_id": SERVER_TRACE_ID}}})
SIGNED_URL = "https://storage.example/traces/data?sig=signature"
STORED = response(201, b"")


def _databricks_provider(*responses: EgressResponse | Exception) -> tuple[DatabricksProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=None)
    return DatabricksProvider(egress), egress


def _credentials(credential_type: str, headers: dict[str, str]) -> EgressResponse:
    credential_headers = [{"name": name, "value": value} for name, value in headers.items()]
    return response(
        200, {"credential_info": {"signed_uri": SIGNED_URL, "type": credential_type, "headers": credential_headers}}
    )


def _json(sent: RecordedRequest) -> Any:
    return json.loads(sent.content or b"null")


class TestDatabricksProvider:
    @staticmethod
    def test_verify_reads_the_experiment_with_a_personal_access_token() -> None:
        provider, egress = _databricks_provider(DATABRICKS_EXPERIMENT)
        config = DatabricksConfig(experiment_id="042", host=" https://dbc.example/ ", personal_access_token="dapi-pat")

        verified = provider.verify(config)

        assert verified.host == "https://dbc.example"
        assert verified.experiment_id == "42"
        (sent,) = egress.requests
        assert sent.method == "GET"
        assert sent.url == "https://dbc.example/api/2.0/mlflow/experiments/get?experiment_id=42"
        assert sent.headers == {"Accept": "application/json", "Authorization": "Bearer dapi-pat"}

    @staticmethod
    def test_verify_prefers_oauth_credentials() -> None:
        provider, egress = _databricks_provider(TOKEN, DATABRICKS_EXPERIMENT)

        provider.verify(OAUTH_CONFIG.model_copy(update={"personal_access_token": "dapi-pat"}))

        token, experiment = egress.requests
        assert (token.method, token.url) == ("POST", "https://dbc.example/oidc/v1/token")
        assert token.headers["Authorization"] == CLIENT_AUTH
        assert token.headers["Content-Type"] == "application/x-www-form-urlencoded"
        assert token.content == b"grant_type=client_credentials&scope=all-apis"
        assert experiment.headers["Authorization"] == "Bearer oauth-token"

    @staticmethod
    @pytest.mark.parametrize(
        ("values", "code"),
        [
            ({"host": "http://dbc.example"}, "invalid_workspace_url"),
            ({"host": "dbc.example"}, "invalid_workspace_url"),
            ({"host": "https://dbc.example/ml"}, "invalid_workspace_url"),
            ({"host": "https://dbc.example?o=1"}, "invalid_workspace_url"),
            ({"host": "https://token@dbc.example"}, "invalid_workspace_url"),
            ({"host": "https://dbc.example:99999"}, "invalid_workspace_url"),
            ({"personal_access_token": None}, "authentication_failed"),
            ({"personal_access_token": "  "}, "authentication_failed"),
            ({"personal_access_token": None, "client_id": "client"}, "authentication_failed"),
        ],
    )
    def test_verify_rejects_unusable_configurations_without_requests(values: dict[str, str | None], code: str) -> None:
        provider, egress = _databricks_provider()
        config = DatabricksConfig.model_validate({**DATABRICKS_CONFIG.model_dump(), **values})
        with pytest.raises(VerificationError) as caught:
            provider.verify(config)
        assert caught.value.code == code
        assert egress.requests == []

    @staticmethod
    @pytest.mark.parametrize(
        ("outcome", "code"),
        [
            (response(401, {}), "authentication_failed"),
            (response(403, {}), "permission_denied"),
            (response(404, {}), "experiment_not_found_or_inaccessible"),
            (response(500, {}), "endpoint_unavailable"),
            (response(200, b"not json"), "malformed_response"),
            (
                response(200, {"experiment": {"experiment_id": "7", "lifecycle_stage": "active"}}),
                "experiment_id_mismatch",
            ),
            (
                response(200, {"experiment": {"experiment_id": "42", "lifecycle_stage": "deleted"}}),
                "experiment_not_active",
            ),
            (EgressError("read timeout", request_sent=True), "connection_failed"),
        ],
    )
    def test_verify_failures_have_stable_codes(outcome: EgressResponse | Exception, code: str) -> None:
        provider, _ = _databricks_provider(outcome)
        with pytest.raises(VerificationError) as caught:
            provider.verify(DATABRICKS_CONFIG)
        assert caught.value.code == code

    @staticmethod
    @pytest.mark.parametrize(
        ("outcome", "code"),
        [
            (response(401, {"error": "invalid_client"}), "authentication_failed"),
            (response(404, {}), "endpoint_unavailable"),
            (response(200, {"token_type": "Bearer"}), "authentication_failed"),
            (response(200, {"access_token": "oauth-token", "token_type": "mac"}), "authentication_failed"),
            (response(200, b"not json"), "malformed_response"),
            (EgressError("connection refused", request_sent=False), "connection_failed"),
        ],
    )
    def test_oauth_verification_failures_have_stable_codes(outcome: EgressResponse | Exception, code: str) -> None:
        provider, egress = _databricks_provider(outcome)
        with pytest.raises(VerificationError) as caught:
            provider.verify(OAUTH_CONFIG)
        assert caught.value.code == code
        assert len(egress.requests) == 1

    @staticmethod
    def test_project_url_is_normalized_without_requests() -> None:
        provider, egress = _databricks_provider()
        config = DatabricksConfig(experiment_id="042", host="https://dbc.example/")
        assert provider.project_url(config) == "https://dbc.example/ml/experiments/42/traces"
        assert provider.project_url(DatabricksConfig(experiment_id="42", host="dbc.example")) is None
        assert egress.requests == []

    @staticmethod
    def test_trace_metadata_is_started_before_the_artifact_upload() -> None:
        provider, egress = _databricks_provider(STARTED, _credentials("AWS_PRESIGNED_URL", {}), STORED)
        trace = message_trace()

        result = provider.send(DATABRICKS_CONFIG, trace)

        start, credentials, upload = egress.requests
        assert (start.method, start.url) == ("POST", "https://dbc.example/api/3.0/mlflow/traces")
        assert start.headers["Authorization"] == "Bearer dapi-pat"
        assert start.headers["Content-Type"] == "application/json"
        info = _json(start)["trace"]["trace_info"]
        assert info["trace_id"] == f"tr-{trace.trace_id}"
        assert info["client_request_id"] == trace.trace_id
        assert info["trace_location"] == {"type": "MLFLOW_EXPERIMENT", "mlflow_experiment": {"experiment_id": "42"}}
        assert info["state"] == "OK"
        assert info["request_time"] == "2026-10-01T08:00:00Z"
        assert info["execution_duration"] == "2s"
        assert info["request_preview"] == '{"query": "What is Dify?"}'
        assert info["response_preview"] == '"An LLM application platform."'
        assert info["tags"] == {"mlflow.traceName": "message"}
        metadata = info["trace_metadata"]
        assert metadata["mlflow.trace.session"] == "conversation-1"
        assert metadata["mlflow.trace.user"] == "end-user-1"
        assert json.loads(metadata["mlflow.trace.tokenUsage"]) == {
            "input_tokens": 12,
            "output_tokens": 8,
            "total_tokens": 20,
        }
        assert json.loads(metadata["mlflow.trace.cost"]) == {"total_cost": 0.0004}
        assert credentials.method == "GET"
        assert (
            credentials.url
            == f"https://dbc.example/api/2.0/mlflow/traces/{SERVER_TRACE_ID}/credentials-for-data-upload"
        )
        assert credentials.headers["Authorization"] == "Bearer dapi-pat"
        assert "Authorization" not in upload.headers
        root, llm = TraceData.from_dict(_json(upload)).spans
        assert root.trace_id == SERVER_TRACE_ID
        assert llm.trace_id == SERVER_TRACE_ID
        assert (root.span_id, root.parent_id) == (trace.spans[0].span_id, None)
        assert llm.parent_id == root.span_id
        assert root.get_attribute(SpanAttributeKey.SESSION_ID) == "conversation-1"
        assert llm.get_attribute(SpanAttributeKey.CHAT_USAGE) == {
            "input_tokens": 12,
            "output_tokens": 8,
            "total_tokens": 20,
        }
        assert llm.get_attribute(SpanAttributeKey.LLM_COST) == {"total_cost": 0.0004}
        assert result == SendResult(
            trace_id=SERVER_TRACE_ID,
            trace_url=f"https://dbc.example/ml/experiments/42/traces?selectedEvaluationId={SERVER_TRACE_ID}",
            span_urls={},
        )

    @staticmethod
    @pytest.mark.parametrize(
        ("credential_type", "credential_headers", "uploads"),
        [
            (
                "AWS_PRESIGNED_URL",
                {"x-amz-server-side-encryption": "AES256"},
                [("PUT", SIGNED_URL, {"x-amz-server-side-encryption": "AES256"}, True)],
            ),
            ("GCP_SIGNED_URL", {}, [("PUT", SIGNED_URL, {}, True)]),
            (
                "AZURE_SAS_URI",
                {"x-ms-version": "2021-08-06"},
                [("PUT", SIGNED_URL, {"x-ms-version": "2021-08-06", "x-ms-blob-type": "BlockBlob"}, True)],
            ),
            (
                "AZURE_ADLS_GEN2_SAS_URI",
                {"x-ms-version": "2021-08-06", "x-ms-blob-type": "BlockBlob"},
                [
                    ("PUT", f"{SIGNED_URL}&resource=file", {"x-ms-version": "2021-08-06"}, False),
                    (
                        "PATCH",
                        f"{SIGNED_URL}&action=append&position=0&flush=true",
                        {"x-ms-version": "2021-08-06"},
                        True,
                    ),
                ],
            ),
        ],
    )
    def test_artifact_upload_follows_the_credential_type(
        credential_type: str,
        credential_headers: dict[str, str],
        uploads: list[tuple[str, str, dict[str, str], bool]],
    ) -> None:
        provider, egress = _databricks_provider(
            STARTED, _credentials(credential_type, credential_headers), *[STORED for _ in uploads]
        )

        provider.send(DATABRICKS_CONFIG, message_trace())

        sent = egress.requests[2:]
        assert [
            (request.method, request.url, request.headers, request.content is not None) for request in sent
        ] == uploads
        assert all(request.sensitive_url for request in sent)
        assert len(TraceData.from_dict(_json(sent[-1])).spans) == 2

    @staticmethod
    def test_oauth_token_is_exchanged_before_export() -> None:
        provider, egress = _databricks_provider(TOKEN, STARTED, _credentials("GCP_SIGNED_URL", {}), STORED)

        provider.send(OAUTH_CONFIG, message_trace())

        token, start, credentials, upload = egress.requests
        assert (token.method, token.url) == ("POST", "https://dbc.example/oidc/v1/token")
        assert token.headers["Authorization"] == CLIENT_AUTH
        assert token.content == b"grant_type=client_credentials&scope=all-apis"
        assert start.headers["Authorization"] == "Bearer oauth-token"
        assert credentials.headers["Authorization"] == "Bearer oauth-token"
        assert "Authorization" not in upload.headers

    @staticmethod
    def test_fragment_is_its_own_databricks_trace() -> None:
        fragment = tool_fragment()
        assert fragment.parent is not None
        own_trace_id = f"tr-{trace_id_for(f'{fragment.trace_id}:{fragment.root.span_id}')}"
        provider, egress = _databricks_provider(
            response(200, {"trace": {"trace_info": {"trace_id": own_trace_id}}}),
            _credentials("GCP_SIGNED_URL", {}),
            STORED,
        )

        result = provider.send(DATABRICKS_CONFIG, fragment)

        start, _, upload = egress.requests
        assert _json(start)["trace"]["trace_info"]["trace_id"] == own_trace_id
        assert _json(start)["trace"]["trace_info"]["tags"] == {"mlflow.traceName": "weather"}
        (tool,) = TraceData.from_dict(_json(upload)).spans
        assert tool.trace_id == own_trace_id
        assert tool.parent_id is None
        assert tool.get_attribute("dify.parent_trace_id") == fragment.trace_id
        assert tool.get_attribute("dify.parent_span_id") == fragment.parent.span_id
        assert result.trace_id == own_trace_id

    @staticmethod
    @pytest.mark.parametrize(
        ("outcome", "expected"),
        [
            (response(401, {"error": "invalid_client"}), ExportRejectedError),
            (response(503, {}), ExportRetryableError),
            (EgressError("connection reset", request_sent=True), ExportRetryableError),
            (response(200, {"token_type": "Bearer"}), ExportRejectedError),
            (response(200, b"not json"), ExportRejectedError),
        ],
    )
    def test_oauth_failures_export_nothing(outcome: EgressResponse | Exception, expected: type[Exception]) -> None:
        provider, egress = _databricks_provider(outcome)
        with pytest.raises(expected) as caught:
            provider.send(OAUTH_CONFIG, message_trace())
        assert "client-secret" not in str(caught.value)
        assert len(egress.requests) == 1

    @staticmethod
    @pytest.mark.parametrize(
        ("responses", "expected"),
        [
            ([response(503, {})], ExportRetryableError),
            ([response(400, {"error_code": "INVALID_PARAMETER_VALUE"})], ExportRejectedError),
            ([EgressError("connection reset", request_sent=True)], ExportOutcomeUnknownError),
            ([response(200, b"not json")], ExportOutcomeUnknownError),
            ([response(200, {"trace": {}})], ExportOutcomeUnknownError),
        ],
    )
    def test_trace_start_failures_are_classified(
        responses: list[EgressResponse | Exception], expected: type[Exception]
    ) -> None:
        provider, egress = _databricks_provider(*responses)
        with pytest.raises(expected) as caught:
            provider.send(DATABRICKS_CONFIG, message_trace())
        assert "dapi-pat" not in str(caught.value)
        assert len(egress.requests) == 1

    @staticmethod
    @pytest.mark.parametrize(
        "responses",
        [
            [response(503, {})],
            [response(200, b"not json")],
            [_credentials("NOT_A_CREDENTIAL_TYPE", {})],
            [
                response(
                    200, {"credential_info": {"signed_uri": "ftp://storage.example/data", "type": "GCP_SIGNED_URL"}}
                )
            ],
            [_credentials("AWS_PRESIGNED_URL", {}), response(403, {})],
            [_credentials("AWS_PRESIGNED_URL", {}), EgressError("connection refused", request_sent=False)],
            [_credentials("AZURE_ADLS_GEN2_SAS_URI", {}), STORED, response(500, {})],
        ],
    )
    def test_incomplete_artifact_after_accepted_metadata_is_an_unknown_outcome(
        responses: list[EgressResponse | Exception],
    ) -> None:
        provider, egress = _databricks_provider(STARTED, *responses)
        with pytest.raises(ExportOutcomeUnknownError, match="metadata"):
            provider.send(DATABRICKS_CONFIG, message_trace())
        assert len(egress.requests) == 1 + len(responses)

    @staticmethod
    def test_missing_credentials_are_rejected_without_requests() -> None:
        provider, egress = _databricks_provider()
        with pytest.raises(ExportRejectedError):
            provider.send(DatabricksConfig(experiment_id="42", host="https://dbc.example"), message_trace())
        assert egress.requests == []

    @staticmethod
    def test_unencodable_traces_are_rejected_before_sending() -> None:
        trace = message_trace()
        child = trace.spans[1].model_copy(update={"outputs": {"score": float("inf")}})
        provider, egress = _databricks_provider()
        with pytest.raises(ExportRejectedError):
            provider.send(DATABRICKS_CONFIG, trace.model_copy(update={"spans": (trace.spans[0], child)}))
        assert egress.requests == []


CREDENTIALS = response(
    200, {"credential_info": {"signed_uri": "https://storage.example/data?sig=signature", "type": "GCP_SIGNED_URL"}}
)
UPLOADED = response(200, b"")
ALLOWED_IMPORTS = {
    "base64",
    "collections",
    "dify_trace_mlflow",
    "dify_trace_sdk",
    "google",
    "json",
    "mlflow",
    "opentelemetry",
    "pydantic",
    "re",
    "typing",
    "urllib",
}
ALLOWED_MLFLOW_IMPORTS = (
    "mlflow.entities",
    "mlflow.protos.",
    "mlflow.store.tracking.rest_store",
    "mlflow.tracing.constant",
    "mlflow.tracing.utils.otlp",
    "mlflow.utils.rest_utils",
)


def _basic(username: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()


def _experiment(experiment_id: str) -> EgressResponse:
    return response(200, {"experiment": {"experiment_id": experiment_id, "lifecycle_stage": "active"}})


def _started(trace_id: str) -> EgressResponse:
    return response(200, {"trace": {"trace_info": {"trace_id": trace_id}}})


class TestIsolation:
    """One worker process serves many tenants, so nothing may outlive or leak across a call."""

    @staticmethod
    def test_tenants_in_one_process_keep_their_own_credentials_and_leave_the_environment_alone() -> None:
        environment = dict(os.environ)
        token = response(200, {"access_token": "oauth-token-c", "token_type": "Bearer"})
        egress = RecordingEgress(
            [
                *(_experiment("1"), ACK, _experiment("2"), ACK),
                *(token, _experiment("3"), token, _started("tr-c"), CREDENTIALS, UPLOADED),
                *(_experiment("4"), _started("tr-d"), CREDENTIALS, UPLOADED),
            ],
            grpc_target=None,
        )
        mlflow_provider = MLflowProvider(egress)
        databricks_provider = DatabricksProvider(egress)

        for mlflow_config in (
            MLflowConfig(
                tracking_uri="https://a.example", experiment_id="1", username="tenant-a", password="password-a"
            ),
            MLflowConfig(tracking_uri="https://b.example", experiment_id="2"),
        ):
            mlflow_provider.send(mlflow_provider.verify(mlflow_config), message_trace())
        for databricks_config in (
            DatabricksConfig(
                experiment_id="3", host="https://c.example", client_id="client-c", client_secret="secret-c"
            ),
            DatabricksConfig(experiment_id="4", host="https://d.example", personal_access_token="pat-d"),
        ):
            databricks_provider.send(databricks_provider.verify(databricks_config), message_trace())

        assert dict(os.environ) == environment
        authorization: dict[str, set[str | None]] = {}
        for sent in egress.requests:
            authorization.setdefault(urlsplit(sent.url).netloc, set()).add(sent.headers.get("Authorization"))
        assert authorization == {
            "a.example": {_basic("tenant-a", "password-a")},
            "b.example": {None},
            "c.example": {_basic("client-c", "secret-c"), "Bearer oauth-token-c"},
            "d.example": {"Bearer pat-d"},
            "storage.example": {None},
        }

    @staticmethod
    def test_the_package_imports_nothing_from_the_application_or_the_process() -> None:
        for path in Path(dify_trace_mlflow.__file__).parent.glob("*.py"):
            for node in ast.walk(ast.parse(path.read_text())):
                if isinstance(node, ast.Import):
                    modules = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom):
                    modules = [node.module or ""]
                else:
                    continue
                for module in modules:
                    assert module.split(".")[0] in ALLOWED_IMPORTS, f"{path.name} imports {module}"
                    if module.startswith("mlflow"):
                        assert module.startswith(ALLOWED_MLFLOW_IMPORTS), f"{path.name} imports {module}"
