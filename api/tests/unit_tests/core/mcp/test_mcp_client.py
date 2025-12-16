"""Unit tests for MCP client."""

from contextlib import ExitStack
from types import TracebackType
from unittest.mock import Mock, patch

import pytest

from core.mcp.error import MCPConnectionError
from core.mcp.mcp_client import MCPClient
from core.mcp.types import CallToolResult, ListToolsResult, TextContent, Tool, ToolAnnotations


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
