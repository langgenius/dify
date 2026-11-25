"""POST /openapi/v1/mcp: the JSON-RPC envelope, the bearer check and one authentication per request."""

from __future__ import annotations

import io
import json
from collections.abc import Callable
from typing import Protocol

import pytest
from flask import Flask
from flask.testing import FlaskClient
from werkzeug.test import EnvironBuilder, TestResponse, run_wsgi_app

from controllers.openapi import account as account_module
from controllers.openapi import mcp as mcp_module
from controllers.openapi._mcp_call import OpCall, OpResult
from controllers.openapi._mcp_tools import mcp_instructions
from controllers.openapi.auth import router as router_module
from controllers.openapi.mcp import MCP_MAX_BODY_BYTES
from core.mcp import types as mcp_types
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices
from libs.oauth_bearer import AuthContext, InvalidBearerError
from libs.rate_limit import _BearerRateLimited
from services.entities.feature_entities import LicenseStatus
from tests.helpers.unit.controllers.openapi.auth._world import system_features
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld

MCP_PATH = "/openapi/v1/mcp"
PROTOCOL_HEADER = "MCP-Protocol-Version"
UNAUTHORIZED_BODY = {"code": "unauthorized", "message": "invalid bearer", "status": 401}

JSON_RPC_ERROR_BODY = pytest.mark.allow_error_contract_violations


