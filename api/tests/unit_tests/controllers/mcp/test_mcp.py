"""Unit tests for controllers.mcp.mcp endpoints."""

from __future__ import annotations

import types
from inspect import unwrap
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask, Response
from pydantic import ValidationError

import controllers.mcp.mcp as module
from models.model import EndUser


@pytest.fixture(autouse=True)
def mock_mcp_ns():
    fake_ns = types.SimpleNamespace()
    fake_ns.payload = None
    fake_ns.models = {}
    module.mcp_ns = fake_ns


@pytest.fixture(autouse=True)
def _route_database_to_sqlite(monkeypatch: pytest.MonkeyPatch, sqlite_engine) -> None:
    EndUser.__table__.create(sqlite_engine)
    monkeypatch.setattr(module, "db", types.SimpleNamespace(engine=sqlite_engine))


@pytest.fixture
def flask_req_ctx(app: Flask):
    with app.test_request_context("/"):
        yield


def fake_payload(data):
    module.mcp_ns.payload = data


_TENANT_ID = str(uuid4())
_APP_ID = str(uuid4())
_SERVER_ID = str(uuid4())


class DummyServer:
    def __init__(self, status, app_id=_APP_ID, tenant_id=_TENANT_ID, server_id=_SERVER_ID):
        self.status = status
        self.app_id = app_id
        self.tenant_id = tenant_id
        self.id = server_id
        self.description = "Test server"
        self.parameters_dict = {}


class DummyApp:
    def __init__(self, mode, workflow=None, app_model_config=None):
        self.id = _APP_ID
        self.tenant_id = _TENANT_ID
        self.name = "test_app"
        self.mode = mode
        self.workflow = workflow
        self.app_model_config = app_model_config


class DummyWorkflow:
    def user_input_form(self, to_old_structure=False):
        return []


class DummyConfig:
    def to_dict(self):
        return {"user_input_form": []}


class DummyResult:
    def model_dump(self, **kwargs):
        return {"jsonrpc": "2.0", "result": "ok", "id": 1}


