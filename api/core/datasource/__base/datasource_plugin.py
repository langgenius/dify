from collections.abc import Generator
from typing import Any, Optional

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.datasource_manager import DatasourceManager
from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceInvokeMessage,
    DatasourceParameter,
    DatasourceProviderType,
)
from core.plugin.utils.converter import convert_parameters_to_plugin_format


class DatasourcePlugin:
    tenant_id: str
    icon: str
    plugin_unique_identifier: str
    runtime_parameters: Optional[list[DatasourceParameter]]
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
        self.runtime_parameters = None

    def datasource_provider_type(self) -> DatasourceProviderType:
        return DatasourceProviderType.RAG_PIPELINE

    def _invoke_first_step(
        self,
        user_id: str,
        datasource_parameters: dict[str, Any],
        rag_pipeline_id: Optional[str] = None,
    ) -> Generator[DatasourceInvokeMessage, None, None]:
        manager = DatasourceManager()

        datasource_parameters = convert_parameters_to_plugin_format(datasource_parameters)

        yield from manager.invoke_first_step(
            tenant_id=self.tenant_id,
            user_id=user_id,
            datasource_provider=self.entity.identity.provider,
            datasource_name=self.entity.identity.name,
            credentials=self.runtime.credentials,
            datasource_parameters=datasource_parameters,
            rag_pipeline_id=rag_pipeline_id,
        )

    def _invoke_second_step(
        self,
        user_id: str,
        datasource_parameters: dict[str, Any],
        rag_pipeline_id: Optional[str] = None,
    ) -> Generator[DatasourceInvokeMessage, None, None]:
        manager = DatasourceManager()

        datasource_parameters = convert_parameters_to_plugin_format(datasource_parameters)

        yield from manager.invoke(
            tenant_id=self.tenant_id,
            user_id=user_id,
            datasource_provider=self.entity.identity.provider,
            datasource_name=self.entity.identity.name,
            credentials=self.runtime.credentials,
            datasource_parameters=datasource_parameters,
            rag_pipeline_id=rag_pipeline_id,
        )

    def fork_datasource_runtime(self, runtime: DatasourceRuntime) -> "DatasourcePlugin":
        return DatasourcePlugin(
            entity=self.entity,
            runtime=runtime,
            tenant_id=self.tenant_id,
            icon=self.icon,
            plugin_unique_identifier=self.plugin_unique_identifier,
        )

    def get_runtime_parameters(
        self,
        rag_pipeline_id: Optional[str] = None,
    ) -> list[DatasourceParameter]:
        """
        get the runtime parameters
        """
        if not self.entity.has_runtime_parameters:
            return self.entity.parameters

        if self.runtime_parameters is not None:
            return self.runtime_parameters

        manager = PluginDatasourceManager()
        self.runtime_parameters = manager.get_runtime_parameters(
            tenant_id=self.tenant_id,
            user_id="",
            provider=self.entity.identity.provider,
            datasource=self.entity.identity.name,
            credentials=self.runtime.credentials,
            rag_pipeline_id=rag_pipeline_id,
        )

        return self.runtime_parameters
