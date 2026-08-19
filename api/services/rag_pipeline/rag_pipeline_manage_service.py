import logging

from core.plugin.entities.plugin_daemon import PluginDatasourceProviderEntity
from core.plugin.impl.datasource import PluginDatasourceManager
from services.datasource_provider_service import DatasourceProviderService

logger = logging.getLogger(__name__)


class RagPipelineManageService:
    @staticmethod
    def list_rag_pipeline_datasources(tenant_id: str) -> list[PluginDatasourceProviderEntity]:
        """
        list rag pipeline datasources
        """

        # get all builtin providers
        manager = PluginDatasourceManager()
        datasources = manager.fetch_datasource_providers(tenant_id)
        for datasource in datasources:
            datasource_provider_service = DatasourceProviderService()
            try:
                credentials = datasource_provider_service.get_datasource_credentials(
                    tenant_id=tenant_id, provider=datasource.provider, plugin_id=datasource.plugin_id
                )
                if credentials:
                    datasource.is_authorized = True
            except Exception:
                logger.exception(
                    "Skipping datasource credentials for provider %s after refresh or decrypt failure",
                    datasource.provider,
                    extra={
                        "tenant_id": tenant_id,
                        "plugin_id": datasource.plugin_id,
                        "provider": datasource.provider,
                    },
                )

        return datasources
