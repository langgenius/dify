"""Unit tests for MCP auth client with retry logic."""

from types import TracebackType
from unittest.mock import Mock, patch

import pytest

from core.entities.mcp_provider import MCPProviderEntity
from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPAuthError
from core.mcp.mcp_client import MCPClient
from core.mcp.types import CallToolResult, TextContent, Tool, ToolAnnotations


class TestMCPClientWithAuthRetry:
    """Test suite for MCPClientWithAuthRetry."""

    @pytest.fixture
    def mock_provider_entity(self):
        """Create a mock provider entity."""
        provider = Mock(spec=MCPProviderEntity)
        provider.id = "test-provider-id"
        provider.tenant_id = "test-tenant-id"
        provider.retrieve_tokens.return_value = Mock(
            access_token="test-token", token_type="Bearer", expires_in=3600, refresh_token=None
        )
        return provider

    @pytest.fixture
    def mock_mcp_service(self):
        """Create a mock MCP service."""
        service = Mock()
        service.get_provider_entity.return_value = Mock(
            retrieve_tokens=lambda: Mock(
                access_token="new-test-token", token_type="Bearer", expires_in=3600, refresh_token=None
            )
        )
        return service

    @pytest.fixture
    def auth_callback(self):
        """Create a mock auth callback."""
        return Mock()

    def test_init(self, mock_provider_entity, mock_mcp_service, auth_callback):
        """Test client initialization."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            headers={"Authorization": "Bearer test"},
            timeout=30.0,
            sse_read_timeout=60.0,
            provider_entity=mock_provider_entity,
            auth_callback=auth_callback,
            authorization_code="test-auth-code",
            by_server_id=True,
            mcp_service=mock_mcp_service,
        )

        assert client.server_url == "http://test.example.com"
        assert client.headers == {"Authorization": "Bearer test"}
        assert client.timeout == 30.0
        assert client.sse_read_timeout == 60.0
        assert client.provider_entity == mock_provider_entity
        assert client.auth_callback == auth_callback
        assert client.authorization_code == "test-auth-code"
        assert client.by_server_id is True
        assert client.mcp_service == mock_mcp_service
        assert client._has_retried is False
        # In inheritance design, we don't have _client attribute
        assert hasattr(client, "_session")  # Inherited from MCPClient

    def test_inheritance_structure(self):
        """Test that MCPClientWithAuthRetry properly inherits from MCPClient."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            headers={"Authorization": "Bearer test"},
        )

        # Verify inheritance
        assert isinstance(client, MCPClient)

        # Verify inherited attributes are accessible
        assert hasattr(client, "server_url")
        assert hasattr(client, "headers")
        assert hasattr(client, "_session")
        assert hasattr(client, "_exit_stack")
        assert hasattr(client, "_initialized")

    def test_handle_auth_error_no_retry_components(self):
        """Test auth error handling when retry components are missing."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")
        error = MCPAuthError("Auth failed")

        with pytest.raises(MCPAuthError) as exc_info:
            client._handle_auth_error(error)

        assert exc_info.value == error

    def test_handle_auth_error_already_retried(self, mock_provider_entity, mock_mcp_service, auth_callback):
        """Test auth error handling when already retried."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            provider_entity=mock_provider_entity,
            auth_callback=auth_callback,
            mcp_service=mock_mcp_service,
        )
        client._has_retried = True
        error = MCPAuthError("Auth failed")

        with pytest.raises(MCPAuthError) as exc_info:
            client._handle_auth_error(error)

        assert exc_info.value == error
        auth_callback.assert_not_called()

    def test_handle_auth_error_successful_refresh(self, mock_provider_entity, mock_mcp_service, auth_callback):
        """Test successful auth refresh on error."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            provider_entity=mock_provider_entity,
            auth_callback=auth_callback,
            authorization_code="test-code",
            by_server_id=True,
            mcp_service=mock_mcp_service,
        )

        # Configure mocks
        new_provider = Mock(spec=MCPProviderEntity)
        new_provider.id = "test-provider-id"
        new_provider.tenant_id = "test-tenant-id"
        new_provider.retrieve_tokens.return_value = Mock(
            access_token="new-token", token_type="Bearer", expires_in=3600, refresh_token=None
        )
        mock_mcp_service.get_provider_entity.return_value = new_provider

        error = MCPAuthError("Auth failed")
        client._handle_auth_error(error)

        # Verify auth flow
        auth_callback.assert_called_once_with(mock_provider_entity, mock_mcp_service, "test-code")
        mock_mcp_service.get_provider_entity.assert_called_once_with(
            "test-provider-id", "test-tenant-id", by_server_id=True
        )
        assert client.headers["Authorization"] == "Bearer new-token"
        assert client.authorization_code is None  # Should be cleared after use
        assert client._has_retried is True

    def test_handle_auth_error_refresh_fails(self, mock_provider_entity, mock_mcp_service, auth_callback):
        """Test auth refresh failure."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            provider_entity=mock_provider_entity,
            auth_callback=auth_callback,
            mcp_service=mock_mcp_service,
        )

        auth_callback.side_effect = Exception("Auth callback failed")

        error = MCPAuthError("Original auth failed")
        with pytest.raises(MCPAuthError) as exc_info:
            client._handle_auth_error(error)

        assert "Authentication retry failed" in str(exc_info.value)

    def test_handle_auth_error_no_token_received(self, mock_provider_entity, mock_mcp_service, auth_callback):
        """Test auth refresh when no token is received."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            provider_entity=mock_provider_entity,
            auth_callback=auth_callback,
            mcp_service=mock_mcp_service,
        )

        # Configure mock to return no token
        new_provider = Mock(spec=MCPProviderEntity)
        new_provider.retrieve_tokens.return_value = None
        mock_mcp_service.get_provider_entity.return_value = new_provider

        error = MCPAuthError("Auth failed")
        with pytest.raises(MCPAuthError) as exc_info:
            client._handle_auth_error(error)

        assert "no token received" in str(exc_info.value)

    def test_execute_with_retry_success(self):
        """Test successful execution without retry."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        mock_func = Mock(return_value="success")
        result = client._execute_with_retry(mock_func, "arg1", kwarg1="value1")

        assert result == "success"
        mock_func.assert_called_once_with("arg1", kwarg1="value1")
        assert client._has_retried is False

    def test_execute_with_retry_auth_error_then_success(self, mock_provider_entity, mock_mcp_service, auth_callback):
        """Test execution with auth error followed by successful retry."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            provider_entity=mock_provider_entity,
            auth_callback=auth_callback,
            mcp_service=mock_mcp_service,
        )

        # Configure new provider with token
        new_provider = Mock(spec=MCPProviderEntity)
        new_provider.retrieve_tokens.return_value = Mock(
            access_token="new-token", token_type="Bearer", expires_in=3600, refresh_token=None
        )
        mock_mcp_service.get_provider_entity.return_value = new_provider

        # Mock function that fails first, then succeeds
        mock_func = Mock(side_effect=[MCPAuthError("Auth failed"), "success"])

        # Mock the exit stack and session cleanup
        with (
            patch.object(client, "_exit_stack") as mock_exit_stack,
            patch.object(client, "_session") as mock_session,
            patch.object(client, "_initialize") as mock_initialize,
        ):
            client._initialized = True
            result = client._execute_with_retry(mock_func, "arg1", kwarg1="value1")

            assert result == "success"
            assert mock_func.call_count == 2
            mock_func.assert_called_with("arg1", kwarg1="value1")
            auth_callback.assert_called_once()
            mock_exit_stack.close.assert_called_once()
            mock_initialize.assert_called_once()
            assert client._has_retried is False  # Reset after completion

    def test_execute_with_retry_non_auth_error(self):
        """Test execution with non-auth error (no retry)."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        mock_func = Mock(side_effect=ValueError("Some other error"))

        with pytest.raises(ValueError) as exc_info:
            client._execute_with_retry(mock_func)

        assert str(exc_info.value) == "Some other error"
        mock_func.assert_called_once()

    def test_context_manager_enter(self):
        """Test context manager enter."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        with patch.object(client, "_initialize") as mock_initialize:
            result = client.__enter__()

            assert result == client
            assert client._initialized is True
            mock_initialize.assert_called_once()

    def test_context_manager_enter_with_auth_error(self, mock_provider_entity, mock_mcp_service, auth_callback):
        """Test context manager enter with auth error and retry."""
        # Configure new provider with token
        new_provider = Mock(spec=MCPProviderEntity)
        new_provider.retrieve_tokens.return_value = Mock(
            access_token="new-token", token_type="Bearer", expires_in=3600, refresh_token=None
        )
        mock_mcp_service.get_provider_entity.return_value = new_provider

        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            provider_entity=mock_provider_entity,
            auth_callback=auth_callback,
            mcp_service=mock_mcp_service,
        )

        # Mock parent class __enter__ to raise auth error first, then succeed
        with patch.object(MCPClient, "__enter__") as mock_parent_enter:
            mock_parent_enter.side_effect = [MCPAuthError("Auth failed"), client]

            result = client.__enter__()

            assert result == client
            assert mock_parent_enter.call_count == 2
            auth_callback.assert_called_once()

    def test_context_manager_exit(self):
        """Test context manager exit."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        with patch.object(client, "cleanup") as mock_cleanup:
            exc_type: type[BaseException] | None = None
            exc_val: BaseException | None = None
            exc_tb: TracebackType | None = None
            client.__exit__(exc_type, exc_val, exc_tb)

            mock_cleanup.assert_called_once()

    def test_list_tools_not_initialized(self):
        """Test list_tools when client not initialized."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        with pytest.raises(ValueError) as exc_info:
            client.list_tools()

        assert "Session not initialized" in str(exc_info.value)

    def test_list_tools_success(self):
        """Test successful list_tools call."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        expected_tools = [
            Tool(
                name="test-tool",
                description="A test tool",
                inputSchema={"type": "object", "properties": {}},
                annotations=ToolAnnotations(title="Test Tool"),
            )
        ]

        # Mock the parent class list_tools method
        with patch.object(MCPClient, "list_tools", return_value=expected_tools):
            result = client.list_tools()
            assert result == expected_tools

    def test_list_tools_with_auth_retry(self, mock_provider_entity, mock_mcp_service, auth_callback):
        """Test list_tools with auth retry."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            provider_entity=mock_provider_entity,
            auth_callback=auth_callback,
            mcp_service=mock_mcp_service,
        )

        # Configure new provider with token
        new_provider = Mock(spec=MCPProviderEntity)
        new_provider.retrieve_tokens.return_value = Mock(
            access_token="new-token", token_type="Bearer", expires_in=3600, refresh_token=None
        )
        mock_mcp_service.get_provider_entity.return_value = new_provider

        expected_tools = [Tool(name="test-tool", description="A test tool", inputSchema={})]

        # Mock parent class list_tools to raise auth error first, then succeed
        with patch.object(MCPClient, "list_tools") as mock_list_tools:
            mock_list_tools.side_effect = [MCPAuthError("Auth failed"), expected_tools]

            result = client.list_tools()

            assert result == expected_tools
            assert mock_list_tools.call_count == 2
            auth_callback.assert_called_once()

    def test_invoke_tool_not_initialized(self):
        """Test invoke_tool when client not initialized."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        with pytest.raises(ValueError) as exc_info:
            client.invoke_tool("test-tool", {"arg": "value"})

        assert "Session not initialized" in str(exc_info.value)

    def test_invoke_tool_success(self):
        """Test successful invoke_tool call."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        expected_result = CallToolResult(
            content=[TextContent(type="text", text="Tool executed successfully")], isError=False
        )

        # Mock the parent class invoke_tool method
        with patch.object(MCPClient, "invoke_tool", return_value=expected_result) as mock_invoke:
            result = client.invoke_tool("test-tool", {"arg": "value"})

            assert result == expected_result
            mock_invoke.assert_called_once_with("test-tool", {"arg": "value"})

    def test_invoke_tool_with_auth_retry(self, mock_provider_entity, mock_mcp_service, auth_callback):
        """Test invoke_tool with auth retry."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            provider_entity=mock_provider_entity,
            auth_callback=auth_callback,
            mcp_service=mock_mcp_service,
        )

        # Configure new provider with token
        new_provider = Mock(spec=MCPProviderEntity)
        new_provider.retrieve_tokens.return_value = Mock(
            access_token="new-token", token_type="Bearer", expires_in=3600, refresh_token=None
        )
        mock_mcp_service.get_provider_entity.return_value = new_provider

        expected_result = CallToolResult(content=[TextContent(type="text", text="Success")], isError=False)

        # Mock parent class invoke_tool to raise auth error first, then succeed
        with patch.object(MCPClient, "invoke_tool") as mock_invoke_tool:
            mock_invoke_tool.side_effect = [MCPAuthError("Auth failed"), expected_result]

            result = client.invoke_tool("test-tool", {"arg": "value"})

            assert result == expected_result
            assert mock_invoke_tool.call_count == 2
            mock_invoke_tool.assert_called_with("test-tool", {"arg": "value"})
            auth_callback.assert_called_once()

    def test_cleanup(self):
        """Test cleanup method."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        # Mock the parent class cleanup method
        with patch.object(MCPClient, "cleanup") as mock_cleanup:
            client.cleanup()
            mock_cleanup.assert_called_once()

    def test_cleanup_no_client(self):
        """Test cleanup when no client exists."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        # Should not raise
        client.cleanup()

        # Since MCPClientWithAuthRetry inherits from MCPClient,
        # it doesn't have a _client attribute. The test should just
        # verify that cleanup can be called without error.
        assert not hasattr(client, "_client")
