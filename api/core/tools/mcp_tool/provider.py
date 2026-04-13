from typing import Any, Self

from core.entities.mcp_provider import MCPProviderEntity
from core.mcp.types import Tool as RemoteMCPTool
from core.tools.__base.tool_provider import ToolProviderController
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolProviderEntityWithPlugin,
    ToolProviderIdentity,
    ToolProviderType,
)
from core.tools.mcp_tool.tool import MCPTool
from models.tools import MCPToolProvider
from services.tools.tools_transform_service import ToolTransformService


class MCPToolProviderController(ToolProviderController):
    def __init__(
        self,
        entity: ToolProviderEntityWithPlugin,
        provider_id: str,
        tenant_id: str,
        server_url: str,
        headers: dict[str, str] | None = None,
        timeout: float | None = None,
        sse_read_timeout: float | None = None,
    ):
        super().__init__(entity)
        self.entity: ToolProviderEntityWithPlugin = entity
        self.tenant_id = tenant_id
        self.provider_id = provider_id
        self.server_url = server_url
        self.headers = headers or {}
        self.timeout = timeout
        self.sse_read_timeout = sse_read_timeout

    @property
    def provider_type(self) -> ToolProviderType:
        """
        returns the type of the provider

        :return: type of the provider
        """
        return ToolProviderType.MCP

    @classmethod
    def from_db(cls, db_provider: MCPToolProvider) -> Self:
        """
        from db provider
        """
        # Convert to entity first
        provider_entity = db_provider.to_entity()
        return cls.from_entity(provider_entity)

    @classmethod
    def from_entity(cls, entity: MCPProviderEntity) -> Self:
        """
        create a MCPToolProviderController from a MCPProviderEntity
        """
        remote_mcp_tools = [RemoteMCPTool(**tool) for tool in entity.tools]

        tools = [
            ToolEntity(
                identity=ToolIdentity(
                    author="Anonymous",  # Tool level author is not stored
                    name=remote_mcp_tool.name,
                    label=I18nObject(en_US=remote_mcp_tool.name, zh_Hans=remote_mcp_tool.name),
                    provider=entity.provider_id,
                    icon=entity.icon if isinstance(entity.icon, str) else "",
                ),
                parameters=ToolTransformService.convert_mcp_schema_to_parameter(remote_mcp_tool.inputSchema),
                description=ToolDescription(
                    human=I18nObject(
                        en_US=remote_mcp_tool.description or "", zh_Hans=remote_mcp_tool.description or ""
                    ),
                    llm=remote_mcp_tool.description or "",
                ),
                output_schema=remote_mcp_tool.outputSchema or {},
                has_runtime_parameters=len(remote_mcp_tool.inputSchema) > 0,
            )
            for remote_mcp_tool in remote_mcp_tools
        ]
        if not entity.icon:
            raise ValueError("Database provider icon is required")
        return cls(
            entity=ToolProviderEntityWithPlugin(
                identity=ToolProviderIdentity(
                    author="Anonymous",  # Provider level author is not stored in entity
                    name=entity.name,
                    label=I18nObject(en_US=entity.name, zh_Hans=entity.name),
                    description=I18nObject(en_US="", zh_Hans=""),
                    icon=entity.icon if isinstance(entity.icon, str) else "",
                ),
                plugin_id=None,
                credentials_schema=[],
                tools=tools,
            ),
            provider_id=entity.provider_id,
            tenant_id=entity.tenant_id,
            server_url=entity.server_url,
            headers=entity.headers,
            timeout=entity.timeout,
            sse_read_timeout=entity.sse_read_timeout,
        )

    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]):
        """
        validate the credentials of the provider
        """
        pass

    def get_tool(self, tool_name: str) -> MCPTool:
        """
        return tool with given name
        """
        tool_entity = next(
            (tool_entity for tool_entity in self.entity.tools if tool_entity.identity.name == tool_name), None
        )

        if not tool_entity:
            raise ValueError(f"Tool with name {tool_name} not found")

        return MCPTool(
            entity=tool_entity,
            runtime=ToolRuntime(tenant_id=self.tenant_id),
            tenant_id=self.tenant_id,
            icon=self.entity.identity.icon,
            server_url=self.server_url,
            provider_id=self.provider_id,
            headers=self.headers,
            timeout=self.timeout,
            sse_read_timeout=self.sse_read_timeout,
        )

    def get_tools(self) -> list[MCPTool]:
        """
        get all tools
        """
        return [
            MCPTool(
                entity=tool_entity,
                runtime=ToolRuntime(tenant_id=self.tenant_id),
                tenant_id=self.tenant_id,
                icon=self.entity.identity.icon,
                server_url=self.server_url,
                provider_id=self.provider_id,
                headers=self.headers,
                timeout=self.timeout,
                sse_read_timeout=self.sse_read_timeout,
            )
            for tool_entity in self.entity.tools
        ]
