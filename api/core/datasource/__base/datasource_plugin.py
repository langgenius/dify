from abc import ABC, abstractmethod

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceProviderType,
)


class DatasourcePlugin(ABC):
    entity: DatasourceEntity
    runtime: DatasourceRuntime

    def __init__(
        self,
        entity: DatasourceEntity,
        runtime: DatasourceRuntime,
    ) -> None:
        self.entity = entity
        self.runtime = runtime

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
        )
