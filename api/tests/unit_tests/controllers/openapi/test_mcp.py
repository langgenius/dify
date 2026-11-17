"""POST /openapi/v1/mcp: the JSON-RPC envelope, the login check and one authentication per request."""

from __future__ import annotations

import json
import uuid

import pytest
from flask import Flask
from flask.testing import FlaskClient

from constants.oauth_bearer import TokenType
from controllers.openapi import account as account_module
from controllers.openapi import mcp as mcp_module
from controllers.openapi._catalog import current_catalog
from controllers.openapi._mcp_call import OpCall, OpResult
from controllers.openapi._mcp_tools import MCP_INSTRUCTIONS
from core.mcp import types as mcp_types
from extensions.ext_application_services import ApplicationServices
from libs.oauth_bearer import AuthContext
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld

MCP_PATH = "/openapi/v1/mcp"
PROTOCOL_HEADER = "MCP-Protocol-Version"
UNAUTHORIZED_BODY = {"code": "unauthorized", "message": "invalid bearer", "status": 401}


pytestmark = pytest.mark.allow_error_contract_violations


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


def _post(client: FlaskClient, body: object, headers: dict[str, str] | None = None):
    return client.post(MCP_PATH, data=json.dumps(body), content_type="application/json", headers=headers or {})


def _error_code(response) -> int:
    return response.get_json()["error"]["code"]


def test_initialize_with_a_good_token_negotiates_and_returns_the_instructions(admitted_bearer: AdmittedWorld) -> None:
    response = _post(admitted_bearer.client, _initialize(), admitted_bearer.headers)

    assert response.status_code == 200
    assert response.content_type.startswith("application/json")
    result = response.get_json()["result"]
    assert result["protocolVersion"] == "2025-06-18"
    assert result["instructions"] == MCP_INSTRUCTIONS


def test_initialize_without_a_token_is_http_401_with_www_authenticate(openapi_app: Flask) -> None:
    response = _post(openapi_app.test_client(), _initialize())

    assert response.status_code == 401
    assert response.get_json() == UNAUTHORIZED_BODY
    assert response.headers["WWW-Authenticate"]


def test_tools_list_returns_the_four_tools(admitted_bearer: AdmittedWorld) -> None:
    response = _post(admitted_bearer.client, _rpc("tools/list"), admitted_bearer.headers)

    assert response.status_code == 200
    names = [tool["name"] for tool in response.get_json()["result"]["tools"]]
    assert names == ["dify_find", "dify_read", "dify_write", "dify_destructive"]


def test_tools_list_without_a_token_is_http_401(openapi_app: Flask) -> None:
    response = _post(openapi_app.test_client(), _rpc("tools/list"))

    assert response.status_code == 401
    assert response.get_json() == UNAUTHORIZED_BODY


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


def test_an_unknown_method_is_method_not_found(admitted_bearer: AdmittedWorld) -> None:
    response = _post(admitted_bearer.client, _rpc("nope/nothing"), admitted_bearer.headers)

    assert response.status_code == 400
    assert _error_code(response) == mcp_types.METHOD_NOT_FOUND


def test_an_unknown_method_without_an_id_is_202(openapi_app: Flask) -> None:
    response = _post(openapi_app.test_client(), _rpc("nope/nothing", request_id=None))

    assert response.status_code == 202


@pytest.mark.parametrize("body", [[], [_rpc("ping")]], ids=["empty-batch", "one-item-batch"])
def test_a_batch_body_is_refused(openapi_app: Flask, body: list[object]) -> None:
    response = _post(openapi_app.test_client(), body)

    assert response.status_code == 400
    assert _error_code(response) == mcp_types.INVALID_REQUEST
    assert response.get_json()["id"] is None


@pytest.mark.parametrize("raw", [b"not json", b'"a string"', b"42", b""], ids=["text", "string", "number", "empty"])
def test_a_non_json_or_non_object_body_is_a_parse_error(openapi_app: Flask, raw: bytes) -> None:
    response = openapi_app.test_client().post(MCP_PATH, data=raw, content_type="application/json")

    assert response.status_code == 400
    assert _error_code(response) == mcp_types.PARSE_ERROR


def test_a_missing_jsonrpc_is_invalid_request(openapi_app: Flask) -> None:
    response = _post(openapi_app.test_client(), {"id": 1, "method": "ping"})

    assert response.status_code == 400
    assert _error_code(response) == mcp_types.INVALID_REQUEST


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


def test_a_token_that_describe_account_refuses_with_403_still_connects(
    openapi_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(_call: OpCall) -> OpResult:
        return OpResult(status=403, body={"code": "forbidden"}, headers={}, is_json=True)

    monkeypatch.setattr(mcp_module, "call_op", refuse)
    response = _post(openapi_app.test_client(), _rpc("tools/list"), {"Authorization": "Bearer dfoa_workspace"})

    assert response.status_code == 200
    assert len(response.get_json()["result"]["tools"]) == 4


def test_a_server_error_from_the_login_check_keeps_its_status_and_body(
    openapi_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(_call: OpCall) -> OpResult:
        return OpResult(status=503, body={"code": "unavailable"}, headers={}, is_json=True)

    monkeypatch.setattr(mcp_module, "call_op", broken)
    response = _post(openapi_app.test_client(), _rpc("tools/list"), {"Authorization": "Bearer dfoa_x"})

    assert response.status_code == 503
    assert response.get_json() == {"code": "unavailable"}


class _CountingAuthenticator:
    def __init__(self, token: AuthContext) -> None:
        self.token = token
        self.calls = 0

    def authenticate(self, _token: str) -> AuthContext:
        self.calls += 1
        return self.token


def test_each_request_authenticates_exactly_once(
    admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    counter = _CountingAuthenticator(
        AuthContext(
            subject_email="caller@example.com",
            subject_issuer="dify:account",
            account_id=uuid.uuid4(),
            client_id="difyctl",
            token_id=uuid.uuid4(),
            token_type=TokenType.OAUTH_ACCOUNT,
            expires_at=None,
        )
    )
    monkeypatch.setattr("controllers.openapi.auth.router.get_authenticator", lambda: counter)
    call = _rpc("tools/call", {"name": "dify_read", "arguments": {"op": "get.workspace", "input": {}}})

    for message in (_initialize(), _rpc("tools/list"), call):
        counter.calls = 0
        _post(admitted_bearer.client, message, admitted_bearer.headers)
        assert counter.calls == 1, message["method"]


def test_the_mcp_route_is_not_in_the_catalog(openapi_app: Flask) -> None:
    with openapi_app.test_request_context():
        raw, _ = current_catalog()

    assert all("mcp" not in entry["path"] for entry in json.loads(raw)["ops"].values())
