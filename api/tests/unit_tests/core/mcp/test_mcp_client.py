"""Unit tests for MCP client."""

from contextlib import ExitStack
from types import TracebackType
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy.orm import Session

from core.entities.mcp_provider import MCPProviderEntity
from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPAuthError, MCPConnectionError
from core.mcp.mcp_client import MCPClient
from core.mcp.types import CallToolResult, ListToolsResult, OAuthTokens, TextContent, Tool, ToolAnnotations


class TestMCPClient:
    """Test suite for MCPClient."""

    def test_init(self):
        """Test client initialization."""
        client = MCPClient(
            server_url="http://test.example.com/mcp",
            headers={"Authorization": "Bearer test"},
            timeout=30.0,
            sse_read_timeout=60.0,
        )

        assert client.server_url == "http://test.example.com/mcp"
        assert client.headers == {"Authorization": "Bearer test"}
        assert client.timeout == 30.0
        assert client.sse_read_timeout == 60.0
        assert client._session is None
        assert isinstance(client._exit_stack, ExitStack)
        assert client._initialized is False

    def test_init_defaults(self):
        """Test client initialization with defaults."""
        client = MCPClient(server_url="http://test.example.com")

        assert client.server_url == "http://test.example.com"
        assert client.headers == {}
        assert client.timeout is None
        assert client.sse_read_timeout is None

    @patch("core.mcp.mcp_client.streamablehttp_client")
    @patch("core.mcp.mcp_client.ClientSession")
    def test_initialize_with_mcp_url(self, mock_client_session, mock_streamable_client):
        """Test initialization with MCP URL."""
        # Setup mocks
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_client_context = Mock()
        mock_streamable_client.return_value.__enter__.return_value = (
            mock_read_stream,
            mock_write_stream,
            mock_client_context,
        )

        mock_session = Mock()
        mock_client_session.return_value.__enter__.return_value = mock_session

        client = MCPClient(server_url="http://test.example.com/mcp")
        client._initialize()

        # Verify streamable client was called
        mock_streamable_client.assert_called_once_with(
            url="http://test.example.com/mcp",
            headers={},
            timeout=None,
            sse_read_timeout=None,
        )

        # Verify session was created
        mock_client_session.assert_called_once_with(mock_read_stream, mock_write_stream)
        mock_session.initialize.assert_called_once()
        assert client._session == mock_session

    @patch("core.mcp.mcp_client.sse_client")
    @patch("core.mcp.mcp_client.ClientSession")
    def test_initialize_with_sse_url(self, mock_client_session, mock_sse_client):
        """Test initialization with SSE URL."""
        # Setup mocks
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_sse_client.return_value.__enter__.return_value = (mock_read_stream, mock_write_stream)

        mock_session = Mock()
        mock_client_session.return_value.__enter__.return_value = mock_session

        client = MCPClient(server_url="http://test.example.com/sse")
        client._initialize()

        # Verify SSE client was called
        mock_sse_client.assert_called_once_with(
            url="http://test.example.com/sse",
            headers={},
            timeout=None,
            sse_read_timeout=None,
        )

        # Verify session was created
        mock_client_session.assert_called_once_with(mock_read_stream, mock_write_stream)
        mock_session.initialize.assert_called_once()
        assert client._session == mock_session

    @patch("core.mcp.mcp_client.sse_client")
    @patch("core.mcp.mcp_client.streamablehttp_client")
    @patch("core.mcp.mcp_client.ClientSession")
    def test_initialize_with_unknown_method_fallback_to_sse(
        self, mock_client_session, mock_streamable_client, mock_sse_client
    ):
        """Test initialization with unknown method falls back to SSE."""
        # Setup mocks
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_sse_client.return_value.__enter__.return_value = (mock_read_stream, mock_write_stream)

        mock_session = Mock()
        mock_client_session.return_value.__enter__.return_value = mock_session

        client = MCPClient(server_url="http://test.example.com/unknown")
        client._initialize()

        # Verify SSE client was tried
        mock_sse_client.assert_called_once()
        mock_streamable_client.assert_not_called()

        # Verify session was created
        assert client._session == mock_session

    @patch("core.mcp.mcp_client.sse_client")
    @patch("core.mcp.mcp_client.streamablehttp_client")
    @patch("core.mcp.mcp_client.ClientSession")
    def test_initialize_fallback_from_sse_to_mcp(self, mock_client_session, mock_streamable_client, mock_sse_client):
        """Test initialization falls back from SSE to MCP on connection error."""
        # Setup SSE to fail
        mock_sse_client.side_effect = MCPConnectionError("SSE connection failed")

        # Setup MCP to succeed
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_client_context = Mock()
        mock_streamable_client.return_value.__enter__.return_value = (
            mock_read_stream,
            mock_write_stream,
            mock_client_context,
        )

        mock_session = Mock()
        mock_client_session.return_value.__enter__.return_value = mock_session

        client = MCPClient(server_url="http://test.example.com/unknown")
        client._initialize()

        # Verify both were tried
        mock_sse_client.assert_called_once()
        mock_streamable_client.assert_called_once()

        # Verify session was created with MCP
        assert client._session == mock_session

    @patch("core.mcp.mcp_client.streamablehttp_client")
    @patch("core.mcp.mcp_client.ClientSession")
    def test_connect_server_mcp(self, mock_client_session, mock_streamable_client):
        """Test connect_server with MCP method."""
        # Setup mocks
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_client_context = Mock()
        mock_streamable_client.return_value.__enter__.return_value = (
            mock_read_stream,
            mock_write_stream,
            mock_client_context,
        )

        mock_session = Mock()
        mock_client_session.return_value.__enter__.return_value = mock_session

        client = MCPClient(server_url="http://test.example.com")
        client.connect_server(mock_streamable_client, "mcp")

        # Verify correct streams were passed
        mock_client_session.assert_called_once_with(mock_read_stream, mock_write_stream)
        mock_session.initialize.assert_called_once()

    @patch("core.mcp.mcp_client.sse_client")
    @patch("core.mcp.mcp_client.ClientSession")
    def test_connect_server_sse(self, mock_client_session, mock_sse_client):
        """Test connect_server with SSE method."""
        # Setup mocks
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_sse_client.return_value.__enter__.return_value = (mock_read_stream, mock_write_stream)

        mock_session = Mock()
        mock_client_session.return_value.__enter__.return_value = mock_session

        client = MCPClient(server_url="http://test.example.com")
        client.connect_server(mock_sse_client, "sse")

        # Verify correct streams were passed
        mock_client_session.assert_called_once_with(mock_read_stream, mock_write_stream)
        mock_session.initialize.assert_called_once()

    def test_context_manager_enter(self):
        """Test context manager enter."""
        client = MCPClient(server_url="http://test.example.com")

        with patch.object(client, "_initialize") as mock_initialize:
            result = client.__enter__()

            assert result == client
            assert client._initialized is True
            mock_initialize.assert_called_once()

    def test_context_manager_exit(self):
        """Test context manager exit."""
        client = MCPClient(server_url="http://test.example.com")

        with patch.object(client, "cleanup") as mock_cleanup:
            exc_type: type[BaseException] | None = None
            exc_val: BaseException | None = None
            exc_tb: TracebackType | None = None
            client.__exit__(exc_type, exc_val, exc_tb)

            mock_cleanup.assert_called_once()

    def test_list_tools_not_initialized(self):
        """Test list_tools when session not initialized."""
        client = MCPClient(server_url="http://test.example.com")

        with pytest.raises(ValueError) as exc_info:
            client.list_tools()

        assert "Session not initialized" in str(exc_info.value)

    def test_list_tools_success(self):
        """Test successful list_tools call."""
        client = MCPClient(server_url="http://test.example.com")

        # Setup mock session
        mock_session = Mock()
        expected_tools = [
            Tool(
                name="test-tool",
                description="A test tool",
                inputSchema={"type": "object", "properties": {}},
                annotations=ToolAnnotations(title="Test Tool"),
            )
        ]
        mock_session.list_tools.return_value = ListToolsResult(tools=expected_tools)
        client._session = mock_session

        result = client.list_tools()

        assert result == expected_tools
        mock_session.list_tools.assert_called_once()

    def test_invoke_tool_not_initialized(self):
        """Test invoke_tool when session not initialized."""
        client = MCPClient(server_url="http://test.example.com")

        with pytest.raises(ValueError) as exc_info:
            client.invoke_tool("test-tool", {"arg": "value"})

        assert "Session not initialized" in str(exc_info.value)

    def test_invoke_tool_success(self):
        """Test successful invoke_tool call."""
        client = MCPClient(server_url="http://test.example.com")

        # Setup mock session
        mock_session = Mock()
        expected_result = CallToolResult(
            content=[TextContent(type="text", text="Tool executed successfully")],
            isError=False,
        )
        mock_session.call_tool.return_value = expected_result
        client._session = mock_session

        result = client.invoke_tool("test-tool", {"arg": "value"})

        assert result == expected_result
        mock_session.call_tool.assert_called_once_with("test-tool", {"arg": "value"})

    def test_cleanup(self):
        """Test cleanup method."""
        client = MCPClient(server_url="http://test.example.com")
        mock_exit_stack = Mock(spec=ExitStack)
        client._exit_stack = mock_exit_stack
        client._session = Mock()
        client._initialized = True

        client.cleanup()

        mock_exit_stack.close.assert_called_once()
        assert client._session is None
        assert client._initialized is False

    def test_cleanup_with_error(self):
        """Test cleanup method with error."""
        client = MCPClient(server_url="http://test.example.com")
        mock_exit_stack = Mock(spec=ExitStack)
        mock_exit_stack.close.side_effect = Exception("Cleanup error")
        client._exit_stack = mock_exit_stack
        client._session = Mock()
        client._initialized = True

        with pytest.raises(ValueError) as exc_info:
            client.cleanup()

        assert "Error during cleanup: Cleanup error" in str(exc_info.value)
        assert client._session is None
        assert client._initialized is False

    @patch("core.mcp.mcp_client.streamablehttp_client")
    @patch("core.mcp.mcp_client.ClientSession")
    def test_full_context_manager_flow(self, mock_client_session, mock_streamable_client):
        """Test full context manager flow."""
        # Setup mocks
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_client_context = Mock()
        mock_streamable_client.return_value.__enter__.return_value = (
            mock_read_stream,
            mock_write_stream,
            mock_client_context,
        )

        mock_session = Mock()
        mock_client_session.return_value.__enter__.return_value = mock_session

        expected_tools = [Tool(name="test-tool", description="Test", inputSchema={})]
        mock_session.list_tools.return_value = ListToolsResult(tools=expected_tools)

        with MCPClient(server_url="http://test.example.com/mcp") as client:
            assert client._initialized is True
            assert client._session == mock_session

            # Test tool operations
            tools = client.list_tools()
            assert tools == expected_tools

        # After exit, should be cleaned up
        assert client._initialized is False
        assert client._session is None

    def test_headers_passed_to_clients(self):
        """Test that headers are properly passed to underlying clients."""
        custom_headers = {
            "Authorization": "Bearer test-token",
            "X-Custom-Header": "test-value",
        }

        with patch("core.mcp.mcp_client.streamablehttp_client") as mock_streamable_client:
            with patch("core.mcp.mcp_client.ClientSession") as mock_client_session:
                # Setup mocks
                mock_read_stream = Mock()
                mock_write_stream = Mock()
                mock_client_context = Mock()
                mock_streamable_client.return_value.__enter__.return_value = (
                    mock_read_stream,
                    mock_write_stream,
                    mock_client_context,
                )

                mock_session = Mock()
                mock_client_session.return_value.__enter__.return_value = mock_session

                client = MCPClient(
                    server_url="http://test.example.com/mcp",
                    headers=custom_headers,
                    timeout=30.0,
                    sse_read_timeout=60.0,
                )
                client._initialize()

                # Verify headers were passed
                mock_streamable_client.assert_called_once_with(
                    url="http://test.example.com/mcp",
                    headers=custom_headers,
                    timeout=30.0,
                    sse_read_timeout=60.0,
                )