@pytest.mark.usefixtures("flask_req_ctx")
class TestMCPAppApi:
    @patch.object(module, "handle_mcp_request", return_value=DummyResult(), autospec=True)
    def test_success_request(self, mock_handle):
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "initialize",
                "id": 1,
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0"},
                },
            }
        )

        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(
            mode=module.AppMode.ADVANCED_CHAT,
            workflow=DummyWorkflow(),
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))

        post_fn = unwrap(api.post)
        response = post_fn("server-1")

        assert isinstance(response, Response)
        mock_handle.assert_called_once()

    def test_notification_initialized(self):
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {},
            }
        )

        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(
            mode=module.AppMode.ADVANCED_CHAT,
            workflow=DummyWorkflow(),
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))

        post_fn = unwrap(api.post)
        response = post_fn("server-1")

        assert response.status_code == 202

    def test_invalid_notification_method(self):
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "notifications/invalid",
                "params": {},
            }
        )

        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(
            mode=module.AppMode.ADVANCED_CHAT,
            workflow=DummyWorkflow(),
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))

        post_fn = unwrap(api.post)

        with pytest.raises(module.MCPRequestError):
            post_fn("server-1")

    def test_inactive_server(self):
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "test",
                "id": 1,
                "params": {},
            }
        )

        server = DummyServer(status="inactive")
        app = DummyApp(
            mode=module.AppMode.ADVANCED_CHAT,
            workflow=DummyWorkflow(),
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))

        post_fn = unwrap(api.post)

        with pytest.raises(module.MCPRequestError):
            post_fn("server-1")

    def test_invalid_payload(self):
        fake_payload({"invalid": "data"})

        api = module.MCPAppApi()
        post_fn = unwrap(api.post)

        with pytest.raises(ValidationError):
            post_fn("server-1")

    def test_missing_request_id(self):
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "test",
                "params": {},
            }
        )

        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(
            mode=module.AppMode.WORKFLOW,
            workflow=DummyWorkflow(),
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))

        post_fn = unwrap(api.post)

        with pytest.raises(module.MCPRequestError):
            post_fn("server-1")

    def test_server_not_found(self):
        """Test when MCP server doesn't exist"""
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "initialize",
                "id": 1,
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0"},
                },
            }
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(
            side_effect=module.MCPRequestError(module.mcp_types.INVALID_REQUEST, "Server Not Found")
        )

        post_fn = unwrap(api.post)

        with pytest.raises(module.MCPRequestError) as exc_info:
            post_fn("server-1")
        assert "Server Not Found" in str(exc_info.value)

    def test_app_not_found(self):
        """Test when app associated with server doesn't exist"""
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "initialize",
                "id": 1,
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0"},
                },
            }
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(
            side_effect=module.MCPRequestError(module.mcp_types.INVALID_REQUEST, "App Not Found")
        )

        post_fn = unwrap(api.post)

        with pytest.raises(module.MCPRequestError) as exc_info:
            post_fn("server-1")
        assert "App Not Found" in str(exc_info.value)

    def test_app_unavailable_no_workflow(self):
        """Test when app has no workflow (ADVANCED_CHAT mode)"""
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "initialize",
                "id": 1,
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0"},
                },
            }
        )

        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(
            mode=module.AppMode.ADVANCED_CHAT,
            workflow=None,  # No workflow
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))

        post_fn = unwrap(api.post)

        with pytest.raises(module.MCPRequestError) as exc_info:
            post_fn("server-1")
        assert "App is unavailable" in str(exc_info.value)

    def test_app_unavailable_no_model_config(self):
        """Test when app has no model config (chat mode)"""
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "initialize",
                "id": 1,
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0"},
                },
            }
        )

        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(
            mode=module.AppMode.CHAT,
            app_model_config=None,  # No model config
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))

        post_fn = unwrap(api.post)

        with pytest.raises(module.MCPRequestError) as exc_info:
            post_fn("server-1")
        assert "App is unavailable" in str(exc_info.value)

    @patch.object(module, "handle_mcp_request", return_value=None, autospec=True)
    def test_mcp_request_no_response(self, mock_handle):
        """Test when handle_mcp_request returns None"""
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "initialize",
                "id": 1,
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0"},
                },
            }
        )

        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(
            mode=module.AppMode.ADVANCED_CHAT,
            workflow=DummyWorkflow(),
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))

        post_fn = unwrap(api.post)

        with pytest.raises(module.MCPRequestError) as exc_info:
            post_fn("server-1")
        assert "No response generated" in str(exc_info.value)

    def test_workflow_mode_with_user_input_form(self):
        """Test WORKFLOW mode app with user input form"""
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "initialize",
                "id": 1,
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0"},
                },
            }
        )

        class WorkflowWithForm:
            def user_input_form(self, to_old_structure=False):
                return [{"text-input": {"variable": "test_var", "label": "Test"}}]

        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(
            mode=module.AppMode.WORKFLOW,
            workflow=WorkflowWithForm(),
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))

        with patch.object(module, "handle_mcp_request", return_value=DummyResult(), autospec=True):
            post_fn = unwrap(api.post)
            response = post_fn("server-1")
            assert isinstance(response, Response)

    def test_chat_mode_with_model_config(self):
        """Test CHAT mode app with model config"""
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "initialize",
                "id": 1,
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0"},
                },
            }
        )

        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(
            mode=module.AppMode.CHAT,
            app_model_config=DummyConfig(),
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))

        with patch.object(module, "handle_mcp_request", return_value=DummyResult(), autospec=True):
            post_fn = unwrap(api.post)
            response = post_fn("server-1")
            assert isinstance(response, Response)

    def test_invalid_mcp_request_format(self):
        """Test invalid MCP request that doesn't match any type"""
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "invalid_method_xyz",
                "id": 1,
                "params": {},
            }
        )

        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(
            mode=module.AppMode.ADVANCED_CHAT,
            workflow=DummyWorkflow(),
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))

        post_fn = unwrap(api.post)

        with pytest.raises(module.MCPRequestError) as exc_info:
            post_fn("server-1")
        assert "Invalid MCP request" in str(exc_info.value)

    def test_validate_server_status_active(self):
        """Test successful server status validation"""
        api = module.MCPAppApi()
        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)

        # Should not raise an exception
        api._validate_server_status(server)

    def test_convert_user_input_form_empty(self):
        """Test converting empty user input form"""
        api = module.MCPAppApi()
        result = api._convert_user_input_form([])
        assert result == []

    def test_invalid_user_input_form_validation(self):
        """Test invalid user input form that fails validation"""
        fake_payload(
            {
                "jsonrpc": "2.0",
                "method": "initialize",
                "id": 1,
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0"},
                },
            }
        )

        class WorkflowWithBadForm:
            def user_input_form(self, to_old_structure=False):
                # Invalid type that will fail validation
                return [{"invalid-type": {"variable": "test_var"}}]

        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(
            mode=module.AppMode.WORKFLOW,
            workflow=WorkflowWithBadForm(),
        )

        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))

        post_fn = unwrap(api.post)

        with pytest.raises(module.MCPRequestError) as exc_info:
            post_fn("server-1")
        assert "Invalid user_input_form" in str(exc_info.value)


