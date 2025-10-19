from core.datasource.__base.datasource_plugin import DatasourcePlugin
from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceProviderType,
)


class LocalFileDatasourcePlugin(DatasourcePlugin):
    tenant_id: str
    plugin_unique_identifier: str

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

    def datasource_provider_type(self) -> str:
        return DatasourceProviderType.LOCAL_FILE

    def get_icon_url(self, tenant_id: str) -> str:
        return self.icon
