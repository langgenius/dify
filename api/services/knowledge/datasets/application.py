"""Dataset administration policies independent of HTTP and persistence."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from libs.url_utils import normalize_api_base_url
from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.datasets.retrieval import retrieval_methods
from services.knowledge.resource_scope import DatasetRef


@dataclass(frozen=True)
class DatasetListFilter:
    page: int = 1
    limit: int = 20
    keyword: str | None = None
    include_all: bool = False
    ids: Sequence[str] = ()
    tag_ids: Sequence[str] = ()


@dataclass(frozen=True)
class DatasetVisibility:
    default_permissions: Sequence[str] = ()
    workspace_permissions: Sequence[str] = ()
    overrides: Mapping[str, Sequence[str]] = field(default_factory=dict)
    unrestricted: bool = True
    whitelist_ids: Sequence[str] = ()

    def list_scope(self, *, rbac_enabled: bool) -> tuple[list[str] | None, bool]:
        if not rbac_enabled:
            return None, False
        # A restricted whitelist always takes precedence over default grants,
        # resource overrides and the creator's own-dataset fallback.
        if not self.unrestricted:
            return sorted(set(self.whitelist_ids)), False
        read_keys = {"dataset.preview", "dataset.acl.preview", "dataset.full_access"}
        default_read = bool(
            read_keys.intersection(self.default_permissions) or read_keys.intersection(self.workspace_permissions)
        )
        ids = (
            None
            if default_read
            else sorted(key for key, grants in self.overrides.items() if read_keys.intersection(grants))
        )
        return ids, "dataset.create_and_management" in self.workspace_permissions


class DatasetOperations(Protocol):
    """Materialize owned values and complete writes before returning."""

    def visibility(self, context: RequestContext) -> DatasetVisibility: ...
    def list_datasets(
        self, context: RequestContext, query: DatasetListFilter, accessible_ids: list[str] | None, include_own: bool
    ) -> dict[str, Any]: ...
    def embedding_models(self, workspace_id: str) -> set[str]: ...
    def get_dataset(self, context: RequestContext, ref: DatasetRef) -> dict[str, Any]: ...
    def create_dataset(self, context: RequestContext, values: Mapping[str, Any]) -> dict[str, Any]: ...
    def update_dataset(self, context: RequestContext, ref: DatasetRef, values: Mapping[str, Any]) -> dict[str, Any]: ...
    def delete_dataset(self, context: RequestContext, ref: DatasetRef) -> None: ...
    def is_in_use(self, ref: DatasetRef) -> bool: ...
    def queries(self, ref: DatasetRef, *, page: int, limit: int) -> dict[str, Any]: ...
    def related_apps(self, ref: DatasetRef) -> dict[str, Any]: ...
    def indexing_status(self, ref: DatasetRef) -> dict[str, Any]: ...
    def error_documents(self, ref: DatasetRef) -> dict[str, Any]: ...
    def partial_members(self, ref: DatasetRef) -> list[str]: ...
    def auto_disable_logs(self, ref: DatasetRef) -> dict[str, Any]: ...
    def set_api_enabled(self, context: RequestContext, ref: DatasetRef, enabled: bool) -> None: ...


class DatasetApplicationService:
    def __init__(
        self,
        *,
        dataset_access: DatasetAccess,
        operations: DatasetOperations,
        rbac_enabled: bool,
        service_api_url: str,
        vector_store: str | None,
        tidb_fulltext: bool,
    ) -> None:
        self._dataset_access = dataset_access
        self._operations = operations
        self._rbac_enabled = rbac_enabled
        self._service_api_url = service_api_url
        self._vector_store = vector_store
        self._tidb_fulltext = tidb_fulltext

    def _dataset(self, context: RequestContext, dataset_id: str) -> DatasetRef:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        return DatasetRef(dataset.workspace_id, dataset.id)

    @staticmethod
    def _embedding_available(item: dict[str, Any], models: set[str], *, listing: bool) -> None:
        high_quality = item["indexing_technique"] == "high_quality"
        item["embedding_available"] = (
            not high_quality
            or (listing and not item["embedding_model_provider"])
            or f"{item['embedding_model']}:{item['embedding_model_provider']}" in models
        )

    def list_datasets(self, context: RequestContext, query: DatasetListFilter) -> dict[str, Any]:
        visibility = self._operations.visibility(context)
        ids, include_own = visibility.list_scope(rbac_enabled=self._rbac_enabled)
        result = self._operations.list_datasets(context, query, ids, include_own)
        models = self._operations.embedding_models(context.active_workspace_id)
        for item in result["data"]:
            item["permission_keys"] = list(visibility.overrides.get(item["id"], visibility.default_permissions))
            self._embedding_available(item, models, listing=True)
        return result

    def get_dataset(self, context: RequestContext, *, dataset_id: str) -> dict[str, Any]:
        result = self._operations.get_dataset(context, self._dataset(context, dataset_id))
        self._embedding_available(result, self._operations.embedding_models(context.active_workspace_id), listing=False)
        return result

    def create_dataset(self, context: RequestContext, *, values: Mapping[str, Any]) -> dict[str, Any]:
        settings = dict(values)
        settings["permission"] = "all_team_members" if self._rbac_enabled else settings.get("permission") or "only_me"
        return self._operations.create_dataset(context, settings)

    def update_dataset(self, context: RequestContext, *, dataset_id: str, values: Mapping[str, Any]) -> dict[str, Any]:
        return self._operations.update_dataset(context, self._dataset(context, dataset_id), values)

    def delete_dataset(self, context: RequestContext, *, dataset_id: str) -> None:
        self._operations.delete_dataset(context, self._dataset(context, dataset_id))

    def is_in_use(self, context: RequestContext, *, dataset_id: str) -> bool:
        return self._operations.is_in_use(self._dataset(context, dataset_id))

    def queries(self, context: RequestContext, *, dataset_id: str, page: int, limit: int) -> dict[str, Any]:
        return self._operations.queries(self._dataset(context, dataset_id), page=page, limit=limit)

    def related_apps(self, context: RequestContext, *, dataset_id: str) -> dict[str, Any]:
        return self._operations.related_apps(self._dataset(context, dataset_id))

    def indexing_status(self, context: RequestContext, *, dataset_id: str) -> dict[str, Any]:
        return self._operations.indexing_status(self._dataset(context, dataset_id))

    def error_documents(self, context: RequestContext, *, dataset_id: str) -> dict[str, Any]:
        return self._operations.error_documents(self._dataset(context, dataset_id))

    def partial_members(self, context: RequestContext, *, dataset_id: str) -> list[str]:
        return self._operations.partial_members(self._dataset(context, dataset_id))

    def auto_disable_logs(self, context: RequestContext, *, dataset_id: str) -> dict[str, Any]:
        return self._operations.auto_disable_logs(self._dataset(context, dataset_id))

    def set_api_enabled(self, context: RequestContext, *, dataset_id: str, status: str) -> None:
        self._operations.set_api_enabled(context, self._dataset(context, dataset_id), status == "enable")

    def api_base_url(self, context: RequestContext, *, request_base_url: str) -> str:
        return normalize_api_base_url(self._service_api_url or request_base_url)

    def retrieval_settings(
        self, context: RequestContext, *, vector_type: str | None = None, is_mock: bool = False
    ) -> dict[str, list[str]]:
        return retrieval_methods(
            vector_type if is_mock else self._vector_store, is_mock=is_mock, tidb_fulltext=self._tidb_fulltext
        )
