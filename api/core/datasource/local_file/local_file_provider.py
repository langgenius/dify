from typing import Any

from core.datasource.__base.datasource_provider import DatasourcePluginProviderController
from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import DatasourceProviderEntityWithPlugin, DatasourceProviderType
from core.datasource.local_file.local_file_plugin import LocalFileDatasourcePlugin


class LocalFileDatasourcePluginProviderController(DatasourcePluginProviderController):
    entity: DatasourceProviderEntityWithPlugin
    plugin_id: str
    plugin_unique_identifier: str

    def __init__(
        self, entity: DatasourceProviderEntityWithPlugin, plugin_id: str, plugin_unique_identifier: str, tenant_id: str
    ) -> None:
        super().__init__(entity, tenant_id)
        self.plugin_id = plugin_id
        self.plugin_unique_identifier = plugin_unique_identifier

    @property
    def provider_type(self) -> DatasourceProviderType:
        """
        returns the type of the provider
        """
        return DatasourceProviderType.LOCAL_FILE

    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        """
        validate the credentials of the provider
        """
        pass

    def get_datasource(self, datasource_name: str) -> LocalFileDatasourcePlugin:  # type: ignore
        """
        return datasource with given name
        """
        datasource_entity = next(
            (
                datasource_entity
                for datasource_entity in self.entity.datasources
                if datasource_entity.identity.name == datasource_name
            ),
            None,
        )

        if not datasource_entity:
            raise ValueError(f"Datasource with name {datasource_name} not found")

        return LocalFileDatasourcePlugin(
            entity=datasource_entity,
            runtime=DatasourceRuntime(tenant_id=self.tenant_id),
            tenant_id=self.tenant_id,
            icon=self.entity.identity.icon,
            plugin_unique_identifier=self.plugin_unique_identifier,
        )
