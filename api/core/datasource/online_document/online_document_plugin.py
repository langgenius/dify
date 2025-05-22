from core.datasource.__base.datasource_plugin import DatasourcePlugin
from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceProviderType,
    GetOnlineDocumentPageContentRequest,
    GetOnlineDocumentPageContentResponse,
    GetOnlineDocumentPagesRequest,
    GetOnlineDocumentPagesResponse,
)
from core.plugin.impl.datasource import PluginDatasourceManager


class OnlineDocumentDatasourcePlugin(DatasourcePlugin):
    tenant_id: str
    icon: str
    plugin_unique_identifier: str
    entity: DatasourceEntity
    runtime: DatasourceRuntime

    def __init__(
        self,
        entity: DatasourceEntity,
        runtime: DatasourceRuntime,
        tenant_id: str,
        icon: str,
        plugin_unique_identifier: str,
    ) -> None:
        super().__init__(entity, runtime)
        self.tenant_id = tenant_id
        self.icon = icon
        self.plugin_unique_identifier = plugin_unique_identifier

    def _get_online_document_pages(
        self,
        user_id: str,
        datasource_parameters: GetOnlineDocumentPagesRequest,
        provider_type: str,
    ) -> GetOnlineDocumentPagesResponse:
        manager = PluginDatasourceManager()

        return manager.get_online_document_pages(
            tenant_id=self.tenant_id,
            user_id=user_id,
            datasource_provider=self.entity.identity.provider,
            datasource_name=self.entity.identity.name,
            credentials=self.runtime.credentials,
            datasource_parameters=datasource_parameters,
            provider_type=provider_type,
        )

    def _get_online_document_page_content(
        self,
        user_id: str,
        datasource_parameters: GetOnlineDocumentPageContentRequest,
        provider_type: str,
    ) -> GetOnlineDocumentPageContentResponse:
        manager = PluginDatasourceManager()

        return manager.get_online_document_page_content(
            tenant_id=self.tenant_id,
            user_id=user_id,
            datasource_provider=self.entity.identity.provider,
            datasource_name=self.entity.identity.name,
            credentials=self.runtime.credentials,
            datasource_parameters=datasource_parameters,
            provider_type=provider_type,
        )

    def datasource_provider_type(self) -> DatasourceProviderType:
        return DatasourceProviderType.ONLINE_DOCUMENT

    def fork_datasource_runtime(self, runtime: DatasourceRuntime) -> "DatasourcePlugin":
        return DatasourcePlugin(
            entity=self.entity,
            runtime=runtime,
            tenant_id=self.tenant_id,
            icon=self.icon,
            plugin_unique_identifier=self.plugin_unique_identifier,
        )
