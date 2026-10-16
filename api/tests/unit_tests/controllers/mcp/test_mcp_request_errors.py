"""MCP request parsing errors exercised through the real HTTP blueprint."""

from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import controllers.mcp as mcp_controller
import controllers.mcp.mcp as module
from models.engine import db
from models.enums import AppMCPServerStatus, EndUserType
from models.model import App, AppMCPServer, AppMode, AppModelConfig, EndUser

_URL = "/mcp/server/test-server/mcp"
_MODERN_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": "server/discover",
}


@pytest.fixture
def app(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Flask:
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = str(sqlite_engine.url)
    db.init_app(app)
    app.register_blueprint(mcp_controller.bp)
    monkeypatch.setattr(module, "mcp_ns", mcp_controller.mcp_ns)
    return app


@pytest.fixture
def client(app: Flask) -> FlaskClient:
    return app.test_client()


@pytest.fixture
def published_server(sqlite_session: Session) -> AppMCPServer:
    app_id = str(uuid4())
    tenant_id = str(uuid4())
    model_config = AppModelConfig(app_id=app_id, user_input_form="[]")
    app = App(
        id=app_id,
        tenant_id=tenant_id,
        name="test_app",
        mode=AppMode.CHAT,
        enable_site=False,
        enable_api=True,
        app_model_config_id=model_config.id,
    )
    server = AppMCPServer(
        tenant_id=tenant_id,
        app_id=app_id,
        name="test_app",
        description="Test MCP app",
        server_code="test-server",
        status=AppMCPServerStatus.ACTIVE,
        parameters="{}",
    )
    sqlite_session.add_all([app, model_config, server])
    sqlite_session.commit()
    return server


@pytest.mark.parametrize("request_id", [1, 0, "discover-1", None])
def test_server_discover_returns_method_not_found(client: FlaskClient, request_id: int | str | None) -> None:
    response = client.post(
        _URL,
        json={
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "server/discover",
            "params": {
                "_meta": {
                    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                    "io.modelcontextprotocol/clientInfo": {"name": "modern-client", "version": "1.0"},
                    "io.modelcontextprotocol/clientCapabilities": {
                        "extensions": {"io.modelcontextprotocol/ui": {"mimeTypes": ["text/html;profile=mcp-app"]}}
                    },
                }
            },
        },
        headers=_MODERN_HEADERS,
    )

    assert response.status_code == 400
    body = response.get_json()
    assert body == {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": -32601, "message": "Method not found"},
    }
    assert type(body["id"]) is type(request_id)


def test_invalid_tool_params_return_safe_jsonrpc_error(client: FlaskClient) -> None:
    response = client.post(
        _URL,
        json={
            "jsonrpc": "2.0",
            "id": "tool-call-1",
            "method": "tools/call",
            "params": {"arguments": {"secret": "private-input-do-not-echo"}},
        },
    )

    assert response.status_code == 400
    body = response.get_json()
    assert body["jsonrpc"] == "2.0"
    assert body["id"] == "tool-call-1"
    assert body["error"]["code"] == -32602
    assert "private-input-do-not-echo" not in response.get_data(as_text=True)
    assert "validation error" not in body["error"]["message"].lower()


@pytest.mark.parametrize("method", ["server/discover", "notifications/unknown", "tools/call"])
def test_unparseable_notification_has_no_jsonrpc_response(client: FlaskClient, method: str) -> None:
    response = client.post(
        _URL,
        json={"jsonrpc": "2.0", "method": method, "params": {}},
        headers={**_MODERN_HEADERS, "Mcp-Method": method},
    )

    assert response.status_code == 202
    assert response.data == b""


def test_legacy_initialize_and_list_tools_remain_compatible(
    client: FlaskClient, published_server: AppMCPServer, sqlite_session: Session
) -> None:
    response = client.post(
        _URL,
        json={
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "legacy-client", "version": "1.0"},
            },
        },
    )

    assert response.status_code == 200
    initialized = response.get_json()
    assert initialized["id"] == 0
    assert initialized["result"]["protocolVersion"] == "2024-11-05"
    end_user = sqlite_session.scalar(select(EndUser).where(EndUser.session_id == published_server.id))
    assert end_user is not None
    assert end_user.tenant_id == published_server.tenant_id
    assert end_user.app_id == published_server.app_id
    assert end_user.type == EndUserType.MCP
    assert end_user.name == "legacy-client@1.0"

    headers = {"MCP-Protocol-Version": "2024-11-05"}
    notification = client.post(
        _URL,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers=headers,
    )
    assert notification.status_code == 202
    assert notification.data == b""

    listed = client.post(
        _URL,
        json={"jsonrpc": "2.0", "id": "list-1", "method": "tools/list"},
        headers=headers,
    )
    assert listed.status_code == 200
    body = listed.get_json()
    assert body["id"] == "list-1"
    assert body["result"]["tools"] == [
        {
            "name": "test_app",
            "description": "Test MCP app",
            "inputSchema": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "User Input/Question content"}},
                "required": ["query"],
            },
        }
    ]
