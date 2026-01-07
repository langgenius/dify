from __future__ import annotations

import base64
import json
import logging
from collections.abc import Generator
from typing import Any

from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPConnectionError
from core.mcp.types import (
    AudioContent,
    BlobResourceContents,
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    TextContent,
    TextResourceContents,
)
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolEntity, ToolInvokeMessage, ToolProviderType
from core.tools.errors import ToolInvokeError

logger = logging.getLogger(__name__)


class MCPTool(Tool):
    def __init__(
        self,
        entity: ToolEntity,
        runtime: ToolRuntime,
        tenant_id: str,
        icon: str,
        server_url: str,
        provider_id: str,
        headers: dict[str, str] | None = None,
        timeout: float | None = None,
        sse_read_timeout: float | None = None,
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
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        result = self.invoke_remote_mcp_tool(tool_parameters)
        # handle dify tool output
        for content in result.content:
            if isinstance(content, TextContent):
                yield from self._process_text_content(content)
            elif isinstance(content, ImageContent | AudioContent):
                yield self.create_blob_message(
                    blob=base64.b64decode(content.data), meta={"mime_type": content.mimeType}
                )
            elif isinstance(content, EmbeddedResource):
                resource = content.resource
                if isinstance(resource, TextResourceContents):
                    yield self.create_text_message(resource.text)
                elif isinstance(resource, BlobResourceContents):
                    mime_type = resource.mimeType or "application/octet-stream"
                    yield self.create_blob_message(blob=base64.b64decode(resource.blob), meta={"mime_type": mime_type})
                else:
                    raise ToolInvokeError(f"Unsupported embedded resource type: {type(resource)}")
            else:
                logger.warning("Unsupported content type=%s", type(content))

        # handle MCP structured output
        if self.entity.output_schema and result.structuredContent:
            for k, v in result.structuredContent.items():
                yield self.create_variable_message(k, v)

    def _process_text_content(self, content: TextContent) -> Generator[ToolInvokeMessage, None, None]:
        """Process text content and yield appropriate messages."""
        # Check if content looks like JSON before attempting to parse
        text = content.text.strip()
        if text and text[0] in ("{", "[") and text[-1] in ("}", "]"):
            try:
                content_json = json.loads(text)
                yield from self._process_json_content(content_json)
                return
            except json.JSONDecodeError:
                pass

        # If not JSON or parsing failed, treat as plain text
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

    def fork_tool_runtime(self, runtime: ToolRuntime) -> MCPTool:
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

        from sqlalchemy.orm import Session

        from extensions.ext_database import db
        from services.tools.mcp_tools_manage_service import MCPToolManageService

        # Step 1: Load provider entity and credentials in a short-lived session
        # This minimizes database connection hold time
        with Session(db.engine, expire_on_commit=False) as session:
            mcp_service = MCPToolManageService(session=session)
            provider_entity = mcp_service.get_provider_entity(self.provider_id, self.tenant_id, by_server_id=True)

            # Decrypt and prepare all credentials before closing session
            server_url = provider_entity.decrypt_server_url()
            headers = provider_entity.decrypt_headers()

            # Try to get existing token and add to headers
            if not headers:
                tokens = provider_entity.retrieve_tokens()
                if tokens and tokens.access_token:
                    headers["Authorization"] = f"{tokens.token_type.capitalize()} {tokens.access_token}"

        # Step 2: Session is now closed, perform network operations without holding database connection
        # MCPClientWithAuthRetry will create a new session lazily only if auth retry is needed
        try:
            with MCPClientWithAuthRetry(
                server_url=server_url,
                headers=headers,
                timeout=self.timeout,
                sse_read_timeout=self.sse_read_timeout,
                provider_entity=provider_entity,
            ) as mcp_client:
                return mcp_client.invoke_tool(tool_name=self.entity.identity.name, tool_args=tool_parameters)
        except MCPConnectionError as e:
            raise ToolInvokeError(f"Failed to connect to MCP server: {e}") from e
        except Exception as e:
            raise ToolInvokeError(f"Failed to invoke tool: {e}") from e
