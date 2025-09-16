import base64
import json
from collections.abc import Generator
from typing import Any, Optional

from core.mcp.auth.auth_flow import auth
from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPConnectionError
from core.mcp.types import CallToolResult, ImageContent, TextContent
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolEntity, ToolInvokeMessage, ToolProviderType
from core.tools.errors import ToolInvokeError


class MCPTool(Tool):
    def __init__(
        self,
        entity: ToolEntity,
        runtime: ToolRuntime,
        tenant_id: str,
        icon: str,
        server_url: str,
        provider_id: str,
        headers: Optional[dict[str, str]] = None,
        timeout: Optional[float] = None,
        sse_read_timeout: Optional[float] = None,
    ):
        super().__init__(entity, runtime)
        self.tenant_id = tenant_id
        self.icon = icon
        self.server_url = server_url
        self.provider_id = provider_id
        self.headers = headers or {}
        self.timeout = timeout
        self.sse_read_timeout = sse_read_timeout

    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.MCP

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        result = self.invoke_remote_mcp_tool(tool_parameters)
        # handle dify tool output
        for content in result.content:
            if isinstance(content, TextContent):
                yield from self._process_text_content(content)
            elif isinstance(content, ImageContent):
                yield self._process_image_content(content)
        # handle MCP structured output
        if self.entity.output_schema and result.structuredContent:
            for k, v in result.structuredContent.items():
                yield self.create_variable_message(k, v)

    def _process_text_content(self, content: TextContent) -> Generator[ToolInvokeMessage, None, None]:
        """Process text content and yield appropriate messages."""
        try:
            content_json = json.loads(content.text)
            yield from self._process_json_content(content_json)
        except json.JSONDecodeError:
            yield self.create_text_message(content.text)

    def _process_json_content(self, content_json: Any) -> Generator[ToolInvokeMessage, None, None]:
        """Process JSON content based on its type."""
        if isinstance(content_json, dict):
            yield self.create_json_message(content_json)
        elif isinstance(content_json, list):
            yield from self._process_json_list(content_json)
        else:
            # For primitive types (str, int, bool, etc.), convert to string
            yield self.create_text_message(str(content_json))

    def _process_json_list(self, json_list: list) -> Generator[ToolInvokeMessage, None, None]:
        """Process a list of JSON items."""
        if any(not isinstance(item, dict) for item in json_list):
            # If the list contains any non-dict item, treat the entire list as a text message.
            yield self.create_text_message(str(json_list))
            return

        # Otherwise, process each dictionary as a separate JSON message.
        for item in json_list:
            yield self.create_json_message(item)

    def _process_image_content(self, content: ImageContent) -> ToolInvokeMessage:
        """Process image content and return a blob message."""
        return self.create_blob_message(blob=base64.b64decode(content.data), meta={"mime_type": content.mimeType})

    def fork_tool_runtime(self, runtime: ToolRuntime) -> "MCPTool":
        return MCPTool(
            entity=self.entity,
            runtime=runtime,
            tenant_id=self.tenant_id,
            icon=self.icon,
            server_url=self.server_url,
            provider_id=self.provider_id,
            headers=self.headers,
            timeout=self.timeout,
            sse_read_timeout=self.sse_read_timeout,
        )

    def _handle_none_parameter(self, parameter: dict[str, Any]) -> dict[str, Any]:
        """
        in mcp tool invoke, if the parameter is empty, it will be set to None
        """
        return {
            key: value
            for key, value in parameter.items()
            if value is not None and not (isinstance(value, str) and value.strip() == "")
        }

    def invoke_remote_mcp_tool(self, tool_parameters: dict[str, Any]) -> CallToolResult:
        headers = self.headers.copy() if self.headers else {}
        tool_parameters = self._handle_none_parameter(tool_parameters)

        # Get provider entity to access tokens
        from typing import TYPE_CHECKING

        if TYPE_CHECKING:
            pass

        # Get MCP service from invoke parameters or create new one
        provider_entity = None
        mcp_service = None

        # Check if mcp_service is passed in tool_parameters
        if "_mcp_service" in tool_parameters:
            mcp_service = tool_parameters.pop("_mcp_service")
        else:
            # Fallback to creating service with database session
            from sqlalchemy.orm import Session

            from extensions.ext_database import db
            from services.tools.mcp_tools_manage_service import MCPToolManageService

            with Session(db.engine) as session:
                mcp_service = MCPToolManageService(session=session)

        if mcp_service:
            try:
                provider_entity = mcp_service.get_provider_entity(self.provider_id, self.tenant_id, by_server_id=True)

                # Try to get existing token and add to headers
                tokens = provider_entity.retrieve_tokens()
                if tokens and tokens.access_token:
                    headers["Authorization"] = f"{tokens.token_type.capitalize()} {tokens.access_token}"
            except Exception:
                # If provider retrieval or token fails, continue without auth
                pass

        # Use MCPClientWithAuthRetry to handle authentication automatically
        try:
            with MCPClientWithAuthRetry(
                server_url=provider_entity.decrypt_server_url() if provider_entity else self.server_url,
                headers=headers,
                timeout=self.timeout,
                sse_read_timeout=self.sse_read_timeout,
                provider_entity=provider_entity,
                auth_callback=auth if mcp_service else None,
                by_server_id=True,
                mcp_service=mcp_service,
            ) as mcp_client:
                return mcp_client.invoke_tool(tool_name=self.entity.identity.name, tool_args=tool_parameters)
        except MCPConnectionError as e:
            raise ToolInvokeError(f"Failed to connect to MCP server: {e}") from e
        except Exception as e:
            raise ToolInvokeError(f"Failed to invoke tool: {e}") from e