_UNSUPPORTED_VERSION = "1999-01-01"


def _initialize_payload(protocol_version: str = "2024-11-05") -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "method": "initialize",
        "id": 1,
        "params": {
            "protocolVersion": protocol_version,
            "capabilities": {},
            "clientInfo": {"name": "test-client", "version": "1.0"},
        },
    }


def _tools_list_payload(request_id: int | None = 1) -> dict[str, object]:
    payload: dict[str, object] = {"jsonrpc": "2.0", "method": "tools/list", "params": {}}
    if request_id is not None:
        payload["id"] = request_id
    return payload


def _tools_call_payload() -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "id": 1,
        "params": {"name": "test_app", "arguments": {"query": "test question"}},
    }


class TestMCPProtocolVersionNegotiationApi:
    """MCP protocol version negotiation exercised through the HTTP controller layer.

    Covers the MCP-Protocol-Version header contract (resolution, rejection, threading)
    and the serialized JSON responses seen by modern (2025-06-18) vs legacy (2024-11-05)
    clients, including the back-compat guarantee that legacy responses carry none of the
    structured-output fields.
    """

    def _make_api(self) -> module.MCPAppApi:
        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(mode=module.AppMode.CHAT, app_model_config=DummyConfig())
        api = module.MCPAppApi()
        api._get_mcp_server_and_app = MagicMock(return_value=(server, app))
        api._retrieve_end_user = MagicMock(return_value=MagicMock())
        return api

    def _post(
        self, flask_app: Flask, api: module.MCPAppApi, payload: dict[str, object], headers: dict[str, str] | None = None
    ) -> Response:
        fake_payload(payload)
        post_fn = unwrap(api.post)
        with flask_app.test_request_context(headers=headers):
            return post_fn("server-1")

    @pytest.mark.parametrize("version", sorted(module.mcp_types.SERVER_SUPPORTED_PROTOCOL_VERSIONS))
    def test_initialize_echoes_supported_body_version(self, app, version):
        """Initialize echoes every supported client-requested version back unchanged."""
        api = self._make_api()

        response = self._post(app, api, _initialize_payload(version))

        body = response.get_json()
        assert body["result"]["protocolVersion"] == version

    def test_initialize_falls_back_for_unsupported_body_version(self, app):
        """An unsupported requested version falls back to the server latest."""
        api = self._make_api()

        response = self._post(app, api, _initialize_payload(_UNSUPPORTED_VERSION))

        body = response.get_json()
        assert body["result"]["protocolVersion"] == module.mcp_types.SERVER_LATEST_PROTOCOL_VERSION

    def test_initialize_ignores_unsupported_header(self, app):
        """Initialize negotiates via the request body, so its header is never rejected."""
        api = self._make_api()

        response = self._post(
            app,
            api,
            _initialize_payload("2024-11-05"),
            headers={"MCP-Protocol-Version": _UNSUPPORTED_VERSION},
        )

        body = response.get_json()
        assert "error" not in body
        assert body["result"]["protocolVersion"] == "2024-11-05"

    @pytest.mark.parametrize("request_id", [5, None])
    def test_unsupported_header_returns_invalid_request_error(self, app, request_id):
        """An unsupported header gets a JSON-RPC error echoing the request id (missing id -> null)."""
        api = self._make_api()

        with patch.object(module, "handle_mcp_request", autospec=True) as mock_handle:
            response = self._post(
                app,
                api,
                _tools_list_payload(request_id=request_id),
                headers={"MCP-Protocol-Version": _UNSUPPORTED_VERSION},
            )

        body = response.get_json()
        assert response.status_code == 200
        assert body["jsonrpc"] == "2.0"
        assert body["id"] == request_id
        assert body["error"]["code"] == module.mcp_types.INVALID_REQUEST
        assert _UNSUPPORTED_VERSION in body["error"]["message"]
        mock_handle.assert_not_called()

    def test_notification_with_unsupported_header_is_accepted(self, app):
        """A notification is accepted (202, no body) even with an unsupported header."""
        api = self._make_api()

        response = self._post(
            app,
            api,
            {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
            headers={"MCP-Protocol-Version": _UNSUPPORTED_VERSION},
        )

        assert response.status_code == 202

    @pytest.mark.parametrize("version", sorted(module.mcp_types.SERVER_SUPPORTED_PROTOCOL_VERSIONS))
    def test_supported_header_is_threaded_to_handler(self, app, version):
        """Every supported header value is passed through to handle_mcp_request."""
        api = self._make_api()

        with patch.object(module, "handle_mcp_request", return_value=DummyResult(), autospec=True) as mock_handle:
            self._post(
                app,
                api,
                _tools_list_payload(),
                headers={"MCP-Protocol-Version": version},
            )

        assert mock_handle.call_args.args[-1] == version

    def test_absent_header_defaults_to_back_compat_version(self, app):
        """An absent header resolves to the spec's default version (2025-03-26)."""
        api = self._make_api()

        with patch.object(module, "handle_mcp_request", return_value=DummyResult(), autospec=True) as mock_handle:
            self._post(app, api, _tools_list_payload())

        assert mock_handle.call_args.args[-1] == module.mcp_types.DEFAULT_NEGOTIATED_VERSION

    def test_tools_list_json_advertises_structured_output_for_modern_client(self, app):
        """A 2025-06-18 client sees outputSchema and title in the serialized tool JSON."""
        api = self._make_api()

        response = self._post(
            app,
            api,
            _tools_list_payload(),
            headers={"MCP-Protocol-Version": "2025-06-18"},
        )

        tool = response.get_json()["result"]["tools"][0]
        assert tool["outputSchema"] == {"type": "object"}
        assert tool["title"] == "test_app"

    def test_tools_list_json_unchanged_for_legacy_client(self, app):
        """A 2024-11-05 client sees exactly the pre-upgrade tool JSON keys."""
        api = self._make_api()

        response = self._post(
            app,
            api,
            _tools_list_payload(),
            headers={"MCP-Protocol-Version": "2024-11-05"},
        )

        tool = response.get_json()["result"]["tools"][0]
        assert set(tool) == {"name", "description", "inputSchema"}

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_tools_call_json_includes_structured_content_for_modern_client(
        self, mock_app_generate, app
    ):
        """A 2025-06-18 client receives structuredContent alongside the text content."""
        api = self._make_api()
        mock_app_generate.generate.return_value = {"answer": "test answer"}

        response = self._post(
            app,
            api,
            _tools_call_payload(),
            headers={"MCP-Protocol-Version": "2025-06-18"},
        )

        result = response.get_json()["result"]
        assert result["structuredContent"] == {"answer": "test answer"}
        assert result["content"][0]["text"] == "test answer"

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_tools_call_json_omits_structured_content_for_legacy_client(
        self, mock_app_generate, app
    ):
        """A 2024-11-05 client receives the pre-upgrade tools/call JSON without structuredContent."""
        api = self._make_api()
        mock_app_generate.generate.return_value = {"answer": "test answer"}

        response = self._post(
            app,
            api,
            _tools_call_payload(),
            headers={"MCP-Protocol-Version": "2024-11-05"},
        )

        result = response.get_json()["result"]
        assert "structuredContent" not in result
        assert result["content"][0]["text"] == "test answer"
