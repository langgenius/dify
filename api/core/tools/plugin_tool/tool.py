from collections.abc import Generator
from typing import Any

from core.plugin.manager.tool import PluginToolManager
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolEntity, ToolInvokeMessage, ToolProviderType


class PluginTool(Tool):
    tenant_id: str
    plugin_unique_identifier: str

    def __init__(self, entity: ToolEntity, runtime: ToolRuntime, tenant_id: str, plugin_unique_identifier: str) -> None:
        super().__init__(entity, runtime)
        self.tenant_id = tenant_id
        self.plugin_unique_identifier = plugin_unique_identifier

    @property
    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.PLUGIN

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        manager = PluginToolManager()
        return manager.invoke(
            tenant_id=self.tenant_id,
            user_id=user_id,
            plugin_unique_identifier=self.plugin_unique_identifier,
            tool_provider=self.entity.identity.provider,
            tool_name=self.entity.identity.name,
            credentials=self.runtime.credentials,
            tool_parameters=tool_parameters,
        )

    def fork_tool_runtime(self, runtime: ToolRuntime) -> "PluginTool":
        return PluginTool(
            entity=self.entity,
            runtime=runtime,
            tenant_id=self.tenant_id,
            plugin_unique_identifier=self.plugin_unique_identifier,
        )