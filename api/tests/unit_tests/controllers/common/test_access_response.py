"""Final Flask response contracts; all database/token/execution boundaries are isolated."""

import io
import json
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Literal, Never, override
from unittest.mock import MagicMock

import pytest
from flask import Blueprint, Flask, Response, jsonify, request
from flask.testing import FlaskClient
from flask_restx import Namespace, Resource
from werkzeug.exceptions import NotFound, Unauthorized

import controllers.service_api.wraps as token_wraps
import controllers.trigger.trigger as plugin_trigger
import services.api_token_service as token_service
from controllers.common.access_response import (
    MCP_ERROR_BODY_LIMIT,
    MISSING_BEARER_MESSAGE,
    mcp_server_not_found_response,
    register_auth_error_response,
)
from controllers.mcp import mcp
from controllers.trigger import webhook
from extensions import ext_request_logging
from libs.external_api import ExternalApi
from models.engine import db
from models.enums import AppMCPServerStatus

type TokenClient = tuple[FlaskClient, MagicMock, MagicMock, MagicMock]
type MCPClient = tuple[FlaskClient, MagicMock, MagicMock, MagicMock]


@pytest.fixture
def http_app() -> Flask:
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI="sqlite:///:memory:")
    db.init_app(app)
    return app


@pytest.fixture
def token_client(http_app: Flask, monkeypatch: pytest.MonkeyPatch) -> TokenClient:
    bp = Blueprint("service_test", __name__, url_prefix="/v1")
    register_auth_error_response(bp, www_authenticate='Bearer realm="api"')
    api = ExternalApi(bp)

    class TokenResource(Resource):
        def get(self) -> dict[str, bool]:
            token_wraps.validate_and_get_api_token("app")
            return {"ok": True}

    api.add_resource(TokenResource, "/info")
    http_app.register_blueprint(bp)
    other = Blueprint("other_test", __name__, url_prefix="/other")
    other_api = ExternalApi(other)

    class OtherResource(Resource):
        def get(self) -> Never:
            raise Unauthorized("Other API authentication")

    other_api.add_resource(OtherResource, "/info")
    http_app.register_blueprint(other)
    cache_get = MagicMock(return_value=None)
    fetch = MagicMock(side_effect=Unauthorized("Access token is invalid"))
    usage = MagicMock()
    monkeypatch.setattr(token_wraps.ApiTokenCache, "get", cache_get)
    monkeypatch.setattr(token_wraps, "fetch_token_with_single_flight", fetch)
    monkeypatch.setattr(token_wraps, "record_token_usage", usage)
    return http_app.test_client(), cache_get, fetch, usage


@pytest.mark.parametrize(
    "header",
    [
        None,
        "",
        "Bearer",
        "Bearer ",
        "Bearer\t",
        " ",
        "Basic abc",
        "Bearer a b",
        "Bearer\xa0valid-token",
        "Bearer\x1cvalid-token",
        "Bearer\vvalid-token",
        "Bearer\u2003valid-token",
    ],
)
def test_bad_bearer_final_response_never_looks_up_or_records_token(
    token_client: TokenClient, header: str | None
) -> None:
    client, cache_get, fetch, usage = token_client
    response = client.get("/v1/info", headers={} if header is None else {"Authorization": header})
    assert response.status_code == 401
    expected = {"code": "unauthorized", "message": MISSING_BEARER_MESSAGE, "status": 401}
    assert response.data == json.dumps(expected, separators=(",", ":"), sort_keys=True).encode()
    assert response.headers["Content-Type"] == "application/json"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    cache_get.assert_not_called()
    fetch.assert_not_called()
    usage.assert_not_called()


def test_invalid_token_final_response_and_no_usage(token_client: TokenClient) -> None:
    client, _cache_get, fetch, usage = token_client
    response = client.get("/v1/info", headers={"Authorization": "Bearer missing-token"})
    assert response.status_code == 401
    assert response.data == b'{"code":"unauthorized","message":"Access token is invalid","status":401}'
    assert response.headers["Content-Type"] == "application/json"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    fetch.assert_called_once_with("missing-token", "app")
    usage.assert_not_called()


