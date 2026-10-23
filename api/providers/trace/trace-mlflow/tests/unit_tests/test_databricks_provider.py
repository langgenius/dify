import base64
import json
from typing import Any

import pytest
from dify_trace_mlflow.config import DatabricksConfig
from dify_trace_mlflow.provider import DatabricksProvider
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.ids import trace_id_for
from dify_trace_sdk.provider import SendResult
from dify_trace_sdk.testing import RecordedRequest, RecordingEgress, message_trace, response, tool_fragment
from mlflow.entities import TraceData
from mlflow.tracing.constant import SpanAttributeKey

CONFIG = DatabricksConfig(experiment_id="42", host="https://dbc.example", personal_access_token="dapi-pat")
OAUTH_CONFIG = DatabricksConfig(
    experiment_id="42", host="https://dbc.example", client_id="client", client_secret="client-secret"
)
CLIENT_AUTH = "Basic " + base64.b64encode(b"client:client-secret").decode()
TOKEN = response(200, {"access_token": "oauth-token", "token_type": "Bearer", "expires_in": 3600})
EXPERIMENT = response(200, {"experiment": {"experiment_id": "42", "lifecycle_stage": "active"}})
SERVER_TRACE_ID = "tr-abcdef0123456789abcdef0123456789"
STARTED = response(200, {"trace": {"trace_info": {"trace_id": SERVER_TRACE_ID}}})
SIGNED_URL = "https://storage.example/traces/data?sig=signature"
STORED = response(201, b"")


def _provider(*responses: EgressResponse | Exception) -> tuple[DatabricksProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=None)
    return DatabricksProvider(egress), egress


def _credentials(credential_type: str, headers: dict[str, str]) -> EgressResponse:
    credential_headers = [{"name": name, "value": value} for name, value in headers.items()]
    return response(
        200, {"credential_info": {"signed_uri": SIGNED_URL, "type": credential_type, "headers": credential_headers}}
    )


def _json(sent: RecordedRequest) -> Any:
    return json.loads(sent.content or b"null")


def test_verify_reads_the_experiment_with_a_personal_access_token() -> None:
    provider, egress = _provider(EXPERIMENT)
    config = DatabricksConfig(experiment_id="042", host=" https://dbc.example/ ", personal_access_token="dapi-pat")

    verified = provider.verify(config)

    assert verified.host == "https://dbc.example"
    assert verified.experiment_id == "42"
    (sent,) = egress.requests
    assert sent.method == "GET"
    assert sent.url == "https://dbc.example/api/2.0/mlflow/experiments/get?experiment_id=42"
    assert sent.headers == {"Accept": "application/json", "Authorization": "Bearer dapi-pat"}


def test_verify_prefers_oauth_credentials() -> None:
    provider, egress = _provider(TOKEN, EXPERIMENT)

    provider.verify(OAUTH_CONFIG.model_copy(update={"personal_access_token": "dapi-pat"}))

    token, experiment = egress.requests
    assert (token.method, token.url) == ("POST", "https://dbc.example/oidc/v1/token")
    assert token.headers["Authorization"] == CLIENT_AUTH
    assert token.headers["Content-Type"] == "application/x-www-form-urlencoded"
    assert token.content == b"grant_type=client_credentials&scope=all-apis"
    assert experiment.headers["Authorization"] == "Bearer oauth-token"


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
    provider, egress = _provider()
    config = DatabricksConfig.model_validate({**CONFIG.model_dump(), **values})
    with pytest.raises(VerificationError) as caught:
        provider.verify(config)
    assert caught.value.code == code
    assert egress.requests == []


@pytest.mark.parametrize(
    ("outcome", "code"),
    [
        (response(401, {}), "authentication_failed"),
        (response(403, {}), "permission_denied"),
        (response(404, {}), "experiment_not_found_or_inaccessible"),
        (response(500, {}), "endpoint_unavailable"),
        (response(200, b"not json"), "malformed_response"),
        (response(200, {"experiment": {"experiment_id": "7", "lifecycle_stage": "active"}}), "experiment_id_mismatch"),
        (response(200, {"experiment": {"experiment_id": "42", "lifecycle_stage": "deleted"}}), "experiment_not_active"),
        (EgressError("read timeout", request_sent=True), "connection_failed"),
    ],
)
def test_verify_failures_have_stable_codes(outcome: EgressResponse | Exception, code: str) -> None:
    provider, _ = _provider(outcome)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == code


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
    provider, egress = _provider(outcome)
    with pytest.raises(VerificationError) as caught:
        provider.verify(OAUTH_CONFIG)
    assert caught.value.code == code
    assert len(egress.requests) == 1


def test_project_url_is_normalized_without_requests() -> None:
    provider, egress = _provider()
    config = DatabricksConfig(experiment_id="042", host="https://dbc.example/")
    assert provider.project_url(config) == "https://dbc.example/ml/experiments/42/traces"
    assert provider.project_url(DatabricksConfig(experiment_id="42", host="dbc.example")) is None
    assert egress.requests == []


