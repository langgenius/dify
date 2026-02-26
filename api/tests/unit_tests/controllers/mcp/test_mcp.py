import types
from unittest.mock import MagicMock, patch

import pytest
from flask import Response
from pydantic import ValidationError

import controllers.mcp.mcp as module


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture(autouse=True)
def mock_db():
    module.db = types.SimpleNamespace(engine=object())


@pytest.fixture
def fake_session():
    session = MagicMock()
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    return session


@pytest.fixture(autouse=True)
def mock_session(fake_session):
    module.Session = MagicMock(return_value=fake_session)


@pytest.fixture(autouse=True)
def mock_mcp_ns():
    fake_ns = types.SimpleNamespace()
    fake_ns.payload = None
    fake_ns.models = {}
    module.mcp_ns = fake_ns


def fake_payload(data):
    module.mcp_ns.payload = data


class DummyServer:
    def __init__(self, status, app_id="app-1", tenant_id="tenant-1", server_id="srv-1"):
        self.status = status
        self.app_id = app_id
        self.tenant_id = tenant_id
        self.id = server_id


class DummyApp:
    def __init__(self, mode, workflow=None, app_model_config=None):
        self.id = "app-1"
        self.tenant_id = "tenant-1"
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


class TestMCPAppApi:
    @patch.object(module, "handle_mcp_request", return_value=DummyResult())
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

    @patch.object(module, "handle_mcp_request", return_value=None)
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

        with patch.object(module, "handle_mcp_request", return_value=DummyResult()):
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

        with patch.object(module, "handle_mcp_request", return_value=DummyResult()):
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

    def test_server_found_successfully(self):
        """Test successful server and app retrieval"""
        api = module.MCPAppApi()

        server = DummyServer(status=module.AppMCPServerStatus.ACTIVE)
        app = DummyApp(
            mode=module.AppMode.ADVANCED_CHAT,
            workflow=DummyWorkflow(),
        )

        session = MagicMock()
        session.query().where().first.side_effect = [server, app]

        result_server, result_app = api._get_mcp_server_and_app("server-1", session)

        assert result_server == server
        assert result_app == app

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
