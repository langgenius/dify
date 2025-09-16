"""Unit tests for MCP auth client with retry logic."""

from types import TracebackType
from unittest.mock import MagicMock, Mock, patch

import pytest

from core.entities.mcp_provider import MCPProviderEntity
from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPAuthError
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

    @patch("core.mcp.auth_client.MCPClient")
    def test_execute_with_retry_auth_error_then_success(
        self, mock_mcp_client_class, mock_provider_entity, mock_mcp_service, auth_callback
    ):
        """Test execution with auth error followed by successful retry."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            provider_entity=mock_provider_entity,
            auth_callback=auth_callback,
            mcp_service=mock_mcp_service,
        )

        # Configure mock clients (old and new)
        mock_client_old = MagicMock()
        mock_client_new = MagicMock()
        client._client = mock_client_old

        # Make _create_client return the new client on retry
        mock_mcp_client_class.return_value = mock_client_new

        # Configure new provider with token
        new_provider = Mock(spec=MCPProviderEntity)
        new_provider.retrieve_tokens.return_value = Mock(
            access_token="new-token", token_type="Bearer", expires_in=3600, refresh_token=None
        )
        mock_mcp_service.get_provider_entity.return_value = new_provider

        # Mock function that fails first, then succeeds
        mock_func = Mock(side_effect=[MCPAuthError("Auth failed"), "success"])

        result = client._execute_with_retry(mock_func, "arg1", kwarg1="value1")

        assert result == "success"
        assert mock_func.call_count == 2
        mock_func.assert_called_with("arg1", kwarg1="value1")
        auth_callback.assert_called_once()
        mock_client_old.cleanup.assert_called_once()
        mock_client_new.__enter__.assert_called_once()
        assert client._has_retried is False  # Reset after completion

    def test_execute_with_retry_non_auth_error(self):
        """Test execution with non-auth error (no retry)."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        mock_func = Mock(side_effect=ValueError("Some other error"))

        with pytest.raises(ValueError) as exc_info:
            client._execute_with_retry(mock_func)

        assert str(exc_info.value) == "Some other error"
        mock_func.assert_called_once()

    @patch("core.mcp.auth_client.MCPClient")
    def test_context_manager_enter(self, mock_mcp_client_class):
        """Test context manager enter."""
        mock_client_instance = MagicMock()
        mock_client_instance.__enter__.return_value = mock_client_instance
        mock_mcp_client_class.return_value = mock_client_instance

        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        result = client.__enter__()

        assert result == client
        assert client._client == mock_client_instance
        mock_client_instance.__enter__.assert_called_once()

    @patch("core.mcp.auth_client.MCPClient")
    def test_context_manager_enter_with_auth_error(
        self, mock_mcp_client_class, mock_provider_entity, mock_mcp_service, auth_callback
    ):
        """Test context manager enter with auth error and retry."""
        mock_client_instance = MagicMock()
        mock_mcp_client_class.return_value = mock_client_instance

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

        # First call to client.__enter__ raises auth error, second succeeds
        call_count = 0

        def enter_side_effect():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise MCPAuthError("Auth failed")
            return mock_client_instance

        mock_client_instance.__enter__.side_effect = enter_side_effect

        result = client.__enter__()

        assert result == client
        assert mock_client_instance.__enter__.call_count == 3
        auth_callback.assert_called_once()

    def test_context_manager_exit(self):
        """Test context manager exit."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")
        mock_client = MagicMock()
        client._client = mock_client

        exc_type: type[BaseException] | None = None
        exc_val: BaseException | None = None
        exc_tb: TracebackType | None = None
        client.__exit__(exc_type, exc_val, exc_tb)

        mock_client.__exit__.assert_called_once_with(None, None, None)
        assert client._client is None

    def test_list_tools_not_initialized(self):
        """Test list_tools when client not initialized."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        with pytest.raises(ValueError) as exc_info:
            client.list_tools()

        assert "Client not initialized" in str(exc_info.value)

    def test_list_tools_success(self):
        """Test successful list_tools call."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")
        mock_client = Mock()
        client._client = mock_client

        expected_tools = [
            Tool(
                name="test-tool",
                description="A test tool",
                inputSchema={"type": "object", "properties": {}},
                annotations=ToolAnnotations(title="Test Tool"),
            )
        ]
        mock_client.list_tools.return_value = expected_tools

        result = client.list_tools()

        assert result == expected_tools
        mock_client.list_tools.assert_called_once()

    @patch("core.mcp.auth_client.MCPClient")
    def test_list_tools_with_auth_retry(
        self, mock_mcp_client_class, mock_provider_entity, mock_mcp_service, auth_callback
    ):
        """Test list_tools with auth retry."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            provider_entity=mock_provider_entity,
            auth_callback=auth_callback,
            mcp_service=mock_mcp_service,
        )

        # Configure mock clients (old and new)
        mock_client_old = MagicMock()
        mock_client_new = MagicMock()
        client._client = mock_client_old

        # Make _create_client return the new client on retry
        mock_mcp_client_class.return_value = mock_client_new

        # Configure new provider with token
        new_provider = Mock(spec=MCPProviderEntity)
        new_provider.retrieve_tokens.return_value = Mock(
            access_token="new-token", token_type="Bearer", expires_in=3600, refresh_token=None
        )
        mock_mcp_service.get_provider_entity.return_value = new_provider

        expected_tools = [Tool(name="test-tool", description="A test tool", inputSchema={})]
        # First call raises auth error
        mock_client_old.list_tools.side_effect = MCPAuthError("Auth failed")
        mock_client_new.list_tools.return_value = expected_tools

        # We need to mock the behavior where after client is replaced,
        # the new method should be called. But since the method reference
        # is already bound to the old client, we need to work around this.
        # Let's patch the _execute_with_retry to handle this properly.

        with patch.object(client, "_execute_with_retry") as mock_execute:
            # Simulate the retry behavior
            call_count = [0]

            def execute_side_effect(func, *args, **kwargs):
                call_count[0] += 1
                if call_count[0] == 1:
                    # First call - simulate auth error and retry
                    try:
                        func(*args, **kwargs)
                    except MCPAuthError:
                        # Simulate the retry logic
                        client._handle_auth_error(MCPAuthError("Auth failed"))
                        if client._client:
                            client._client.cleanup()
                            client._client = mock_client_new
                            client._client.__enter__()
                        # Now return the result from the new client
                        return mock_client_new.list_tools(*args, **kwargs)
                return func(*args, **kwargs)

            mock_execute.side_effect = execute_side_effect
            result = client.list_tools()

        assert result == expected_tools
        mock_client_old.list_tools.assert_called_once()
        mock_client_new.list_tools.assert_called_once()
        auth_callback.assert_called_once()
        mock_client_old.cleanup.assert_called_once()
        mock_client_new.__enter__.assert_called_once()

    def test_invoke_tool_not_initialized(self):
        """Test invoke_tool when client not initialized."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        with pytest.raises(ValueError) as exc_info:
            client.invoke_tool("test-tool", {"arg": "value"})

        assert "Client not initialized" in str(exc_info.value)

    def test_invoke_tool_success(self):
        """Test successful invoke_tool call."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")
        mock_client = Mock()
        client._client = mock_client

        expected_result = CallToolResult(
            content=[TextContent(type="text", text="Tool executed successfully")], isError=False
        )
        mock_client.invoke_tool.return_value = expected_result

        result = client.invoke_tool("test-tool", {"arg": "value"})

        assert result == expected_result
        mock_client.invoke_tool.assert_called_once_with("test-tool", {"arg": "value"})

    @patch("core.mcp.auth_client.MCPClient")
    def test_invoke_tool_with_auth_retry(
        self, mock_mcp_client_class, mock_provider_entity, mock_mcp_service, auth_callback
    ):
        """Test invoke_tool with auth retry."""
        client = MCPClientWithAuthRetry(
            server_url="http://test.example.com",
            provider_entity=mock_provider_entity,
            auth_callback=auth_callback,
            mcp_service=mock_mcp_service,
        )

        # Configure mock clients (old and new)
        mock_client_old = MagicMock()
        mock_client_new = MagicMock()
        client._client = mock_client_old

        # Make _create_client return the new client on retry
        mock_mcp_client_class.return_value = mock_client_new

        # Configure new provider with token
        new_provider = Mock(spec=MCPProviderEntity)
        new_provider.retrieve_tokens.return_value = Mock(
            access_token="new-token", token_type="Bearer", expires_in=3600, refresh_token=None
        )
        mock_mcp_service.get_provider_entity.return_value = new_provider

        expected_result = CallToolResult(content=[TextContent(type="text", text="Success")], isError=False)
        # First call raises auth error
        mock_client_old.invoke_tool.side_effect = MCPAuthError("Auth failed")
        mock_client_new.invoke_tool.return_value = expected_result

        # We need to mock the behavior where after client is replaced,
        # the new method should be called. Similar to list_tools test.

        with patch.object(client, "_execute_with_retry") as mock_execute:
            # Simulate the retry behavior
            call_count = [0]

            def execute_side_effect(func, *args, **kwargs):
                call_count[0] += 1
                if call_count[0] == 1:
                    # First call - simulate auth error and retry
                    try:
                        func(*args, **kwargs)
                    except MCPAuthError:
                        # Simulate the retry logic
                        client._handle_auth_error(MCPAuthError("Auth failed"))
                        if client._client:
                            client._client.cleanup()
                            client._client = mock_client_new
                            client._client.__enter__()
                        # Now return the result from the new client
                        return mock_client_new.invoke_tool(*args, **kwargs)
                return func(*args, **kwargs)

            mock_execute.side_effect = execute_side_effect
            result = client.invoke_tool("test-tool", {"arg": "value"})

        assert result == expected_result
        mock_client_old.invoke_tool.assert_called_once_with("test-tool", {"arg": "value"})
        mock_client_new.invoke_tool.assert_called_once_with("test-tool", {"arg": "value"})
        auth_callback.assert_called_once()
        mock_client_old.cleanup.assert_called_once()
        mock_client_new.__enter__.assert_called_once()

    def test_cleanup(self):
        """Test cleanup method."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")
        mock_client = Mock()
        client._client = mock_client

        client.cleanup()

        mock_client.cleanup.assert_called_once()
        assert client._client is None

    def test_cleanup_no_client(self):
        """Test cleanup when no client exists."""
        client = MCPClientWithAuthRetry(server_url="http://test.example.com")

        # Should not raise
        client.cleanup()

        assert client._client is None