def test_trace_metadata_is_started_before_the_artifact_upload() -> None:
    provider, egress = _provider(STARTED, _credentials("AWS_PRESIGNED_URL", {}), STORED)
    trace = message_trace()

    result = provider.send(CONFIG, trace)

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
    assert credentials.url == f"https://dbc.example/api/2.0/mlflow/traces/{SERVER_TRACE_ID}/credentials-for-data-upload"
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
                ("PATCH", f"{SIGNED_URL}&action=append&position=0&flush=true", {"x-ms-version": "2021-08-06"}, True),
            ],
        ),
    ],
)
def test_artifact_upload_follows_the_credential_type(
    credential_type: str,
    credential_headers: dict[str, str],
    uploads: list[tuple[str, str, dict[str, str], bool]],
) -> None:
    provider, egress = _provider(STARTED, _credentials(credential_type, credential_headers), *[STORED for _ in uploads])

    provider.send(CONFIG, message_trace())

    sent = egress.requests[2:]
    assert [(request.method, request.url, request.headers, request.content is not None) for request in sent] == uploads
    assert all(request.sensitive_url for request in sent)
    assert len(TraceData.from_dict(_json(sent[-1])).spans) == 2


def test_oauth_token_is_exchanged_before_export() -> None:
    provider, egress = _provider(TOKEN, STARTED, _credentials("GCP_SIGNED_URL", {}), STORED)

    provider.send(OAUTH_CONFIG, message_trace())

    token, start, credentials, upload = egress.requests
    assert (token.method, token.url) == ("POST", "https://dbc.example/oidc/v1/token")
    assert token.headers["Authorization"] == CLIENT_AUTH
    assert token.content == b"grant_type=client_credentials&scope=all-apis"
    assert start.headers["Authorization"] == "Bearer oauth-token"
    assert credentials.headers["Authorization"] == "Bearer oauth-token"
    assert "Authorization" not in upload.headers


def test_fragment_is_its_own_databricks_trace() -> None:
    fragment = tool_fragment()
    assert fragment.parent is not None
    own_trace_id = f"tr-{trace_id_for(f'{fragment.trace_id}:{fragment.root.span_id}')}"
    provider, egress = _provider(
        response(200, {"trace": {"trace_info": {"trace_id": own_trace_id}}}),
        _credentials("GCP_SIGNED_URL", {}),
        STORED,
    )

    result = provider.send(CONFIG, fragment)

    start, _, upload = egress.requests
    assert _json(start)["trace"]["trace_info"]["trace_id"] == own_trace_id
    assert _json(start)["trace"]["trace_info"]["tags"] == {"mlflow.traceName": "weather"}
    (tool,) = TraceData.from_dict(_json(upload)).spans
    assert tool.trace_id == own_trace_id
    assert tool.parent_id is None
    assert tool.get_attribute("dify.parent_trace_id") == fragment.trace_id
    assert tool.get_attribute("dify.parent_span_id") == fragment.parent.span_id
    assert result.trace_id == own_trace_id


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
    provider, egress = _provider(outcome)
    with pytest.raises(expected) as caught:
        provider.send(OAUTH_CONFIG, message_trace())
    assert "client-secret" not in str(caught.value)
    assert len(egress.requests) == 1


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
    provider, egress = _provider(*responses)
    with pytest.raises(expected) as caught:
        provider.send(CONFIG, message_trace())
    assert "dapi-pat" not in str(caught.value)
    assert len(egress.requests) == 1


@pytest.mark.parametrize(
    "responses",
    [
        [response(503, {})],
        [response(200, b"not json")],
        [_credentials("NOT_A_CREDENTIAL_TYPE", {})],
        [response(200, {"credential_info": {"signed_uri": "ftp://storage.example/data", "type": "GCP_SIGNED_URL"}})],
        [_credentials("AWS_PRESIGNED_URL", {}), response(403, {})],
        [_credentials("AWS_PRESIGNED_URL", {}), EgressError("connection refused", request_sent=False)],
        [_credentials("AZURE_ADLS_GEN2_SAS_URI", {}), STORED, response(500, {})],
    ],
)
def test_incomplete_artifact_after_accepted_metadata_is_an_unknown_outcome(
    responses: list[EgressResponse | Exception],
) -> None:
    provider, egress = _provider(STARTED, *responses)
    with pytest.raises(ExportOutcomeUnknownError, match="metadata"):
        provider.send(CONFIG, message_trace())
    assert len(egress.requests) == 1 + len(responses)


def test_missing_credentials_are_rejected_without_requests() -> None:
    provider, egress = _provider()
    with pytest.raises(ExportRejectedError):
        provider.send(DatabricksConfig(experiment_id="42", host="https://dbc.example"), message_trace())
    assert egress.requests == []


def test_unencodable_traces_are_rejected_before_sending() -> None:
    trace = message_trace()
    child = trace.spans[1].model_copy(update={"outputs": {"score": float("inf")}})
    provider, egress = _provider()
    with pytest.raises(ExportRejectedError):
        provider.send(CONFIG, trace.model_copy(update={"spans": (trace.spans[0], child)}))
    assert egress.requests == []