class TestMCPClientWithAuthRetry:
    """Test suite for MCPClientWithAuthRetry."""

    @pytest.fixture
    def mock_provider(self):
        provider = MagicMock(spec=MCPProviderEntity)
        provider.id = "test-provider-id"
        provider.tenant_id = "test-tenant-id"
        provider.retrieve_tokens.return_value = OAuthTokens(
            access_token="new-token",
            token_type="Bearer",
            expires_in=3600,
            refresh_token="refresh-token",
        )
        return provider

    @pytest.fixture
    def auth_client(self, mock_provider):
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            headers={"Authorization": "Bearer old-token"},
            provider_entity=mock_provider,
            authorization_code="test-code",
            by_server_id=True,
        )
        return client

    def test_init(self, mock_provider):
        """Test initialization."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            headers={"Authorization": "Bearer test"},
            timeout=30.0,
            provider_entity=mock_provider,
            authorization_code="initial-code",
            by_server_id=True,
        )

        assert client.server_url == "http://test.example.com"
        assert client.headers == {"Authorization": "Bearer test"}
        assert client.timeout == 30.0
        assert client.provider_entity == mock_provider
        assert client.authorization_code == "initial-code"
        assert client.by_server_id is True
        assert client._has_retried is False

    @patch("core.mcp.auth_client.db")
    @patch("core.mcp.auth_client.Session")
    @patch("services.tools.mcp_tools_manage_service.MCPToolManageService")
    def test_handle_auth_error_success(
        self, mock_service_class, mock_session_class, mock_db, auth_client, mock_provider
    ):
        mock_session = MagicMock(spec=Session)
        mock_session_class.return_value.__enter__.return_value = mock_session

        mock_service = mock_service_class.return_value
        new_provider = MagicMock(spec=MCPProviderEntity)
        new_provider.retrieve_tokens.return_value = OAuthTokens(
            access_token="new-access-token",
            token_type="Bearer",
            expires_in=3600,
            refresh_token="new-refresh-token",
        )
        mock_service.get_provider_entity.return_value = new_provider

        # MCPAuthError parses resource_metadata and scope from www_authenticate_header
        www_auth = 'Bearer resource_metadata="http://meta", scope="read"'
        error = MCPAuthError("Auth failed", www_authenticate_header=www_auth)

        auth_client._handle_auth_error(error)

        # Verify service calls - error.resource_metadata_url and error.scope_hint are parsed from header
        mock_service.auth_with_actions.assert_called_once_with(
            mock_provider,
            "test-code",
            resource_metadata_url="http://meta",
            scope_hint="read",
        )
        mock_service.get_provider_entity.assert_called_once_with(
            mock_provider.id, mock_provider.tenant_id, by_server_id=True
        )

        # Verify client updates
        assert auth_client.headers["Authorization"] == "Bearer new-access-token"
        assert auth_client.authorization_code is None
        assert auth_client._has_retried is True
        assert auth_client.provider_entity == new_provider

    def test_handle_auth_error_no_provider(self, auth_client):
        """Test auth error handling when no provider entity is set."""
        auth_client.provider_entity = None
        error = MCPAuthError("Auth failed")

        with pytest.raises(MCPAuthError) as exc_info:
            auth_client._handle_auth_error(error)

        assert exc_info.value == error

    def test_handle_auth_error_already_retried(self, auth_client):
        """Test auth error handling when already retried."""
        auth_client._has_retried = True
        error = MCPAuthError("Auth failed")

        with pytest.raises(MCPAuthError) as exc_info:
            auth_client._handle_auth_error(error)

        assert exc_info.value == error

    @patch("core.mcp.auth_client.db")
    @patch("core.mcp.auth_client.Session")
    @patch("services.tools.mcp_tools_manage_service.MCPToolManageService")
    def test_handle_auth_error_no_token(
        self, mock_service_class, mock_session_class, mock_db, auth_client, mock_provider
    ):
        """Test auth error handling when no token is received."""
        mock_session_class.return_value.__enter__.return_value = MagicMock()
        mock_service = mock_service_class.return_value

        new_provider = MagicMock(spec=MCPProviderEntity)
        new_provider.retrieve_tokens.return_value = None
        mock_service.get_provider_entity.return_value = new_provider

        error = MCPAuthError("Auth failed")

        with pytest.raises(MCPAuthError) as exc_info:
            auth_client._handle_auth_error(error)

        assert "Authentication failed - no token received" in str(exc_info.value)

    @patch("core.mcp.auth_client.db")
    @patch("core.mcp.auth_client.Session")
    @patch("services.tools.mcp_tools_manage_service.MCPToolManageService")
    def test_handle_auth_error_generic_exception(self, mock_service_class, mock_session_class, mock_db, auth_client):
        """Test auth error handling when a generic exception occurs."""
        mock_session_class.side_effect = Exception("DB error")

        error = MCPAuthError("Auth failed")

        with pytest.raises(MCPAuthError) as exc_info:
            auth_client._handle_auth_error(error)

        assert "Authentication retry failed: DB error" in str(exc_info.value)

    @patch("core.mcp.auth_client.db")
    @patch("core.mcp.auth_client.Session")
    @patch("services.tools.mcp_tools_manage_service.MCPToolManageService")
    def test_handle_auth_error_mcp_auth_error_propagation(
        self, mock_service_class, mock_session_class, mock_db, auth_client
    ):
        """Test that MCPAuthError during refresh is propagated as is."""
        mock_session_class.return_value.__enter__.return_value = MagicMock()
        mock_service = mock_service_class.return_value
        mock_service.auth_with_actions.side_effect = MCPAuthError("Refresh failed")

        error = MCPAuthError("Initial auth failed")

        with pytest.raises(MCPAuthError) as exc_info:
            auth_client._handle_auth_error(error)

        assert "Refresh failed" in str(exc_info.value)

    def test_execute_with_retry_success_first_try(self, auth_client):
        """Test execution success on first try."""
        mock_func = MagicMock(return_value="success")

        result = auth_client._execute_with_retry(mock_func, "arg1", kwarg1="val1")

        assert result == "success"
        mock_func.assert_called_once_with("arg1", kwarg1="val1")
        assert auth_client._has_retried is False

    @patch.object(MCPClientWithAuthRetry, "_handle_auth_error")
    @patch.object(MCPClientWithAuthRetry, "_initialize")
    def test_execute_with_retry_success_on_retry_initialized(self, mock_initialize, mock_handle_auth, auth_client):
        """Test execution success on retry after auth error when client was already initialized."""
        mock_func = MagicMock()
        mock_func.side_effect = [MCPAuthError("Auth failed"), "success"]

        auth_client._initialized = True
        auth_client._exit_stack = MagicMock()

        result = auth_client._execute_with_retry(mock_func, "arg")

        assert result == "success"
        assert mock_func.call_count == 2
        mock_handle_auth.assert_called_once()
        mock_initialize.assert_called_once()
        auth_client._exit_stack.close.assert_called_once()
        assert auth_client._has_retried is False

    @patch.object(MCPClientWithAuthRetry, "_handle_auth_error")
    @patch.object(MCPClientWithAuthRetry, "_initialize")
    def test_execute_with_retry_success_on_retry_not_initialized(self, mock_initialize, mock_handle_auth, auth_client):
        """Test retry when client was NOT initialized (skips cleanup/re-init)."""
        mock_func = MagicMock()
        mock_func.side_effect = [MCPAuthError("Auth failed"), "result"]

        auth_client._initialized = False

        result = auth_client._execute_with_retry(mock_func, "arg")

        assert result == "result"
        assert mock_func.call_count == 2
        mock_handle_auth.assert_called_once()
        mock_initialize.assert_not_called()
        assert auth_client._has_retried is False

    @patch.object(MCPClientWithAuthRetry, "_handle_auth_error")
    def test_execute_with_retry_failure_on_retry(self, mock_handle_auth, auth_client):
        """Test execution failure even after retry."""
        mock_func = MagicMock()
        mock_func.side_effect = [MCPAuthError("First fail"), MCPAuthError("Second fail")]

        with pytest.raises(MCPAuthError) as exc_info:
            auth_client._execute_with_retry(mock_func, "arg")

        assert "Second fail" in str(exc_info.value)
        assert mock_func.call_count == 2
        mock_handle_auth.assert_called_once()
        assert auth_client._has_retried is False

    @patch.object(MCPClientWithAuthRetry, "_execute_with_retry")
    def test_auth_client_context_manager_enter(self, mock_execute_retry, auth_client):
        """Test context manager __enter__."""
        auth_client.__enter__()

        mock_execute_retry.assert_called_once()
        func = mock_execute_retry.call_args[0][0]

        with patch("core.mcp.mcp_client.MCPClient.__enter__") as mock_base_enter:
            result = func()
            assert result == auth_client
            mock_base_enter.assert_called_once()

    @patch.object(MCPClientWithAuthRetry, "_execute_with_retry")
    def test_auth_client_list_tools(self, mock_execute_retry, auth_client):
        """Test list_tools with retry."""
        auth_client.list_tools()

        mock_execute_retry.assert_called_once()
        assert mock_execute_retry.call_args[0][0].__name__ == "list_tools"

    @patch.object(MCPClientWithAuthRetry, "_execute_with_retry")
    def test_auth_client_invoke_tool(self, mock_execute_retry, auth_client):
        """Test invoke_tool with retry."""
        auth_client.invoke_tool("test-tool", {"arg": "val"})

        mock_execute_retry.assert_called_once()
        assert mock_execute_retry.call_args[0][0].__name__ == "invoke_tool"
        assert mock_execute_retry.call_args[0][1] == "test-tool"
        assert mock_execute_retry.call_args[0][2] == {"arg": "val"}
