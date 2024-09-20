from core.plugin.manager.base import BasePluginManager


class PluginToolManager(BasePluginManager):
    def fetch_tool_providers(self, asset_id: str) -> list[str]:
        """
        Fetch tool providers for the given asset.
        """
        response = self._request('GET', f'/plugin/asset/{asset_id}')