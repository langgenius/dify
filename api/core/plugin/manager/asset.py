from core.plugin.manager.base import BasePluginManager


class PluginAssetManager(BasePluginManager):
    def fetch_asset(self, tenant_id: str, id: str) -> bytes:
        """
        Fetch an asset by id.
        """
        response = self._request(method="GET", path=f"plugin/{tenant_id}/assets/{id}")
        if response.status_code != 200:
            raise ValueError(f"can not found asset {id}")
        return response.content
