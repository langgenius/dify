import json
from typing import Any

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
    provider_id: str
    entity: ToolProviderEntityWithPlugin

    def __init__(self, entity: ToolProviderEntityWithPlugin, provider_id: str, tenant_id: str, server_url: str) -> None:
        super().__init__(entity)
        self.entity = entity
        self.tenant_id = tenant_id
        self.provider_id = provider_id
        self.server_url = server_url

    @property
    def provider_type(self) -> ToolProviderType:
        """
        returns the type of the provider

        :return: type of the provider
        """
        return ToolProviderType.MCP

    @classmethod
    def _from_db(cls, db_provider: MCPToolProvider) -> "MCPToolProviderController":
        """
        from db provider
        """
        tools = []
        tools_data = json.loads(db_provider.tools)
        remote_mcp_tools = [RemoteMCPTool(**tool) for tool in tools_data]
        user = db_provider.load_user()
        tools = [
            ToolEntity(
                identity=ToolIdentity(
                    author=user.name if user else "Anonymous",
                    name=remote_mcp_tool.name,
                    label=I18nObject(en_US=remote_mcp_tool.name, zh_Hans=remote_mcp_tool.name),
                    provider=db_provider.server_identifier,
                    icon=db_provider.icon,
                ),
                parameters=ToolTransformService.convert_mcp_schema_to_parameter(remote_mcp_tool.inputSchema),
                description=ToolDescription(
                    human=I18nObject(
                        en_US=remote_mcp_tool.description or "", zh_Hans=remote_mcp_tool.description or ""
                    ),
                    llm=remote_mcp_tool.description or "",
                ),
                output_schema=None,
                has_runtime_parameters=len(remote_mcp_tool.inputSchema) > 0,
            )
            for remote_mcp_tool in remote_mcp_tools
        ]

        return cls(
            entity=ToolProviderEntityWithPlugin(
                identity=ToolProviderIdentity(
                    author=user.name if user else "Anonymous",
                    name=db_provider.name,
                    label=I18nObject(en_US=db_provider.name, zh_Hans=db_provider.name),
                    description=I18nObject(en_US="", zh_Hans=""),
                    icon=db_provider.icon,
                ),
                plugin_id=None,
                credentials_schema=[],
                tools=tools,
            ),
            provider_id=db_provider.server_identifier or "",
            tenant_id=db_provider.tenant_id or "",
            server_url=db_provider.decrypted_server_url,
        )

    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        """
        validate the credentials of the provider
        """
        pass

    def get_tool(self, tool_name: str) -> MCPTool:  # type: ignore
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
        )

    def get_tools(self) -> list[MCPTool]:  # type: ignore
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
            )
            for tool_entity in self.entity.tools
        ]
