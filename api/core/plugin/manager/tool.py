from core.plugin.manager.base import BasePluginManager
from core.tools.entities.tool_entities import ToolProviderEntity


class PluginToolManager(BasePluginManager):
    def fetch_tool_providers(self, tenant_id: str) -> list[ToolProviderEntity]:
        """
        Fetch tool providers for the given asset.
        """
        response = self._request_with_plugin_daemon_response(
            "GET", f"plugin/{tenant_id}/tools", list[ToolProviderEntity], params={"page": 1, "page_size": 256}
        )
        return response
