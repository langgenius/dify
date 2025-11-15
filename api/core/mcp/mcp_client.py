import logging
from collections.abc import Callable
from contextlib import AbstractContextManager, ExitStack
from types import TracebackType
from typing import Any
from urllib.parse import urlparse

from core.mcp.client.sse_client import sse_client
from core.mcp.client.streamable_client import streamablehttp_client
from core.mcp.error import MCPConnectionError
from core.mcp.session.client_session import ClientSession
from core.mcp.types import CallToolResult, Tool

logger = logging.getLogger(__name__)


class MCPClient:
    def __init__(
        self,
        server_url: str,
        headers: dict[str, str] | None = None,
        timeout: float | None = None,
        sse_read_timeout: float | None = None,
    ):
        self.server_url = server_url
        self.headers = headers or {}
        self.timeout = timeout
        self.sse_read_timeout = sse_read_timeout

        # Initialize session and client objects
        self._session: ClientSession | None = None
        self._exit_stack = ExitStack()
        self._initialized = False

    def __enter__(self):
        self._initialize()
        self._initialized = True
        return self

    def __exit__(self, exc_type: type | None, exc_value: BaseException | None, traceback: TracebackType | None):
        self.cleanup()

    def _initialize(
        self,
    ):
        """Initialize the client with fallback to SSE if streamable connection fails"""
        connection_methods: dict[str, Callable[..., AbstractContextManager[Any]]] = {
            "mcp": streamablehttp_client,
            "sse": sse_client,
        }

        parsed_url = urlparse(self.server_url)
        path = parsed_url.path or ""
        method_name = path.rstrip("/").split("/")[-1] if path else ""
        if method_name in connection_methods:
            client_factory = connection_methods[method_name]
            self.connect_server(client_factory, method_name)
        else:
            try:
                logger.debug("Not supported method %s found in URL path, trying default 'mcp' method.", method_name)
                self.connect_server(sse_client, "sse")
            except MCPConnectionError:
                logger.debug("MCP connection failed with 'sse', falling back to 'mcp' method.")
                self.connect_server(streamablehttp_client, "mcp")

    def connect_server(self, client_factory: Callable[..., AbstractContextManager[Any]], method_name: str) -> None:
        """
        Connect to the MCP server using streamable http or sse.
        Default to streamable http.
        Args:
            client_factory: The client factory to use(streamablehttp_client or sse_client).
            method_name: The method name to use(mcp or sse).
        """
        streams_context = client_factory(
            url=self.server_url,
            headers=self.headers,
            timeout=self.timeout,
            sse_read_timeout=self.sse_read_timeout,
        )

        # Use exit_stack to manage context managers properly
        if method_name == "mcp":
            read_stream, write_stream, _ = self._exit_stack.enter_context(streams_context)
            streams = (read_stream, write_stream)
        else:  # sse_client
            streams = self._exit_stack.enter_context(streams_context)

        session_context = ClientSession(*streams)
        self._session = self._exit_stack.enter_context(session_context)
        self._session.initialize()

    def list_tools(self) -> list[Tool]:
        """List available tools from the MCP server"""
        if not self._session:
            raise ValueError("Session not initialized.")
        response = self._session.list_tools()
        return response.tools

    def invoke_tool(self, tool_name: str, tool_args: dict[str, Any]) -> CallToolResult:
        """Call a tool"""
        if not self._session:
            raise ValueError("Session not initialized.")
        return self._session.call_tool(tool_name, tool_args)

    def cleanup(self):
        """Clean up resources"""
        try:
            # ExitStack will handle proper cleanup of all managed context managers
            self._exit_stack.close()
        except Exception as e:
            logger.exception("Error during cleanup")
            raise ValueError(f"Error during cleanup: {e}")
        finally:
            self._session = None
            self._initialized = False
