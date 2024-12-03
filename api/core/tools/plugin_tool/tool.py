from collections.abc import Generator
from typing import Any, Optional

from core.plugin.manager.tool import PluginToolManager
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.file_entities import PluginFileEntity
from core.tools.entities.tool_entities import ToolEntity, ToolInvokeMessage, ToolParameter, ToolProviderType
from models.model import File


class PluginTool(Tool):
    tenant_id: str
    icon: str
    plugin_unique_identifier: str
    runtime_parameters: Optional[list[ToolParameter]]

    def __init__(
        self, entity: ToolEntity, runtime: ToolRuntime, tenant_id: str, icon: str, plugin_unique_identifier: str
    ) -> None:
        super().__init__(entity, runtime)
        self.tenant_id = tenant_id
        self.icon = icon
        self.plugin_unique_identifier = plugin_unique_identifier
        self.runtime_parameters = None

    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.PLUGIN

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        manager = PluginToolManager()

        # convert tool parameters with File type to PluginFileEntity
        for parameter_name, parameter in tool_parameters.items():
            if isinstance(parameter, File):
                url = parameter.generate_url()
                if url is None:
                    raise ValueError(f"File {parameter.id} does not have a valid URL")
                tool_parameters[parameter_name] = PluginFileEntity(
                    url=url, mime_type=parameter.mime_type, type=parameter.type
                ).model_dump()
            elif isinstance(parameter, list) and all(isinstance(p, File) for p in parameter):
                tool_parameters[parameter_name] = []
                for p in parameter:
                    assert isinstance(p, File)
                    url = p.generate_url()
                    if url is None:
                        raise ValueError(f"File {p.id} does not have a valid URL")
                    tool_parameters[parameter_name].append(
                        PluginFileEntity(url=url, mime_type=p.mime_type, type=p.type).model_dump()
                    )

        return manager.invoke(
            tenant_id=self.tenant_id,
            user_id=user_id,
            tool_provider=self.entity.identity.provider,
            tool_name=self.entity.identity.name,
            credentials=self.runtime.credentials,
            tool_parameters=tool_parameters,
            conversation_id=conversation_id,
            app_id=app_id,
            message_id=message_id,
        )

    def fork_tool_runtime(self, runtime: ToolRuntime) -> "PluginTool":
        return PluginTool(
            entity=self.entity,
            runtime=runtime,
            tenant_id=self.tenant_id,
            icon=self.icon,
            plugin_unique_identifier=self.plugin_unique_identifier,
        )

    def get_runtime_parameters(self) -> list[ToolParameter]:
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
        )

        return self.runtime_parameters
