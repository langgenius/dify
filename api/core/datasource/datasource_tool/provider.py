from typing import Any

from core.datasource.datasource_tool.tool import DatasourceTool
from core.datasource.entities.datasource_entities import DatasourceProviderEntityWithPlugin, DatasourceProviderType
from core.plugin.manager.tool import PluginToolManager
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.entities.tool_entities import ToolProviderEntityWithPlugin, ToolProviderType
from core.tools.errors import ToolProviderCredentialValidationError


class DatasourceToolProviderController(BuiltinToolProviderController):
    entity: DatasourceProviderEntityWithPlugin
    tenant_id: str
    plugin_id: str
    plugin_unique_identifier: str

    def __init__(
        self, entity: DatasourceProviderEntityWithPlugin, plugin_id: str, plugin_unique_identifier: str, tenant_id: str
    ) -> None:
        self.entity = entity
        self.tenant_id = tenant_id
        self.plugin_id = plugin_id
        self.plugin_unique_identifier = plugin_unique_identifier

    @property
    def provider_type(self) -> DatasourceProviderType:
        """
        returns the type of the provider

        :return: type of the provider
        """
        return DatasourceProviderType.RAG_PIPELINE

    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        """
        validate the credentials of the provider
        """
        manager = PluginToolManager()
        if not manager.validate_provider_credentials(
            tenant_id=self.tenant_id,
            user_id=user_id,
            provider=self.entity.identity.name,
            credentials=credentials,
        ):
            raise ToolProviderCredentialValidationError("Invalid credentials")

    def get_datasource(self, datasource_name: str) -> DatasourceTool:  # type: ignore
        """
        return datasource with given name
        """
        datasource_entity = next(
            (datasource_entity for datasource_entity in self.entity.datasources if datasource_entity.identity.name == datasource_name), None
        )

        if not datasource_entity:
            raise ValueError(f"Datasource with name {datasource_name} not found")

        return DatasourceTool(
            entity=datasource_entity,
            runtime=ToolRuntime(tenant_id=self.tenant_id),
            tenant_id=self.tenant_id,
            icon=self.entity.identity.icon,
            plugin_unique_identifier=self.plugin_unique_identifier,
        )

    def get_datasources(self) -> list[DatasourceTool]:  # type: ignore
        """
        get all datasources
        """
        return [
            DatasourceTool(
                entity=datasource_entity,
                runtime=ToolRuntime(tenant_id=self.tenant_id),
                tenant_id=self.tenant_id,
                icon=self.entity.identity.icon,
                plugin_unique_identifier=self.plugin_unique_identifier,
            )
            for datasource_entity in self.entity.datasources
        ]