@pytest.fixture(autouse=True)
def _account_op_seams(monkeypatch: pytest.MonkeyPatch, account_application_services: ApplicationServices) -> None:
    """`describe.account` limits per account in Redis and reads services the autouse fixture leaves unbound."""
    monkeypatch.setattr(account_module, "enforce", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(account_module, "application_services", lambda: account_application_services)


def _rpc(method: str, params: dict[str, object] | None = None, request_id: int | None = 1) -> dict[str, object]:
    message: dict[str, object] = {"jsonrpc": "2.0", "method": method}
    if request_id is not None:
        message["id"] = request_id
    if params is not None:
        message["params"] = params
    return message


def _initialize(version: str = "2025-11-25") -> dict[str, object]:
    return _rpc(
        "initialize",
        {"protocolVersion": version, "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}},
    )


def _operation_answer(world: AdmittedWorld) -> TestResponse:
    """What an operation on the surface answers the same caller in the same state."""
    return world.client.get("/openapi/v1/account", headers=world.headers)


def _post(client: FlaskClient, body: object, headers: dict[str, str] | None = None) -> TestResponse:
    return client.post(MCP_PATH, data=json.dumps(body), content_type="application/json", headers=headers or {})


def _error_code(response: TestResponse) -> int:
    return response.get_json()["error"]["code"]


def test_initialize_with_a_good_token_negotiates_and_returns_the_instructions(admitted_bearer: AdmittedWorld) -> None:
    response = _post(admitted_bearer.client, _initialize(), admitted_bearer.headers)

    assert response.status_code == 200
    assert response.content_type.startswith("application/json")
    result = response.get_json()["result"]
    assert result["protocolVersion"] == "2025-06-18"
    assert result["instructions"] == mcp_instructions()


@pytest.mark.parametrize("message", [_initialize(), _rpc("tools/list")], ids=["initialize", "tools/list"])
def test_initialize_and_tools_list_without_a_token_are_http_401_with_www_authenticate(
    openapi_app: Flask, message: dict[str, object]
) -> None:
    response = _post(openapi_app.test_client(), message)

    assert response.status_code == 401
    assert response.get_json() == UNAUTHORIZED_BODY
    assert response.headers["WWW-Authenticate"]


class _RefusingAuthenticator:
    def __init__(self, error: Exception) -> None:
        self.error = error

    def authenticate(self, _token: str) -> AuthContext:
        raise self.error


def test_initialize_with_a_token_that_is_not_real_is_http_401(
    admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    refusing = _RefusingAuthenticator(InvalidBearerError("no such token"))
    monkeypatch.setattr("controllers.openapi.auth.router.get_authenticator", lambda: refusing)

    response = _post(admitted_bearer.client, _initialize(), admitted_bearer.headers)

    assert response.status_code == 401
    assert response.get_json() == UNAUTHORIZED_BODY
    assert response.headers["WWW-Authenticate"]


def test_tools_list_returns_the_four_tools(admitted_bearer: AdmittedWorld) -> None:
    response = _post(admitted_bearer.client, _rpc("tools/list"), admitted_bearer.headers)

    assert response.status_code == 200
    names = [tool["name"] for tool in response.get_json()["result"]["tools"]]
    assert names == ["dify_find", "dify_read", "dify_write", "dify_destructive"]


def test_initialize_runs_no_operation(admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch) -> None:
    def describe_account_must_not_run(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("initialize and tools/list must not run describe.account")

    monkeypatch.setattr(account_module, "enforce", describe_account_must_not_run)

    for message in (_initialize(), _rpc("tools/list")):
        assert _post(admitted_bearer.client, message, admitted_bearer.headers).status_code == 200


@JSON_RPC_ERROR_BODY
def test_a_rate_limited_token_answers_429_with_retry_after(
    admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    limited = _RefusingAuthenticator(_BearerRateLimited(5))
    monkeypatch.setattr("controllers.openapi.auth.router.get_authenticator", lambda: limited)

    response = _post(admitted_bearer.client, _initialize(), admitted_bearer.headers)

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "5"
    assert response.get_json() == _operation_answer(admitted_bearer).get_json()


@JSON_RPC_ERROR_BODY
def test_tools_list_answers_503_when_bearer_auth_is_off(
    admitted_bearer: AdmittedWorld, config_overrides: Callable[..., None]
) -> None:
    config_overrides(ENABLE_OAUTH_BEARER=False)

    response = _post(admitted_bearer.client, _rpc("tools/list"), admitted_bearer.headers)

    assert response.status_code == 503
    assert response.get_json() == _operation_answer(admitted_bearer).get_json()


@JSON_RPC_ERROR_BODY
def test_initialize_answers_403_for_a_broken_licence(
    admitted_bearer: AdmittedWorld, config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        "controllers.openapi.auth.requirements.SystemFeatureService.get_public_system_features",
        lambda: system_features(license_status=LicenseStatus.EXPIRED),
    )

    response = _post(admitted_bearer.client, _initialize(), admitted_bearer.headers)

    assert response.status_code == 403
    assert response.get_json() == _operation_answer(admitted_bearer).get_json()


def test_tools_call_runs_an_operation(admitted_bearer: AdmittedWorld) -> None:
    body = _rpc("tools/call", {"name": "dify_read", "arguments": {"op": "get.workspace", "input": {}}})
    response = _post(admitted_bearer.client, body, admitted_bearer.headers)

    assert response.status_code == 200
    result = response.get_json()["result"]
    assert result["isError"] is False
    rows = json.loads(result["content"][0]["text"])["data"]
    assert [row["id"] for row in rows] == [admitted_bearer.workspace_id]


def test_a_tool_error_is_http_200_with_is_error(admitted_bearer: AdmittedWorld) -> None:
    body = _rpc("tools/call", {"name": "dify_read", "arguments": {"op": "no.such_op", "input": {}}})
    response = _post(admitted_bearer.client, body, admitted_bearer.headers)

    assert response.status_code == 200
    assert response.get_json()["result"]["isError"] is True


def test_an_unknown_tool_is_invalid_params(admitted_bearer: AdmittedWorld) -> None:
    body = _rpc("tools/call", {"name": "dify_nothing", "arguments": {}})
    response = _post(admitted_bearer.client, body, admitted_bearer.headers)

    payload = response.get_json()
    assert _error_code(response) == mcp_types.INVALID_PARAMS
    assert payload["error"]["message"] == "Unknown tool: dify_nothing"
    assert payload["id"] == 1


def test_ping_needs_no_token(openapi_app: Flask) -> None:
    response = _post(openapi_app.test_client(), _rpc("ping"))

    assert response.status_code == 200
    assert response.get_json()["result"] == {}


def test_the_initialized_notification_is_202(openapi_app: Flask) -> None:
    response = _post(openapi_app.test_client(), _rpc("notifications/initialized", request_id=None))

    assert response.status_code == 202
    assert response.get_data() == b""


@JSON_RPC_ERROR_BODY
def test_an_unknown_method_is_method_not_found(admitted_bearer: AdmittedWorld) -> None:
    response = _post(admitted_bearer.client, _rpc("nope/nothing"), admitted_bearer.headers)

    assert response.status_code == 400
    assert _error_code(response) == mcp_types.METHOD_NOT_FOUND


def test_an_unknown_method_without_an_id_is_202(openapi_app: Flask) -> None:
    response = _post(openapi_app.test_client(), _rpc("nope/nothing", request_id=None))

    assert response.status_code == 202


@JSON_RPC_ERROR_BODY
@pytest.mark.parametrize("body", [[], [_rpc("ping")]], ids=["empty-batch", "one-item-batch"])
def test_a_batch_body_is_refused(openapi_app: Flask, body: list[object]) -> None:
    response = _post(openapi_app.test_client(), body)

    assert response.status_code == 400
    assert _error_code(response) == mcp_types.INVALID_REQUEST
    assert response.get_json()["id"] is None


@JSON_RPC_ERROR_BODY
@pytest.mark.parametrize("raw", [b"not json", b'"a string"', b"42", b""], ids=["text", "string", "number", "empty"])
def test_a_non_json_or_non_object_body_is_a_parse_error(openapi_app: Flask, raw: bytes) -> None:
    response = openapi_app.test_client().post(MCP_PATH, data=raw, content_type="application/json")

    assert response.status_code == 400
    assert _error_code(response) == mcp_types.PARSE_ERROR


@JSON_RPC_ERROR_BODY
def test_a_missing_jsonrpc_is_invalid_request(openapi_app: Flask) -> None:
    response = _post(openapi_app.test_client(), {"id": 1, "method": "ping"})

    assert response.status_code == 400
    assert _error_code(response) == mcp_types.INVALID_REQUEST


@JSON_RPC_ERROR_BODY
def test_bad_params_are_invalid_params(openapi_app: Flask) -> None:
    response = _post(openapi_app.test_client(), _rpc("tools/call", {"arguments": {}}))

    assert response.status_code == 400
    assert _error_code(response) == mcp_types.INVALID_PARAMS


def test_an_unsupported_protocol_header_is_a_json_rpc_error(admitted_bearer: AdmittedWorld) -> None:
    headers = {**admitted_bearer.headers, PROTOCOL_HEADER: "1999-01-01"}
    response = _post(admitted_bearer.client, _rpc("tools/list"), headers)

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["error"]["code"] == mcp_types.INVALID_REQUEST
    assert payload["error"]["message"] == "Unsupported MCP-Protocol-Version: 1999-01-01"
    assert payload["id"] == 1


def test_get_is_405(openapi_app: Flask) -> None:
    assert openapi_app.test_client().get(MCP_PATH).status_code == 405


def test_tools_call_without_a_token_is_http_401_with_www_authenticate(openapi_app: Flask) -> None:
    body = _rpc("tools/call", {"name": "dify_read", "arguments": {"op": "get.workspace", "input": {}}})
    response = _post(openapi_app.test_client(), body)

    assert response.status_code == 401
    assert response.get_json() == UNAUTHORIZED_BODY
    assert response.headers["WWW-Authenticate"]


def test_a_known_method_the_route_does_not_serve_is_method_not_found_at_http_200(openapi_app: Flask) -> None:
    response = _post(openapi_app.test_client(), _rpc("resources/list"))

    assert response.status_code == 200
    assert _error_code(response) == mcp_types.METHOD_NOT_FOUND


def test_a_notification_with_an_unsupported_protocol_header_is_202(openapi_app: Flask) -> None:
    response = _post(
        openapi_app.test_client(),
        _rpc("notifications/initialized", request_id=None),
        {PROTOCOL_HEADER: "1999-01-01"},
    )

    assert response.status_code == 202


class Authenticator(Protocol):
    def authenticate(self, token: str) -> AuthContext: ...


class _CountingAuthenticator:
    def __init__(self, inner: Authenticator) -> None:
        self.inner = inner
        self.calls = 0

    def authenticate(self, token: str) -> AuthContext:
        self.calls += 1
        return self.inner.authenticate(token)


def test_each_request_authenticates_exactly_once(
    admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    counter = _CountingAuthenticator(router_module.get_authenticator())
    monkeypatch.setattr("controllers.openapi.auth.router.get_authenticator", lambda: counter)
    call = _rpc("tools/call", {"name": "dify_read", "arguments": {"op": "get.workspace", "input": {}}})

    for message in (_initialize(), _rpc("tools/list"), call):
        counter.calls = 0
        response = _post(admitted_bearer.client, message, admitted_bearer.headers)
        assert response.status_code == 200
        assert counter.calls == 1, message["method"]


class _OpRecorder:
    def __init__(self) -> None:
        self.calls: list[OpCall] = []

    def __call__(self, call: OpCall) -> OpResult:
        self.calls.append(call)
        return OpResult(status=200, body={}, headers={}, is_json=True)


@JSON_RPC_ERROR_BODY
def test_a_body_over_the_cap_is_413_and_runs_no_op(openapi_app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = _OpRecorder()
    monkeypatch.setattr("controllers.openapi._mcp_tools.call_op", recorder)
    padding = "x" * MCP_MAX_BODY_BYTES
    body = _rpc("tools/call", {"name": "dify_read", "arguments": {"op": "get.workspace", "input": {"p": padding}}})
    response = _post(openapi_app.test_client(), body, {"Authorization": "Bearer dfoa_x"})

    assert response.status_code == 413
    payload = response.get_json()
    assert payload["id"] is None
    assert payload["error"]["code"] == mcp_types.INVALID_REQUEST
    assert payload["error"]["message"] == "Request body too large"
    assert recorder.calls == []


def _post_without_content_length(app: Flask, body: object) -> tuple[int, dict[str, object]]:
    builder = EnvironBuilder(
        path=MCP_PATH,
        method="POST",
        input_stream=io.BytesIO(json.dumps(body).encode()),
        content_type="application/json",
        headers=[("Authorization", "Bearer dfoa_x")],
    )
    environ = builder.get_environ()
    del environ["CONTENT_LENGTH"]
    environ["wsgi.input_terminated"] = True
    app_iter, status, _headers = run_wsgi_app(app.wsgi_app, environ)
    return int(status.split()[0]), json.loads(b"".join(app_iter))


def _oversize_call() -> dict[str, object]:
    padding = "x" * MCP_MAX_BODY_BYTES
    return _rpc("tools/call", {"name": "dify_read", "arguments": {"op": "get.workspace", "input": {"p": padding}}})


@JSON_RPC_ERROR_BODY
def test_a_chunked_body_over_the_cap_is_cut_at_the_cap_and_is_a_parse_error(
    openapi_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    recorder = _OpRecorder()
    monkeypatch.setattr("controllers.openapi._mcp_tools.call_op", recorder)
    status, payload = _post_without_content_length(openapi_app, _oversize_call())

    assert status == 400
    error = payload["error"]
    assert isinstance(error, dict)
    assert error["code"] == mcp_types.PARSE_ERROR
    assert recorder.calls == []


def test_a_body_just_under_the_cap_still_parses(openapi_app: Flask) -> None:
    overhead = len(json.dumps(_rpc("ping", {"pad": ""})))
    body = _rpc("ping", {"pad": "x" * (MCP_MAX_BODY_BYTES - overhead - 1)})
    assert len(json.dumps(body)) < MCP_MAX_BODY_BYTES
    response = _post(openapi_app.test_client(), body)

    assert response.status_code == 200
    assert response.get_json()["result"] == {}


@JSON_RPC_ERROR_BODY
@pytest.mark.parametrize("origin", ["http://evil.example.com", "null", "http://localhost.evil.example.com"])
def test_a_foreign_origin_is_403_before_the_body_is_read(openapi_app: Flask, origin: str) -> None:
    response = openapi_app.test_client().post(
        MCP_PATH, data=b"not json at all", content_type="application/json", headers={"Origin": origin}
    )

    assert response.status_code == 403
    assert _error_code(response) == mcp_types.INVALID_REQUEST
    assert response.get_json()["id"] is None


@pytest.mark.parametrize("origin", ["http://localhost", "https://localhost"])
def test_the_servers_own_origin_is_accepted(openapi_app: Flask, origin: str) -> None:
    response = _post(openapi_app.test_client(), _rpc("ping"), {"Origin": origin})

    assert response.status_code == 200
    assert response.get_json()["result"] == {}


@JSON_RPC_ERROR_BODY
def test_an_origin_in_the_openapi_cors_list_is_accepted(openapi_app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(mcp_module.dify_config, "inner_openapi_cors_allow_origins", "https://agent.example.com")

    allowed = _post(openapi_app.test_client(), _rpc("ping"), {"Origin": "https://agent.example.com"})
    other = _post(openapi_app.test_client(), _rpc("ping"), {"Origin": "https://other.example.com"})

    assert allowed.status_code == 200
    assert other.status_code == 403


def _unknown_path_answer(client: FlaskClient) -> TestResponse:
    return client.post("/openapi/v1/no-such-route", data=b"{}", content_type="application/json")


@pytest.mark.parametrize(
    ("body", "headers"),
    [
        (_initialize(), {"Authorization": "Bearer dfoa_x"}),
        (_rpc("ping"), {}),
        (_rpc("ping"), {"Origin": "http://evil.example.com"}),
        (_oversize_call(), {}),
    ],
)
def test_with_mcp_off_the_endpoint_answers_as_an_unknown_path_and_runs_nothing(
    openapi_app: Flask, monkeypatch: pytest.MonkeyPatch, body: object, headers: dict[str, str]
) -> None:
    monkeypatch.setattr(mcp_module.dify_config, "OPENAPI_MCP_ENABLED", False)
    recorder = _OpRecorder()
    monkeypatch.setattr("controllers.openapi._mcp_tools.call_op", recorder)

    def no_login(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("no login check runs while MCP is off")

    monkeypatch.setattr(mcp_module, "admit_bearer", no_login)
    client = openapi_app.test_client()

    response = _post(client, body, headers)
    unknown = _unknown_path_answer(client)

    assert response.status_code == 404
    assert response.get_json() == unknown.get_json()
    assert recorder.calls == []


def test_with_mcp_on_the_endpoint_serves(openapi_app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(mcp_module.dify_config, "OPENAPI_MCP_ENABLED", True)

    response = _post(openapi_app.test_client(), _rpc("ping"))

    assert response.status_code == 200
    assert response.get_json()["result"] == {}
