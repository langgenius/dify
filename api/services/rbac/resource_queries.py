"""Tenant-owned resource references used to resolve authorization targets."""

from typing import Protocol

from services.entities.app_entities import AppAgentBinding
from services.rbac.ports import ResourceMaintainers


class AppResourceQueries(Protocol):
    def get_agent_binding(self, workspace_id: str, app_id: str) -> AppAgentBinding | None: ...

    def get_maintainer_id(self, workspace_id: str, resource_id: str, *, normal_only: bool = False) -> str | None: ...


class DatasetResourceQueries(ResourceMaintainers, Protocol):
    def get_dataset_id_by_document(self, workspace_id: str, document_id: str) -> str | None: ...

    def get_dataset_id_by_pipeline(self, workspace_id: str, pipeline_id: str) -> str | None: ...


class ResourceQueryService:
    def __init__(self, *, apps: AppResourceQueries, datasets: DatasetResourceQueries) -> None:
        self._apps = apps
        self._datasets = datasets

    def get_app_agent_binding(self, workspace_id: str, app_id: str) -> AppAgentBinding | None:
        return self._apps.get_agent_binding(workspace_id, app_id)

    def get_app_maintainer(self, workspace_id: str, app_id: str) -> str | None:
        return self._apps.get_maintainer_id(workspace_id, app_id, normal_only=True)

    def get_dataset_maintainer(self, workspace_id: str, dataset_id: str) -> str | None:
        return self._datasets.get_maintainer_id(workspace_id, dataset_id)

    def get_dataset_id_by_document(self, workspace_id: str, document_id: str) -> str | None:
        return self._datasets.get_dataset_id_by_document(workspace_id, document_id)

    def get_dataset_id_by_pipeline(self, workspace_id: str, pipeline_id: str) -> str | None:
        return self._datasets.get_dataset_id_by_pipeline(workspace_id, pipeline_id)
