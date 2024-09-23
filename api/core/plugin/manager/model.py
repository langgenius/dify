from core.model_runtime.entities.provider_entities import ProviderEntity
from core.plugin.manager.base import BasePluginManager


class PluginModelManager(BasePluginManager):
    def fetch_model_providers(self, tenant_id: str) -> list[ProviderEntity]:
        """
        Fetch model providers for the given tenant.
        """
        response = self._request_with_plugin_daemon_response(
            "GET", f"plugin/{tenant_id}/models", list[ProviderEntity], params={"page": 1, "page_size": 256}
        )
        return response
