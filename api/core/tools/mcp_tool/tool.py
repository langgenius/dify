import base64
import json
from collections.abc import Generator
from typing import Any, Optional

from core.mcp.error import MCPAuthError, MCPConnectionError
from core.mcp.mcp_client import MCPClient
from core.mcp.types import ImageContent, TextContent
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolEntity, ToolInvokeMessage, ToolParameter, ToolProviderType


class MCPTool(Tool):
    tenant_id: str
    icon: str
    runtime_parameters: Optional[list[ToolParameter]]
    server_url: str
    provider_id: str

    def __init__(
        self, entity: ToolEntity, runtime: ToolRuntime, tenant_id: str, icon: str, server_url: str, provider_id: str
    ) -> None:
        super().__init__(entity, runtime)
        self.tenant_id = tenant_id
        self.icon = icon
        self.runtime_parameters = None
        self.server_url = server_url
        self.provider_id = provider_id

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
        from core.tools.errors import ToolInvokeError

        try:
            with MCPClient(self.server_url, self.provider_id, self.tenant_id, authed=True) as mcp_client:
                tool_parameters = self._handle_none_parameter(tool_parameters)
                result = mcp_client.invoke_tool(tool_name=self.entity.identity.name, tool_args=tool_parameters)
        except MCPAuthError as e:
            raise ToolInvokeError("Please auth the tool first") from e
        except MCPConnectionError as e:
            raise ToolInvokeError(f"Failed to connect to MCP server: {e}") from e
        except Exception as e:
            raise ToolInvokeError(f"Failed to invoke tool: {e}") from e

        for content in result.content:
            if isinstance(content, TextContent):
                try:
                    content_json = json.loads(content.text)
                    if isinstance(content_json, dict):
                        yield self.create_json_message(content_json)
                    elif isinstance(content_json, list):
                        for item in content_json:
                            yield self.create_json_message(item)
                    else:
                        yield self.create_text_message(content.text)
                except json.JSONDecodeError:
                    yield self.create_text_message(content.text)

            elif isinstance(content, ImageContent):
                yield self.create_blob_message(
                    blob=base64.b64decode(content.data), meta={"mime_type": content.mimeType}
                )

    def fork_tool_runtime(self, runtime: ToolRuntime) -> "MCPTool":
        return MCPTool(
            entity=self.entity,
            runtime=runtime,
            tenant_id=self.tenant_id,
            icon=self.icon,
            server_url=self.server_url,
            provider_id=self.provider_id,
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
