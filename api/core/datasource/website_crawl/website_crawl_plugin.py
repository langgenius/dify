from collections.abc import Generator, Mapping
from typing import Any

from core.datasource.__base.datasource_plugin import DatasourcePlugin
from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceProviderType,
    WebsiteCrawlMessage,
)
from core.plugin.impl.datasource import PluginDatasourceManager


class WebsiteCrawlDatasourcePlugin(DatasourcePlugin):
    tenant_id: str
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
        super().__init__(entity, runtime, icon)
        self.tenant_id = tenant_id
        self.plugin_unique_identifier = plugin_unique_identifier

    def get_website_crawl(
        self,
        user_id: str,
        datasource_parameters: Mapping[str, Any],
        provider_type: str,
    ) -> Generator[WebsiteCrawlMessage, None, None]:
        manager = PluginDatasourceManager()

        return manager.get_website_crawl(
            tenant_id=self.tenant_id,
            user_id=user_id,
            datasource_provider=self.entity.identity.provider,
            datasource_name=self.entity.identity.name,
            credentials=self.runtime.credentials,
            datasource_parameters=datasource_parameters,
            provider_type=provider_type,
        )

    def datasource_provider_type(self) -> str:
        return DatasourceProviderType.WEBSITE_CRAWL
