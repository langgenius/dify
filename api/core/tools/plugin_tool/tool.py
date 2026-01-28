from __future__ import annotations

from collections.abc import Generator
from typing import Any

from core.plugin.impl.tool import PluginToolManager
from core.plugin.utils.converter import convert_parameters_to_plugin_format
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolEntity, ToolInvokeMessage, ToolParameter, ToolProviderType


class PluginTool(Tool):
    def __init__(
        self, entity: ToolEntity, runtime: ToolRuntime, tenant_id: str, icon: str, plugin_unique_identifier: str
    ):
        super().__init__(entity, runtime)
        self.tenant_id = tenant_id
        self.icon = icon
        self.plugin_unique_identifier = plugin_unique_identifier
        self.runtime_parameters: list[ToolParameter] | None = None

    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.PLUGIN

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        manager = PluginToolManager()

        tool_parameters = convert_parameters_to_plugin_format(tool_parameters)

        yield from manager.invoke(
            tenant_id=self.tenant_id,
            user_id=user_id,
            tool_provider=self.entity.identity.provider,
            tool_name=self.entity.identity.name,
            credentials=self.runtime.credentials,
            credential_type=self.runtime.credential_type,
            tool_parameters=tool_parameters,
            conversation_id=conversation_id,
            app_id=app_id,
            message_id=message_id,
        )

    def fork_tool_runtime(self, runtime: ToolRuntime) -> PluginTool:
        return PluginTool(
            entity=self.entity,
            runtime=runtime,
            tenant_id=self.tenant_id,
            icon=self.icon,
            plugin_unique_identifier=self.plugin_unique_identifier,
        )

    def get_runtime_parameters(
        self,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> list[ToolParameter]:
        """
        get the runtime parameters
        """
        if not self.entity.has_runtime_parameters:
            return self.entity.parameters

        if self.runtime_parameters is not None:
            return self.runtime_parameters

        manager = PluginToolManager()
        self.runtime_parameters = manager.get_runtime_parameters(
            tenant_id=self.tenant_id,
            user_id="",
            provider=self.entity.identity.provider,
            tool=self.entity.identity.name,
            credentials=self.runtime.credentials,
            conversation_id=conversation_id,
            app_id=app_id,
            message_id=message_id,
        )

        return self.runtime_parameters
