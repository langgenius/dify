from core.plugin.impl.base import BasePluginClient


class PluginAssetManager(BasePluginClient):
    def fetch_asset(self, tenant_id: str, id: str) -> bytes:
        """
        Fetch an asset by id.
        """
        response = self._request(method="GET", path=f"plugin/{tenant_id}/asset/{id}")
        if response.status_code != 200:
            raise ValueError(f"can not found asset {id}")
        return response.content

    def extract_asset(self, tenant_id: str, plugin_unique_identifier: str, filename: str) -> bytes:
        response = self._request(
            method="GET",
            path=f"plugin/{tenant_id}/extract-asset/",
            params={"plugin_unique_identifier": plugin_unique_identifier, "file_path": filename},
        )
        if response.status_code != 200:
            raise ValueError(f"can not found asset {plugin_unique_identifier}, {str(response.status_code)}")
        return response.content
