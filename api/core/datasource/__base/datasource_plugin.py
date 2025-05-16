from collections.abc import Mapping
from typing import Any

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
)
from core.plugin.impl.datasource import PluginDatasourceManager
from core.plugin.utils.converter import convert_parameters_to_plugin_format


class DatasourcePlugin:
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
        self.entity = entity
        self.runtime = runtime
        self.tenant_id = tenant_id
        self.icon = icon
        self.plugin_unique_identifier = plugin_unique_identifier

    def _invoke_first_step(
        self,
        user_id: str,
        datasource_parameters: dict[str, Any],
    ) -> Mapping[str, Any]:
        manager = PluginDatasourceManager()

        datasource_parameters = convert_parameters_to_plugin_format(datasource_parameters)

        return manager.invoke_first_step(
            tenant_id=self.tenant_id,
            user_id=user_id,
            datasource_provider=self.entity.identity.provider,
            datasource_name=self.entity.identity.name,
            credentials=self.runtime.credentials,
            datasource_parameters=datasource_parameters,
        )

    def _invoke_second_step(
        self,
        user_id: str,
        datasource_parameters: dict[str, Any],
    ) -> Mapping[str, Any]:
        manager = PluginDatasourceManager()

        datasource_parameters = convert_parameters_to_plugin_format(datasource_parameters)

        return manager.invoke_second_step(
            tenant_id=self.tenant_id,
            user_id=user_id,
            datasource_provider=self.entity.identity.provider,
            datasource_name=self.entity.identity.name,
            credentials=self.runtime.credentials,
            datasource_parameters=datasource_parameters,
        )

    def fork_datasource_runtime(self, runtime: DatasourceRuntime) -> "DatasourcePlugin":
        return DatasourcePlugin(
            entity=self.entity,
            runtime=runtime,
            tenant_id=self.tenant_id,
            icon=self.icon,
            plugin_unique_identifier=self.plugin_unique_identifier,
        )
