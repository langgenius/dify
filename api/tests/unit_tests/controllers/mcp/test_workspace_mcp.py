"""Unit tests for workspace-level MCP server."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from core.mcp import types as mcp_types

TENANT_ID = str(uuid4())
APP_ID = str(uuid4())


class TestSanitizeToolName:
    """Tests for the _sanitize_tool_name helper."""

    def test_lowercase_and_underscore(self):
        from core.mcp.server.workspace_mcp_server import _sanitize_tool_name

        assert _sanitize_tool_name("Hello World") == "hello_world"

    def test_special_characters(self):
        from core.mcp.server.workspace_mcp_server import _sanitize_tool_name

        assert _sanitize_tool_name("My App!@#") == "my_app"

    def test_multiple_spaces(self):
        from core.mcp.server.workspace_mcp_server import _sanitize_tool_name

        assert _sanitize_tool_name("  My   App  ") == "my_app"

    def test_empty_name(self):
        from core.mcp.server.workspace_mcp_server import _sanitize_tool_name

        assert _sanitize_tool_name("") == "unnamed_tool"

    def test_only_special_chars(self):
        from core.mcp.server.workspace_mcp_server import _sanitize_tool_name

        assert _sanitize_tool_name("!@#$%") == "unnamed_tool"

    def test_alphanumeric(self):
        from core.mcp.server.workspace_mcp_server import _sanitize_tool_name

        assert _sanitize_tool_name("myTool123") == "mytool123"

    def test_collapse_double_underscores(self):
        from core.mcp.server.workspace_mcp_server import _sanitize_tool_name

        assert _sanitize_tool_name("a!@#b") == "a_b"


class TestHandleInitialize:
    """Tests for the workspace-level initialize handler."""

    def test_returns_correct_protocol_version(self):
        from core.mcp.server.workspace_mcp_server import _handle_initialize

        result = _handle_initialize()
        assert result.protocolVersion == mcp_types.SERVER_LATEST_PROTOCOL_VERSION
        assert result.serverInfo.name == "Dify Workspace"
        assert result.capabilities.tools is not None
        assert result.capabilities.tools.listChanged is False


class TestHandlePing:
    """Tests for ping handling via the main entry point."""

    def test_ping_returns_empty_result(self):
        from core.mcp.server.workspace_mcp_server import handle_workspace_mcp_request

        ping_request = mcp_types.ClientRequest(
            root=mcp_types.PingRequest(method="ping", params=None)
        )
        result = handle_workspace_mcp_request(TENANT_ID, ping_request, request_id=1)
        assert result.jsonrpc == "2.0"
        assert result.id == 1
        assert "result" in result.model_dump()


class TestHandleListTools:
    """Tests for workspace-level tools/list."""

    @patch("core.mcp.server.workspace_mcp_server.db")
    def test_returns_tools_for_active_servers(self, mock_db):
        from core.mcp.server.workspace_mcp_server import _handle_list_tools
        from models.enums import AppMCPServerStatus, AppMode

        mock_server = MagicMock()
        mock_server.tenant_id = TENANT_ID
        mock_server.status = AppMCPServerStatus.ACTIVE
        mock_server.description = "A test app"
        mock_server.parameters = json.dumps({})
        mock_server.parameters_dict = {}

        mock_app = MagicMock()
        mock_app.id = APP_ID
        mock_app.name = "Test App"
        mock_app.description = "A test description"
        mock_app.mode = AppMode.WORKFLOW
        mock_app.status = "normal"
        mock_app.workflow = MagicMock()
        mock_app.workflow.user_input_form.return_value = []

        mock_result = MagicMock()
        mock_result.all.return_value = [(mock_server, mock_app)]
        mock_db.session.execute.return_value = mock_result

        result = _handle_list_tools(TENANT_ID)
        assert isinstance(result, mcp_types.ListToolsResult)
        assert len(result.tools) == 1
        assert result.tools[0].name == "test_app"
        assert result.tools[0].description == "A test app"

    @patch("core.mcp.server.workspace_mcp_server.db")
    def test_returns_empty_when_no_servers(self, mock_db):
        from core.mcp.server.workspace_mcp_server import _handle_list_tools

        mock_result = MagicMock()
        mock_result.all.return_value = []
        mock_db.session.execute.return_value = mock_result

        result = _handle_list_tools(TENANT_ID)
        assert isinstance(result, mcp_types.ListToolsResult)
        assert len(result.tools) == 0


class TestHandleCallTool:
    """Tests for workspace-level tools/call."""

    @patch("core.mcp.server.workspace_mcp_server.AppGenerateService")
    @patch("core.mcp.server.workspace_mcp_server.db")
    @patch("core.mcp.server.workspace_mcp_server._find_app_by_tool_name")
    def test_calls_correct_app(self, mock_find, mock_db, mock_gen_service):
        from core.mcp.server.workspace_mcp_server import _handle_call_tool
        from models.enums import AppMode

        mock_app = MagicMock()
        mock_app.id = APP_ID
        mock_app.name = "Test App"
        mock_app.mode = AppMode.WORKFLOW
        mock_find.return_value = mock_app

        mock_end_user = MagicMock()
        mock_end_user.id = "end-user-1"

        mock_gen_service.generate.return_value = {"data": {"outputs": {"result": "ok"}}}

        call_request = mcp_types.ClientRequest(
            root=mcp_types.CallToolRequest(
                method="tools/call",
                params=mcp_types.CallToolRequestParams(
                    name="test_app",
                    arguments={"input1": "value1"},
                ),
            )
        )

        result = _handle_call_tool(TENANT_ID, call_request, mock_end_user)

        assert isinstance(result, mcp_types.CallToolResult)
        assert len(result.content) > 0
        assert result.content[0].type == "text"

    @patch("core.mcp.server.workspace_mcp_server._find_app_by_tool_name")
    def test_raises_when_tool_not_found(self, mock_find):
        from core.mcp.server.workspace_mcp_server import _handle_call_tool

        mock_find.return_value = None

        call_request = mcp_types.ClientRequest(
            root=mcp_types.CallToolRequest(
                method="tools/call",
                params=mcp_types.CallToolRequestParams(
                    name="nonexistent",
                    arguments={},
                ),
            )
        )

        with pytest.raises(ValueError, match="Tool not found"):
            _handle_call_tool(TENANT_ID, call_request, None)

    @patch("core.mcp.server.workspace_mcp_server._find_app_by_tool_name")
    def test_raises_when_no_end_user(self, mock_find):
        from core.mcp.server.workspace_mcp_server import _handle_call_tool

        mock_app = MagicMock()
        mock_find.return_value = mock_app

        call_request = mcp_types.ClientRequest(
            root=mcp_types.CallToolRequest(
                method="tools/call",
                params=mcp_types.CallToolRequestParams(
                    name="test_app",
                    arguments={},
                ),
            )
        )

        with pytest.raises(ValueError, match="End user is required"):
            _handle_call_tool(TENANT_ID, call_request, None)


class TestHandleUnknownMethod:
    """Tests for unknown method handling."""

    def test_returns_method_not_found_error(self):
        from core.mcp.server.workspace_mcp_server import handle_workspace_mcp_request

        unknown_request = mcp_types.JSONRPCRequest(
            jsonrpc="2.0",
            id=1,
            method="unknown/method",
            params={},
        )
        client_req = mcp_types.ClientRequest(root=unknown_request)

        result = handle_workspace_mcp_request(TENANT_ID, client_req, request_id=1)
        assert result.jsonrpc == "2.0"
        assert result.id == 1
        result_dict = result.model_dump()
        assert "error" in result_dict
        assert result_dict["error"]["code"] == mcp_types.METHOD_NOT_FOUND


class TestBuildToolSchema:
    """Tests for the tool schema builder."""

    def test_builds_workflow_schema(self):
        from core.mcp.server.workspace_mcp_server import _build_tool_schema
        from models.enums import AppMode

        mock_app = MagicMock()
        mock_app.mode = AppMode.WORKFLOW

        schema = _build_tool_schema(mock_app, [], {})
        assert schema["type"] == "object"
        assert "properties" in schema
        assert "required" in schema

    def test_builds_chat_schema_with_query(self):
        from core.mcp.server.workspace_mcp_server import _build_tool_schema
        from models.enums import AppMode

        mock_app = MagicMock()
        mock_app.mode = AppMode.CHAT

        schema = _build_tool_schema(mock_app, [], {})
        assert schema["type"] == "object"
        assert "query" in schema["properties"]
        assert "query" in schema["required"]


class TestPrepareToolArguments:
    """Tests for argument preparation."""

    def test_workflow_mode(self):
        from core.mcp.server.workspace_mcp_server import _prepare_tool_arguments
        from models.enums import AppMode

        mock_app = MagicMock()
        mock_app.mode = AppMode.WORKFLOW

        args = _prepare_tool_arguments(mock_app, {"key": "value"})
        assert args == {"inputs": {"key": "value"}}

    def test_chat_mode(self):
        from core.mcp.server.workspace_mcp_server import _prepare_tool_arguments
        from models.enums import AppMode

        mock_app = MagicMock()
        mock_app.mode = AppMode.CHAT

        args = _prepare_tool_arguments(mock_app, {"query": "hello", "key": "value"})
        assert args == {"query": "hello", "inputs": {"key": "value"}}

    def test_completion_mode(self):
        from core.mcp.server.workspace_mcp_server import _prepare_tool_arguments
        from models.enums import AppMode

        mock_app = MagicMock()
        mock_app.mode = AppMode.COMPLETION

        args = _prepare_tool_arguments(mock_app, {"key": "value"})
        assert args == {"query": "", "inputs": {"key": "value"}}
