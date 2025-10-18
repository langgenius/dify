"""
MCP Client with Authentication Retry Support

This module provides an enhanced MCPClient that automatically handles
authentication failures and retries operations after refreshing tokens.
"""

import logging
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, Optional

from core.entities.mcp_provider import MCPProviderEntity
from core.mcp.error import MCPAuthError
from core.mcp.mcp_client import MCPClient
from core.mcp.types import CallToolResult, Tool

if TYPE_CHECKING:
    from services.tools.mcp_tools_manage_service import MCPToolManageService

logger = logging.getLogger(__name__)


class MCPClientWithAuthRetry(MCPClient):
    """
    An enhanced MCPClient that provides automatic authentication retry.

    This class extends MCPClient and intercepts MCPAuthError exceptions
    to refresh authentication before retrying failed operations.
    """

    def __init__(
        self,
        server_url: str,
        headers: dict[str, str] | None = None,
        timeout: float | None = None,
        sse_read_timeout: float | None = None,
        provider_entity: MCPProviderEntity | None = None,
        auth_callback: Callable[[MCPProviderEntity, "MCPToolManageService", Optional[str]], dict[str, str]]
        | None = None,
        authorization_code: str | None = None,
        by_server_id: bool = False,
        mcp_service: Optional["MCPToolManageService"] = None,
    ):
        """
        Initialize the MCP client with auth retry capability.

        Args:
            server_url: The MCP server URL
            headers: Optional headers for requests
            timeout: Request timeout
            sse_read_timeout: SSE read timeout
            provider_entity: Provider entity for authentication
            auth_callback: Authentication callback function
            authorization_code: Optional authorization code for initial auth
            by_server_id: Whether to look up provider by server ID
            mcp_service: MCP service instance
        """
        super().__init__(server_url, headers, timeout, sse_read_timeout)

        self.provider_entity = provider_entity
        self.auth_callback = auth_callback
        self.authorization_code = authorization_code
        self.by_server_id = by_server_id
        self.mcp_service = mcp_service
        self._has_retried = False

    def _handle_auth_error(self, error: MCPAuthError) -> None:
        """
        Handle authentication error by refreshing tokens.

        Args:
            error: The authentication error

        Raises:
            MCPAuthError: If authentication fails or max retries reached
        """
        if not self.provider_entity or not self.auth_callback or not self.mcp_service:
            raise error
        if self._has_retried:
            raise error

        self._has_retried = True

        try:
            # Perform authentication
            self.auth_callback(self.provider_entity, self.mcp_service, self.authorization_code)

            # Retrieve new tokens
            self.provider_entity = self.mcp_service.get_provider_entity(
                self.provider_entity.id, self.provider_entity.tenant_id, by_server_id=self.by_server_id
            )
            token = self.provider_entity.retrieve_tokens()
            if not token:
                raise MCPAuthError("Authentication failed - no token received")

            # Update headers with new token
            self.headers["Authorization"] = f"{token.token_type.capitalize()} {token.access_token}"

            # Clear authorization code after first use
            self.authorization_code = None

        except MCPAuthError:
            # Re-raise MCPAuthError as is
            raise
        except Exception as e:
            # Catch all exceptions during auth retry
            logger.exception("Authentication retry failed")
            raise MCPAuthError(f"Authentication retry failed: {e}") from e

    def _execute_with_retry(self, func: Callable[..., Any], *args, **kwargs) -> Any:
        """
        Execute a function with authentication retry logic.

        Args:
            func: The function to execute
            *args: Positional arguments for the function
            **kwargs: Keyword arguments for the function

        Returns:
            The result of the function call

        Raises:
            MCPAuthError: If authentication fails after retries
            Any other exceptions from the function
        """
        try:
            return func(*args, **kwargs)
        except MCPAuthError as e:
            self._handle_auth_error(e)

            # Re-initialize the connection with new headers
            if self._initialized:
                # Clean up existing connection
                self._exit_stack.close()
                self._session = None
                self._initialized = False

                # Re-initialize with new headers
                self._initialize()
                self._initialized = True

            return func(*args, **kwargs)
        finally:
            # Reset retry flag after operation completes
            self._has_retried = False

    def __enter__(self):
        """Enter the context manager with retry support."""

        def initialize_with_retry():
            super(MCPClientWithAuthRetry, self).__enter__()
            return self

        return self._execute_with_retry(initialize_with_retry)

    def list_tools(self) -> list[Tool]:
        """
        List available tools from the MCP server with auth retry.

        Returns:
            List of available tools

        Raises:
            MCPAuthError: If authentication fails after retries
        """
        return self._execute_with_retry(super().list_tools)

    def invoke_tool(self, tool_name: str, tool_args: dict[str, Any]) -> CallToolResult:
        """
        Invoke a tool on the MCP server with auth retry.

        Args:
            tool_name: Name of the tool to invoke
            tool_args: Arguments for the tool

        Returns:
            Result of the tool invocation

        Raises:
            MCPAuthError: If authentication fails after retries
        """
        return self._execute_with_retry(super().invoke_tool, tool_name, tool_args)
