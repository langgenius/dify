"""Dataset administration policies independent of HTTP and persistence."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from libs.url_utils import normalize_api_base_url
from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.datasets.availability import is_embedding_available
from services.knowledge.datasets.retrieval import retrieval_methods
from services.knowledge.entities.datasets import (
    DatasetAvailabilityFilter,
    DatasetDetailRecord,
    DatasetPage,
)
from services.knowledge.resource_scope import DatasetRef


@dataclass(frozen=True)
class DatasetListFilter:
    page: int = 1
    limit: int = 20
    keyword: str | None = None
    include_all: bool = False
    ids: Sequence[str] = ()
    tag_ids: Sequence[str] = ()
    creator_ids: Sequence[str] = ()
    availability: DatasetAvailabilityFilter = DatasetAvailabilityFilter.ALL
    for_selection: bool = False


@dataclass(frozen=True)
class DatasetVisibility:
    default_permissions: Sequence[str] = ()
    workspace_permissions: Sequence[str] = ()
    overrides: Mapping[str, Sequence[str]] = field(default_factory=dict)
    unrestricted: bool = True
    whitelist_ids: Sequence[str] = ()

    def list_scope(self, *, rbac_enabled: bool) -> list[str] | None:
        if not rbac_enabled:
            return None
        # Maintainers always retain visibility of their own datasets. The
        # whitelist takes precedence over grants only for other datasets.
        if not self.unrestricted:
            return sorted(set(self.whitelist_ids))
        read_keys = {"dataset.preview", "dataset.acl.preview", "dataset.full_access"}
        default_read = bool(
            read_keys.intersection(self.default_permissions) or read_keys.intersection(self.workspace_permissions)
        )
        ids = (
            None
            if default_read
            else sorted(key for key, grants in self.overrides.items() if read_keys.intersection(grants))
        )
        return ids


class DatasetOperations(Protocol):
    """Materialize owned values and complete writes before returning."""

    def visibility(self, context: RequestContext) -> DatasetVisibility: ...
    def list_datasets(
        self,
        context: RequestContext,
        query: DatasetListFilter,
        accessible_ids: list[str] | None,
        *,
        embedding_models: set[str],
    ) -> DatasetPage:
        """Return an owner-scoped page with all requested filters applied before pagination.

        Preconditions: context identifies the workspace; accessible_ids is the
        admitted RBAC scope. embedding_models contains its active model keys when
        availability is filtered, and may be empty for an unfiltered selection.
        Postconditions: rows and totals agree, no records outside that scope are
        returned, and no persistence objects or open sessions escape the port.
        """
        ...

    def embedding_models(self, workspace_id: str) -> set[str]: ...
    def get_dataset(self, context: RequestContext, ref: DatasetRef) -> DatasetDetailRecord: ...
    def create_dataset(self, context: RequestContext, values: Mapping[str, Any]) -> DatasetDetailRecord: ...
    def update_dataset(
        self, context: RequestContext, ref: DatasetRef, values: Mapping[str, Any]
    ) -> DatasetDetailRecord: ...
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
    def _embedding_available(item: DatasetDetailRecord, embedding_models: set[str], *, listing: bool) -> None:
        item["embedding_available"] = is_embedding_available(
            indexing_technique=item["indexing_technique"],
            embedding_model=item["embedding_model"],
            embedding_model_provider=item["embedding_model_provider"],
            embedding_models=embedding_models,
            listing=listing,
        )

    def list_datasets(self, context: RequestContext, query: DatasetListFilter) -> DatasetPage:
        """List datasets for an admitted workspace without changing persisted state.

        Preconditions: context identifies the admitted account and active workspace.
        Postconditions: the adapter applies visibility and availability before
        pagination. Regular lists include permissions and embedding availability;
        selection lists preserve the adapter's undecorated response. Model lookup
        failures propagate rather than presenting filtered datasets as available.
        """
        visibility = self._operations.visibility(context)
        ids = visibility.list_scope(rbac_enabled=self._rbac_enabled)
        # Selection omits embedding metadata, but an explicit availability filter
        # still needs the active model snapshot before pagination.
        embedding_models = (
            set()
            if query.for_selection and query.availability is DatasetAvailabilityFilter.ALL
            else self._operations.embedding_models(context.active_workspace_id)
        )
        result = self._operations.list_datasets(context, query, ids, embedding_models=embedding_models)
        if query.for_selection:
            return result
        for item in result["data"]:
            item["permission_keys"] = list(visibility.overrides.get(item["id"], visibility.default_permissions))
            self._embedding_available(item, embedding_models, listing=True)
        return result

    def get_dataset(self, context: RequestContext, *, dataset_id: str) -> DatasetDetailRecord:
        result = self._operations.get_dataset(context, self._dataset(context, dataset_id))
        self._embedding_available(result, self._operations.embedding_models(context.active_workspace_id), listing=False)
        return result

    def create_dataset(self, context: RequestContext, *, values: Mapping[str, Any]) -> DatasetDetailRecord:
        settings = dict(values)
        settings["permission"] = "all_team_members" if self._rbac_enabled else settings.get("permission") or "only_me"
        return self._operations.create_dataset(context, settings)

    def update_dataset(
        self, context: RequestContext, *, dataset_id: str, values: Mapping[str, Any]
    ) -> DatasetDetailRecord:
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
