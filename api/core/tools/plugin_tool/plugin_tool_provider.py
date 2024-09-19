

from core.entities.provider_entities import ProviderConfig
from core.tools.__base.tool import Tool
from core.tools.__base.tool_provider import ToolProviderController
from core.tools.entities.tool_entities import ToolProviderType


class PluginToolProvider(ToolProviderController):
    @property
    def provider_type(self) -> ToolProviderType:
        """
        returns the type of the provider

        :return: type of the provider
        """
        return ToolProviderType.PLUGIN
    
    def get_tool(self, tool_name: str) -> Tool:
        """
        return tool with given name
        """
        return super().get_tool(tool_name)
    
    def get_credentials_schema(self) -> dict[str, ProviderConfig]:
        """
        get credentials schema
        """
        return super().get_credentials_schema()
    