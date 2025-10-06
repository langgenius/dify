from abc import ABC, abstractmethod

from configs import dify_config
from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceProviderType,
)


class DatasourcePlugin(ABC):
    entity: DatasourceEntity
    runtime: DatasourceRuntime
    icon: str

    def __init__(
        self,
        entity: DatasourceEntity,
        runtime: DatasourceRuntime,
        icon: str,
    ) -> None:
        self.entity = entity
        self.runtime = runtime
        self.icon = icon

    @abstractmethod
    def datasource_provider_type(self) -> str:
        """
        returns the type of the datasource provider
        """
        return DatasourceProviderType.LOCAL_FILE

    def fork_datasource_runtime(self, runtime: DatasourceRuntime) -> "DatasourcePlugin":
        return self.__class__(
            entity=self.entity.model_copy(),
            runtime=runtime,
            icon=self.icon,
        )

    def get_icon_url(self, tenant_id: str) -> str:
        return f"{dify_config.CONSOLE_API_URL}/console/api/workspaces/current/plugin/icon?tenant_id={tenant_id}&filename={self.icon}"  # noqa: E501