def test_invalid_token_database_path_does_not_record_usage(http_app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.scalar.return_value = None
    maker = MagicMock()
    maker.return_value.__enter__.return_value = session
    usage = MagicMock()
    monkeypatch.setattr(token_service, "Session", maker)
    monkeypatch.setattr(token_service.ApiTokenCache, "set", MagicMock())
    monkeypatch.setattr(token_service, "record_token_usage", usage)
    with http_app.app_context(), pytest.raises(Unauthorized, match="Access token is invalid"):
        token_service.query_token_from_db("missing-token", "app")
    usage.assert_not_called()
    session.add.assert_not_called()


def test_success_token_and_other_surface_are_not_rewritten(token_client: TokenClient) -> None:
    client, cache_get, _fetch, usage = token_client
    cache_get.return_value = SimpleNamespace(id="existing")
    response = client.get("/v1/info", headers={"Authorization": "bEaReR\tvalid-token"})
    assert response.status_code == 200
    assert response.get_json() == {"ok": True}
    assert "Cache-Control" not in response.headers
    usage.assert_called_once_with("valid-token", "app")
    other = client.get("/other/info")
    assert other.status_code == 401
    assert other.get_json()["message"] == "Other API authentication"
    assert "Cache-Control" not in other.headers


@pytest.fixture
def mcp_client(http_app: Flask, monkeypatch: pytest.MonkeyPatch) -> MCPClient:
    bp = Blueprint("mcp_test", __name__, url_prefix="/mcp")
    api = ExternalApi(bp)
    namespace = Namespace("mcp_test", path="/")
    namespace.add_resource(mcp.MCPAppApi, "/server/<string:server_code>/mcp")
    api.add_namespace(namespace)
    http_app.register_blueprint(bp)
    monkeypatch.setattr(mcp, "mcp_ns", namespace)
    session = MagicMock()
    maker = MagicMock()
    maker.return_value.begin.return_value.__enter__.return_value = session
    monkeypatch.setattr(mcp, "sessionmaker", maker)
    execute = MagicMock()
    end_user = MagicMock()
    monkeypatch.setattr(mcp, "handle_mcp_request", execute)
    monkeypatch.setattr(mcp.MCPAppApi, "_retrieve_end_user", end_user)
    return http_app.test_client(), session, execute, end_user


@pytest.mark.parametrize("cached", [False, True])
@pytest.mark.parametrize("identity", ["missing-server", "missing-app", "inactive"])
@pytest.mark.parametrize(
    ("body", "expected_id"),
    [
        (b'{"id":17}', b"17"),
        (b'{"id":-0}', b"-0"),
        (b'{"id":1.2500}', b"1.2500"),
        (b'{"id":1e+90}', b"1e+90"),
        (b'{"id":900719925474099312345678901234567890}', b"900719925474099312345678901234567890"),
        (b'{"id":"request-1"}', b'"request-1"'),
        ('{"id":"<>&雪\u2028\u2029"}'.encode(), '"<>&雪\\u2028\\u2029"'.encode()),
        (b'{"id":true}', b"null"),
        (b'{"id":[]}', b"null"),
        (b'{"id":{}}', b"null"),
        (b'{"id":null}', b"null"),
        (b"{}", b"null"),
        (b'[{"id":1}]', b"null"),
        (b'{"id":NaN}', b"null"),
        (b'{"id":Infinity}', b"null"),
        (b'{"id":', b"null"),
        (b'{"id":1}{}', b"null"),
        (b'\xef\xbb\xbf{"id":1}', b"null"),
        ('{"id":1}'.encode("utf-16"), b"null"),
        (b'{"id":"\xff"}', b"null"),
        (b'{"id":"\\ud800"}', b"null"),
        (b'{"id":"\\udfff"}', b"null"),
        (b'{"id":"\\ud83d\\ude00"}', '"😀"'.encode()),
        (b'{"id":"\\\\ud800"}', b'"\\\\ud800"'),
        (b'{"id":1,"params":' + b"[" * 63 + b"0" + b"]" * 63 + b"}", b"1"),
        (b'{"id":1,"params":' + b"[" * 64 + b"0" + b"]" * 64 + b"}", b"null"),
        (b'{"id":1,"params":"' + b"[" * 100 + b'\\"}"}', b"1"),
        (b'{"id":1}' + b" " * (MCP_ERROR_BODY_LIMIT - len(b'{"id":1}')), b"1"),
        (b'{"id":1}' + b" " * MCP_ERROR_BODY_LIMIT, b"null"),
    ],
)
def test_mcp_missing_identity_final_response_is_bounded_and_opaque(
    mcp_client: MCPClient,
    identity: Literal["missing-server", "missing-app", "inactive"],
    cached: bool,
    body: bytes,
    expected_id: bytes,
) -> None:
    client, session, execute, end_user = mcp_client
    server = SimpleNamespace(app_id="private-app", tenant_id="tenant", status=AppMCPServerStatus.ACTIVE)
    if cached:

        @client.application.before_request
        def cache_body() -> None:
            request.get_data()

    if identity == "missing-server":
        session.scalar.side_effect = [None]
    elif identity == "missing-app":
        session.scalar.side_effect = [server, None]
    else:
        server.status = "inactive"
        session.scalar.side_effect = [server, SimpleNamespace(id="private-app")]
    response = client.post("/mcp/server/missing-fixture/mcp", data=body, content_type="application/json")
    assert response.status_code == 404
    assert (
        response.data
        == b'{"error":{"code":-32600,"message":"Server Not Found"},"id":' + expected_id + b',"jsonrpc":"2.0"}'
    )
    assert response.headers["Content-Type"] == "application/json"
    assert response.headers["Cache-Control"] == "no-store"
    execute.assert_not_called()
    end_user.assert_not_called()
    session.add.assert_not_called()
    session.execute.assert_not_called()


@pytest.mark.parametrize("cached", [False, True])
@pytest.mark.parametrize("oversized", [False, True])
def test_mcp_unknown_length_stream_read_is_capped(http_app: Flask, cached: bool, oversized: bool) -> None:
    class RecordingStream(io.BytesIO):
        requested: list[int | None] = []

        @override
        def read(self, size: int | None = -1) -> bytes:
            self.requested.append(size)
            return super().read(size)

    stream = RecordingStream(b'{"id":1}' + (b" " * MCP_ERROR_BODY_LIMIT if oversized else b""))
    with http_app.test_request_context(
        "/", method="POST", environ_overrides={"wsgi.input": stream, "wsgi.input_terminated": True}
    ):
        if cached:
            request.get_data()
            stream.requested.clear()
        response = mcp_server_not_found_response()
    assert stream.requested == ([] if cached else [MCP_ERROR_BODY_LIMIT + 1])
    assert response.get_json()["id"] == (None if oversized else 1)


def test_mcp_debug_request_logging_preserves_raw_error_id(
    mcp_client: MCPClient, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, session, execute, end_user = mcp_client
    session.scalar.return_value = None
    caplog.set_level(logging.DEBUG, logger=ext_request_logging.__name__)
    # Exercise the real existing request-started logger, including request.data caching.
    monkeypatch.setattr(ext_request_logging.dify_config, "ENABLE_REQUEST_LOGGING", True)
    ext_request_logging.init_app(client.application)
    response = client.post("/mcp/server/missing-fixture/mcp", data=b'{"id":1.2500}', content_type="application/json")
    assert response.status_code == 404
    assert b'"id":1.2500,' in response.data
    assert "Received Request" in caplog.text
    execute.assert_not_called()
    end_user.assert_not_called()


def test_existing_mcp_keeps_normal_large_payload_and_response(
    mcp_client: MCPClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, session, _execute, _end_user = mcp_client
    server = SimpleNamespace(id="server", tenant_id="tenant", app_id="existing-app", status=AppMCPServerStatus.ACTIVE)
    app = SimpleNamespace(id="existing-app", tenant_id="tenant")
    session.scalar.side_effect = [server, app, server, app]
    monkeypatch.setattr(mcp.MCPAppApi, "_get_user_input_form", MagicMock(return_value=[]))
    expected_body = b'{"id":2,"jsonrpc":"2.0","result":{}}'
    process = MagicMock(return_value=Response(expected_body, status=200, content_type="application/json"))
    monkeypatch.setattr(mcp.MCPAppApi, "_process_mcp_message", process)
    payload = {
        "jsonrpc": "2.0",
        "method": "initialize",
        "id": 2,
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"experimental": {"fixture": {"padding": "x" * (MCP_ERROR_BODY_LIMIT + 1)}}},
            "clientInfo": {"name": "fixture", "version": "1"},
        },
    }
    response = client.post("/mcp/server/existing-fixture/mcp", json=payload)
    assert response.status_code == 200
    assert response.data == expected_body
    assert "Cache-Control" not in response.headers
    process.assert_called_once()


def test_existing_mcp_still_validates_malformed_payload(mcp_client: MCPClient) -> None:
    client, session, execute, end_user = mcp_client
    session.scalar.side_effect = [
        SimpleNamespace(id="server", tenant_id="tenant", app_id="existing-app", status=AppMCPServerStatus.ACTIVE),
        SimpleNamespace(id="existing-app", tenant_id="tenant"),
    ]
    response = client.post("/mcp/server/existing-fixture/mcp", data=b"{", content_type="application/json")
    assert response.status_code == 400
    execute.assert_not_called()
    end_user.assert_not_called()


@pytest.mark.parametrize(
    "change",
    [
        "initial-missing",
        "missing-server",
        "missing-app",
        "inactive",
        "server-replaced",
        "app-rebound",
        "tenant-changed",
        "unchanged",
    ],
)
def test_mcp_reads_body_outside_sessions_and_rechecks_identity_before_execution(
    mcp_client: MCPClient, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    client, _session, execute, end_user = mcp_client
    active_sessions: list[MagicMock] = []
    opened: list[MagicMock] = []
    read_sessions: list[bool] = []
    initial_server = SimpleNamespace(id="server", tenant_id="tenant", app_id="app", status=AppMCPServerStatus.ACTIVE)
    initial_app = SimpleNamespace(id="app", tenant_id="tenant")
    fresh_server = SimpleNamespace(**vars(initial_server))
    fresh_app = SimpleNamespace(**vars(initial_app))
    if change == "inactive":
        fresh_server.status = "inactive"
    elif change == "server-replaced":
        fresh_server.id = "other-server"
    elif change == "app-rebound":
        fresh_server.app_id = fresh_app.id = "other-app"
    elif change == "tenant-changed":
        fresh_server.tenant_id = fresh_app.tenant_id = "other-tenant"
    initial = MagicMock()
    initial.scalar.side_effect = [None] if change == "initial-missing" else [initial_server, initial_app]
    execution = MagicMock()
    execution.scalar.side_effect = (
        [None] if change == "missing-server" else [fresh_server, None if change == "missing-app" else fresh_app]
    )
    remaining = iter((initial, execution))

    @contextmanager
    def begin() -> Iterator[MagicMock]:
        session = next(remaining)
        opened.append(session)
        active_sessions.append(session)
        try:
            yield session
        finally:
            active_sessions.pop()

    monkeypatch.setattr(mcp, "sessionmaker", lambda *_args, **_kwargs: SimpleNamespace(begin=begin))
    form = MagicMock(return_value=[])
    process = MagicMock(return_value=Response("ok", status=200))
    monkeypatch.setattr(mcp.MCPAppApi, "_get_user_input_form", form)
    monkeypatch.setattr(mcp.MCPAppApi, "_process_mcp_message", process)
    original_error = mcp.mcp_server_not_found_response

    def error_response() -> Response:
        assert not active_sessions, "404 response must be constructed after releasing sessions"
        return original_error()

    monkeypatch.setattr(mcp, "mcp_server_not_found_response", error_response)

    class RecordingStream(io.BytesIO):
        @override
        def read(self, size: int | None = -1) -> bytes:
            read_sessions.append(bool(active_sessions))
            return super().read(size)

        @override
        def readinto(self, buffer) -> int:
            data = self.read(len(buffer))
            buffer[: len(data)] = data
            return len(data)

    payload = b'{"jsonrpc":"2.0","method":"ping","id":900719925474099312345678901234567890}'
    response = client.post(
        "/mcp/server/fixture/mcp", input_stream=RecordingStream(payload), content_type="application/json"
    )
    assert read_sessions
    assert not any(read_sessions)
    assert opened == ([initial] if change == "initial-missing" else [initial, execution])
    if change == "unchanged":
        assert response.status_code == 200
        form.assert_called_once_with(fresh_app, session=execution)
        assert process.call_args.args[2] is fresh_app
        assert process.call_args.args[3] is fresh_server
        assert process.call_args.args[5] is execution
    else:
        assert response.status_code == 404
        assert b'"id":900719925474099312345678901234567890,' in response.data
        form.assert_not_called()
        process.assert_not_called()
    execute.assert_not_called()
    end_user.assert_not_called()
    initial.add.assert_not_called()
    execution.add.assert_not_called()


@pytest.mark.parametrize("route", ["webhook", "webhook-debug"])
def test_webhook_missing_identity_uses_native_html_without_disclosing_id(
    http_app: Flask, monkeypatch: pytest.MonkeyPatch, route: Literal["webhook", "webhook-debug"]
) -> None:
    monkeypatch.setattr(webhook, "request", request)
    monkeypatch.setattr(webhook, "jsonify", jsonify)
    lookup = MagicMock(side_effect=ValueError("Webhook not found: private-fixture"))
    execute = MagicMock()
    monkeypatch.setattr(webhook.WebhookService, "get_webhook_trigger_and_workflow", lookup)
    monkeypatch.setattr(webhook.WebhookService, "trigger_workflow_execution", execute)
    handler = webhook.handle_webhook if route == "webhook" else webhook.handle_webhook_debug
    http_app.add_url_rule(f"/triggers/{route}/<string:webhook_id>", view_func=handler, methods=["POST"])
    response = http_app.test_client().post(f"/triggers/{route}/private-fixture", json={})
    assert response.status_code == 404
    assert response.data == NotFound().get_body().encode()
    assert response.headers["Content-Type"] == "text/html; charset=utf-8"
    assert response.headers["Cache-Control"] == "no-store"
    assert b"private-fixture" not in response.data
    execute.assert_not_called()


@pytest.mark.parametrize("endpoint", ["123e4567-e89b-42d3-a456-426614174000", "invalid-id"])
def test_plugin_callback_retains_its_json_error_contract(
    http_app: Flask, monkeypatch: pytest.MonkeyPatch, endpoint: str
) -> None:
    monkeypatch.setattr(plugin_trigger, "request", request)
    monkeypatch.setattr(plugin_trigger, "jsonify", jsonify)
    monkeypatch.setattr(plugin_trigger.TriggerService, "process_endpoint", MagicMock(return_value=None))
    monkeypatch.setattr(
        plugin_trigger.TriggerSubscriptionBuilderService,
        "process_builder_validation_endpoint",
        MagicMock(return_value=None),
    )
    http_app.add_url_rule(
        "/triggers/plugin/<string:endpoint_id>", view_func=plugin_trigger.trigger_endpoint, methods=["POST"]
    )
    response = http_app.test_client().post(f"/triggers/plugin/{endpoint}", json={})
    assert response.status_code == 404
    assert response.data == b'{"error":"Endpoint not found"}'
    assert response.mimetype == "application/json"
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("status", [401, 403, 429])
def test_openapi_local_hook_preserves_native_details_and_oauth_challenge(http_app: Flask, status: int) -> None:
    payload = {
        "code": "unauthorized",
        "message": "invalid_token",
        "status": status,
        "hint": "native hint",
        "details": [{"type": "native", "loc": ["header"], "msg": "detail"}],
    }
    bp = Blueprint("openapi_test", __name__, url_prefix="/openapi/v1")
    register_auth_error_response(bp)

    @bp.route("/fixture")
    def fixture() -> tuple[Response, int, dict[str, str]]:
        return jsonify(payload), status, {"WWW-Authenticate": 'Bearer realm="native-openapi", error="invalid_token"'}

    http_app.register_blueprint(bp)
    response = http_app.test_client().get("/openapi/v1/fixture")
    assert response.status_code == status
    assert response.get_json() == payload
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="native-openapi", error="invalid_token"'
    if status == 401:
        assert response.data == json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
        assert response.headers["Cache-Control"] == "no-store"
    else:
        assert "Cache-Control" not in response.headers
