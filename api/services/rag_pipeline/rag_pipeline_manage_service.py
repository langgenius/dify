from core.plugin.entities.plugin_daemon import PluginDatasourceProviderEntity
from core.plugin.impl.datasource import PluginDatasourceManager


class RagPipelineManageService:
    @staticmethod
    def list_rag_pipeline_datasources(tenant_id: str) -> list[PluginDatasourceProviderEntity]:
        """
        list rag pipeline datasources
        """

        # get all builtin providers
        manager = PluginDatasourceManager()
        return manager.fetch_datasource_providers(tenant_id)
