import logging
from threading import Lock

import contexts
from core.datasource.__base.datasource_plugin import DatasourcePlugin
from core.datasource.__base.datasource_provider import DatasourcePluginProviderController
from core.datasource.entities.datasource_entities import DatasourceProviderType
from core.datasource.errors import DatasourceProviderNotFoundError
from core.datasource.local_file.local_file_provider import LocalFileDatasourcePluginProviderController
from core.datasource.online_document.online_document_provider import OnlineDocumentDatasourcePluginProviderController
from core.datasource.online_drive.online_drive_provider import OnlineDriveDatasourcePluginProviderController
from core.datasource.website_crawl.website_crawl_provider import WebsiteCrawlDatasourcePluginProviderController
from core.plugin.impl.datasource import PluginDatasourceManager

logger = logging.getLogger(__name__)


class DatasourceManager:
    @classmethod
    def get_datasource_plugin_provider(
        cls, provider_id: str, tenant_id: str, datasource_type: DatasourceProviderType
    ) -> DatasourcePluginProviderController:
        """
        get the datasource plugin provider
        """
        # check if context is set
        try:
            contexts.datasource_plugin_providers.get()
        except LookupError:
            contexts.datasource_plugin_providers.set({})
            contexts.datasource_plugin_providers_lock.set(Lock())

        with contexts.datasource_plugin_providers_lock.get():
            datasource_plugin_providers = contexts.datasource_plugin_providers.get()
            if provider_id in datasource_plugin_providers:
                return datasource_plugin_providers[provider_id]

            manager = PluginDatasourceManager()
            provider_entity = manager.fetch_datasource_provider(tenant_id, provider_id)
            if not provider_entity:
                raise DatasourceProviderNotFoundError(f"plugin provider {provider_id} not found")
            controller: DatasourcePluginProviderController | None = None
            match datasource_type:
                case DatasourceProviderType.ONLINE_DOCUMENT:
                    controller = OnlineDocumentDatasourcePluginProviderController(
                        entity=provider_entity.declaration,
                        plugin_id=provider_entity.plugin_id,
                        plugin_unique_identifier=provider_entity.plugin_unique_identifier,
                        tenant_id=tenant_id,
                    )
                case DatasourceProviderType.ONLINE_DRIVE:
                    controller = OnlineDriveDatasourcePluginProviderController(
                        entity=provider_entity.declaration,
                        plugin_id=provider_entity.plugin_id,
                        plugin_unique_identifier=provider_entity.plugin_unique_identifier,
                        tenant_id=tenant_id,
                    )
                case DatasourceProviderType.WEBSITE_CRAWL:
                    controller = WebsiteCrawlDatasourcePluginProviderController(
                        entity=provider_entity.declaration,
                        plugin_id=provider_entity.plugin_id,
                        plugin_unique_identifier=provider_entity.plugin_unique_identifier,
                        tenant_id=tenant_id,
                    )
                case DatasourceProviderType.LOCAL_FILE:
                    controller = LocalFileDatasourcePluginProviderController(
                        entity=provider_entity.declaration,
                        plugin_id=provider_entity.plugin_id,
                        plugin_unique_identifier=provider_entity.plugin_unique_identifier,
                        tenant_id=tenant_id,
                    )
                case _:
                    raise ValueError(f"Unsupported datasource type: {datasource_type}")

            if controller:
                datasource_plugin_providers[provider_id] = controller

        if controller is None:
            raise DatasourceProviderNotFoundError(f"Datasource provider {provider_id} not found.")

        return controller

    @classmethod
    def get_datasource_runtime(
        cls,
        provider_id: str,
        datasource_name: str,
        tenant_id: str,
        datasource_type: DatasourceProviderType,
    ) -> DatasourcePlugin:
        """
        get the datasource runtime

        :param provider_type: the type of the provider
        :param provider_id: the id of the provider
        :param datasource_name: the name of the datasource
        :param tenant_id: the tenant id

        :return: the datasource plugin
        """
        return cls.get_datasource_plugin_provider(
            provider_id,
            tenant_id,
            datasource_type,
        ).get_datasource(datasource_name)
