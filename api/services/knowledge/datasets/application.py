"""Dataset administration policies independent of HTTP and persistence."""

from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from libs.url_utils import normalize_api_base_url
from machinery.context import RequestContext
from services.errors.dataset import DatasetNameDuplicateError
from services.knowledge.dataset_access import (
    DatasetAccess,
    DatasetAccessDeniedError,
    DatasetNotFoundError,
    validate_permission_change,
)
from services.knowledge.datasets.contracts import (
    DatasetConcurrentUpdateError,
    DatasetCreateMutation,
    DatasetCreationRecoveryError,
    DatasetDetailProjection,
    DatasetIndexAction,
    DatasetListFilter,
    DatasetNameConflictError,
    DatasetPermissionChangeSnapshot,
    DatasetUpdateMutation,
    DatasetUpdateSnapshot,
    DatasetVisibility,
    PreparedRagPipelineDatasetSettings,
    PreparedRagPipelineDatasetUpdate,
    RagPipelineDatasetCreateMutation,
    RagPipelineDatasetSettings,
)
from services.knowledge.datasets.retrieval import retrieval_methods
from services.knowledge.entities.datasets import DatasetDetailRecord, DatasetPage
from services.knowledge.entities.model_configuration import EmbeddingModelConfiguration
from services.knowledge.resource_scope import DatasetRef


class DatasetOperations(Protocol):
    """Materialize owned values and complete writes before returning."""

    def visibility(self, context: RequestContext) -> DatasetVisibility: ...
    def list_datasets(
        self, context: RequestContext, query: DatasetListFilter, accessible_ids: list[str] | None, include_own: bool
    ) -> DatasetPage: ...
    def embedding_models(self, workspace_id: str) -> set[str]: ...
    def get_dataset(self, context: RequestContext, ref: DatasetRef) -> DatasetDetailRecord: ...
    def console_permission_keys(self, context: RequestContext, dataset_id: str) -> list[str]: ...
    def initialize_creator_access(self, context: RequestContext, dataset_id: str) -> None: ...
    def next_rag_pipeline_dataset_name(self, tenant_id: str) -> str: ...
    def is_in_use(self, ref: DatasetRef) -> bool: ...
    def queries(self, ref: DatasetRef, *, page: int, limit: int) -> dict[str, Any]: ...
    def related_apps(self, ref: DatasetRef) -> dict[str, Any]: ...
    def indexing_status(self, ref: DatasetRef) -> dict[str, Any]: ...
    def error_documents(self, ref: DatasetRef) -> dict[str, Any]: ...
    def partial_members(self, ref: DatasetRef) -> list[str]: ...
    def auto_disable_logs(self, ref: DatasetRef) -> dict[str, Any]: ...


class DatasetMutationStore(Protocol):
    def create_dataset(self, mutation: DatasetCreateMutation) -> str: ...
    def create_rag_pipeline_dataset(self, mutation: RagPipelineDatasetCreateMutation) -> str: ...
    def get_update_snapshot(self, ref: DatasetRef, /) -> DatasetUpdateSnapshot | None: ...
    def get_permission_change_snapshot(
        self, ref: DatasetRef, /, *, actor_id: str
    ) -> DatasetPermissionChangeSnapshot | None: ...
    def update_dataset(self, mutation: DatasetUpdateMutation) -> bool: ...
    def external_api_exists(self, tenant_id: str, api_id: str) -> bool: ...
    def set_api_enabled(self, ref: DatasetRef, /, *, actor_id: str, enabled: bool) -> bool: ...
    def delete_with_relations(self, ref: DatasetRef, /) -> bool: ...


class DatasetModelConfigurationGateway(Protocol):
    def resolve_default_embedding_model(self, *, tenant_id: str) -> EmbeddingModelConfiguration: ...
    def resolve_embedding_model(self, *, tenant_id: str, provider: str, model: str) -> EmbeddingModelConfiguration: ...
    def validate_reranking_model(self, *, tenant_id: str, provider: str, model: str) -> None: ...


def _mapping(value: object) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, Mapping):
        return dict(value)
    raise ValueError("Expected an object value")


def _non_empty_string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _reranking_configuration(retrieval_model: Mapping[str, Any] | None) -> tuple[str, str] | None:
    if not retrieval_model:
        return None
    reranking = _mapping(retrieval_model.get("reranking_model"))
    if not reranking:
        return None
    provider = _non_empty_string(reranking.get("reranking_provider_name"))
    model = _non_empty_string(reranking.get("reranking_model_name"))
    return (provider, model) if provider and model else None


def _partial_member_ids(value: object) -> tuple[str, ...] | None:
    if value is None:
        return None
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ValueError("partial_member_list must be a list")
    result: list[str] = []
    for item in value:
        member_id: object
        if isinstance(item, str):
            member_id = item
        elif isinstance(item, Mapping):
            member_id = item.get("user_id")
        else:
            raise ValueError("partial_member_list items must contain user_id")
        normalized = _non_empty_string(member_id)
        if normalized is None:
            raise ValueError("partial_member_list items must contain user_id")
        if normalized not in result:
            result.append(normalized)
    return tuple(result)


class DatasetApplicationService:
    def __init__(
        self,
        *,
        dataset_access: DatasetAccess,
        operations: DatasetOperations,
        mutations: DatasetMutationStore,
        models: DatasetModelConfigurationGateway,
        rbac_enabled: bool,
        service_api_url: str,
        vector_store: str | None,
        tidb_fulltext: bool,
    ) -> None:
        self._dataset_access = dataset_access
        self._operations = operations
        self._mutations = mutations
        self._models = models
        self._rbac_enabled = rbac_enabled
        self._service_api_url = service_api_url
        self._vector_store = vector_store
        self._tidb_fulltext = tidb_fulltext

    def _dataset(self, context: RequestContext, dataset_id: str) -> DatasetRef:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        return DatasetRef(dataset.workspace_id, dataset.id)

    def require_accessible(self, context: RequestContext, dataset_id: str) -> DatasetRef:
        """Resolve an authorized dataset reference for non-HTTP application callers."""

        return self._dataset(context, dataset_id)

    @staticmethod
    def _embedding_available(item: DatasetDetailRecord, models: set[str], *, listing: bool) -> None:
        high_quality = item["indexing_technique"] == "high_quality"
        item["embedding_available"] = (
            not high_quality
            or (listing and not item["embedding_model_provider"])
            or f"{item['embedding_model']}:{item['embedding_model_provider']}" in models
        )

    def _list_datasets(
        self,
        context: RequestContext,
        query: DatasetListFilter,
        *,
        accessible_ids: list[str] | None,
        include_own: bool,
    ) -> DatasetPage:
        """Read the resolved scope; absent IDs admit all datasets in the workspace."""
        if context.resource_dataset_ids is not None:
            resource_ids = context.resource_dataset_ids
            accessible_ids = sorted(
                resource_ids if accessible_ids is None else resource_ids.intersection(accessible_ids)
            )
            include_own = False
        result = self._operations.list_datasets(context, query, accessible_ids, include_own)
        models = self._operations.embedding_models(context.active_workspace_id)
        for item in result["data"]:
            self._embedding_available(item, models, listing=True)
        return result

    def list_accessible_datasets(self, context: RequestContext, query: DatasetListFilter) -> DatasetPage:
        """List datasets visible to the account actor after resolving its RBAC scope."""
        visibility = self._operations.visibility(context)
        accessible_ids, include_own = visibility.list_scope(rbac_enabled=self._rbac_enabled)
        result = self._list_datasets(
            context,
            query,
            accessible_ids=accessible_ids,
            include_own=include_own,
        )
        for item in result["data"]:
            item["permission_keys"] = list(visibility.overrides.get(item["id"], visibility.default_permissions))
        return result

    def list_workspace_datasets(self, context: RequestContext, query: DatasetListFilter) -> DatasetPage:
        """List workspace datasets for a caller already admitted to the workspace scope."""
        return self._list_datasets(context, query, accessible_ids=None, include_own=False)

    def _project_detail(
        self,
        context: RequestContext,
        result: DatasetDetailRecord,
        projection: DatasetDetailProjection,
    ) -> DatasetDetailRecord:
        if projection is DatasetDetailProjection.CONSOLE:
            result["permission_keys"] = self._operations.console_permission_keys(context, result["id"])
        return result

    def get_dataset(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        projection: DatasetDetailProjection = DatasetDetailProjection.CORE,
    ) -> DatasetDetailRecord:
        result = self._operations.get_dataset(context, self._dataset(context, dataset_id))
        self._embedding_available(result, self._operations.embedding_models(context.active_workspace_id), listing=False)
        if result["indexing_technique"] == "economy" and result.get("retrieval_model_dict"):
            result["retrieval_model_dict"] = {
                **result["retrieval_model_dict"],
                "search_method": "keyword_search",
            }
        return self._project_detail(context, result, projection)

    def create_dataset(
        self,
        context: RequestContext,
        *,
        values: Mapping[str, Any],
        projection: DatasetDetailProjection = DatasetDetailProjection.CORE,
    ) -> DatasetDetailRecord:
        """Create a dataset using the workspace's RBAC visibility defaults."""
        permission = "all_team_members" if self._rbac_enabled else values.get("permission") or "only_me"
        return self._create_dataset(context, values=values, permission=permission, projection=projection)

    def create_dataset_with_requested_permission(
        self,
        context: RequestContext,
        *,
        values: Mapping[str, Any],
        projection: DatasetDetailProjection = DatasetDetailProjection.CORE,
    ) -> DatasetDetailRecord:
        """Create a dataset with its requested permission, defaulting to actor-only access."""
        return self._create_dataset(
            context,
            values=values,
            permission=values.get("permission") or "only_me",
            projection=projection,
        )

    def _create_dataset(
        self,
        context: RequestContext,
        *,
        values: Mapping[str, Any],
        permission: str,
        projection: DatasetDetailProjection,
    ) -> DatasetDetailRecord:
        if context.resource_dataset_ids is not None:
            raise DatasetAccessDeniedError()
        settings = dict(values)
        settings["permission"] = permission
        indexing_technique = settings.get("indexing_technique")
        embedding: EmbeddingModelConfiguration | None = None
        if indexing_technique == "high_quality":
            provider = _non_empty_string(settings.get("embedding_model_provider"))
            model = _non_empty_string(settings.get("embedding_model"))
            embedding = (
                self._models.resolve_embedding_model(
                    tenant_id=context.active_workspace_id,
                    provider=provider,
                    model=model,
                )
                if provider and model
                else self._models.resolve_default_embedding_model(tenant_id=context.active_workspace_id)
            )
        retrieval_model = _mapping(settings.get("retrieval_model"))
        reranking = _reranking_configuration(retrieval_model)
        if reranking is not None:
            self._models.validate_reranking_model(
                tenant_id=context.active_workspace_id,
                provider=reranking[0],
                model=reranking[1],
            )
        provider = str(settings.get("provider") or "vendor")
        external_api_id = _non_empty_string(settings.get("external_knowledge_api_id"))
        external_knowledge_id = _non_empty_string(settings.get("external_knowledge_id"))
        if provider == "external":
            if not external_api_id:
                raise ValueError("external_knowledge_api_id is required")
            if not external_knowledge_id:
                raise ValueError("external_knowledge_id is required")
            if not self._mutations.external_api_exists(context.active_workspace_id, external_api_id):
                raise ValueError("External API template not found.")
        try:
            dataset_id = self._mutations.create_dataset(
                DatasetCreateMutation(
                    tenant_id=context.active_workspace_id,
                    actor_id=context.account_id,
                    name=str(settings["name"]),
                    description=settings.get("description"),
                    indexing_technique=str(indexing_technique) if indexing_technique else None,
                    permission=permission,
                    provider=provider,
                    external_knowledge_api_id=external_api_id,
                    external_knowledge_id=external_knowledge_id,
                    embedding_model_provider=embedding.provider if embedding else None,
                    embedding_model=embedding.model if embedding else None,
                    retrieval_model=retrieval_model,
                    summary_index_setting=_mapping(settings.get("summary_index_setting")),
                    is_multimodal=embedding.supports_vision if embedding else False,
                )
            )
        except DatasetNameConflictError as error:
            raise DatasetNameDuplicateError(str(error)) from error
        ref = DatasetRef(context.active_workspace_id, dataset_id)
        try:
            self._operations.initialize_creator_access(context, dataset_id)
            result = self._operations.get_dataset(context, ref)
            return self._project_detail(context, result, projection)
        except Exception:
            try:
                if not self._mutations.delete_with_relations(ref):
                    raise DatasetNotFoundError()
            except Exception as recovery_error:
                raise DatasetCreationRecoveryError(dataset_id) from recovery_error
            raise

    def initialize_creator_access(self, context: RequestContext, *, dataset_id: str) -> None:
        """Initialize creator RBAC after an outer import transaction commits."""

        if context.resource_dataset_ids is not None:
            raise DatasetAccessDeniedError()
        self._operations.initialize_creator_access(context, dataset_id)

    def create_rag_pipeline_dataset(
        self,
        context: RequestContext,
        *,
        values: Mapping[str, Any],
        projection: DatasetDetailProjection = DatasetDetailProjection.CORE,
    ) -> DatasetDetailRecord:
        if context.resource_dataset_ids is not None:
            raise DatasetAccessDeniedError()
        name = _non_empty_string(values.get("name")) or self._operations.next_rag_pipeline_dataset_name(
            context.active_workspace_id
        )
        permission = str(values.get("permission") or ("all_team_members" if self._rbac_enabled else "only_me"))
        member_ids = _partial_member_ids(values.get("partial_member_list"))
        try:
            dataset_id = self._mutations.create_rag_pipeline_dataset(
                RagPipelineDatasetCreateMutation(
                    tenant_id=context.active_workspace_id,
                    actor_id=context.account_id,
                    name=name,
                    description=str(values.get("description") or ""),
                    permission=permission,
                    icon_info=_mapping(values.get("icon_info")) or {},
                    partial_member_ids=member_ids,
                )
            )
        except DatasetNameConflictError as error:
            raise DatasetNameDuplicateError(str(error)) from error
        ref = DatasetRef(context.active_workspace_id, dataset_id)
        try:
            self._operations.initialize_creator_access(context, dataset_id)
            result = self._operations.get_dataset(context, ref)
            return self._project_detail(context, result, projection)
        except Exception:
            try:
                if not self._mutations.delete_with_relations(ref):
                    raise DatasetNotFoundError()
            except Exception as recovery_error:
                raise DatasetCreationRecoveryError(dataset_id) from recovery_error
            raise

    def update_dataset(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        values: Mapping[str, Any],
        projection: DatasetDetailProjection = DatasetDetailProjection.CORE,
    ) -> DatasetDetailRecord:
        ref = self._dataset(context, dataset_id)
        permission_keys = (
            self._operations.console_permission_keys(context, dataset_id)
            if projection is DatasetDetailProjection.CONSOLE
            else None
        )
        for _attempt in range(2):
            snapshot = self._mutations.get_update_snapshot(ref)
            if snapshot is None:
                raise DatasetNotFoundError()
            # Null patch values preserve existing settings; only description is
            # explicitly clearable. Model transitions add their own nulls below.
            data = {key: value for key, value in values.items() if value is not None or key == "description"}
            permission_snapshot = self._mutations.get_permission_change_snapshot(
                ref,
                actor_id=context.account_id,
            )
            if permission_snapshot is None:
                raise DatasetNotFoundError()
            if not self._rbac_enabled:
                requested_members = _partial_member_ids(data.get("partial_member_list"))
                validate_permission_change(
                    actor_role=permission_snapshot.actor_role,
                    current_permission=permission_snapshot.current_permission,
                    current_member_ids=permission_snapshot.current_member_ids,
                    requested_permission=data.get("permission"),
                    requested_member_ids=requested_members,
                )

            index_action: DatasetIndexAction | None = None
            retry_failed_vector_index = False
            if snapshot.provider == "external":
                api_id = _non_empty_string(data.get("external_knowledge_api_id"))
                external_id = _non_empty_string(data.get("external_knowledge_id"))
                if not external_id:
                    raise ValueError("External knowledge id is required.")
                if not api_id:
                    raise ValueError("External knowledge api id is required.")
                if not self._mutations.external_api_exists(ref.tenant_id, api_id):
                    raise ValueError("External API template not found.")
                retrieval = _mapping(data.get("external_retrieval_model"))
                if retrieval is not None:
                    data["external_retrieval_model"] = retrieval
            else:
                for key in ("external_knowledge_api_id", "external_knowledge_id", "external_retrieval_model"):
                    data.pop(key, None)
                new_technique = str(data.get("indexing_technique") or snapshot.indexing_technique or "")
                provider = _non_empty_string(data.get("embedding_model_provider"))
                model = _non_empty_string(data.get("embedding_model"))
                if new_technique == "high_quality":
                    if snapshot.indexing_technique != "high_quality" and not (provider and model):
                        raise ValueError("Embedding model provider and model are required for high quality indexing")
                    if provider and model:
                        embedding = self._models.resolve_embedding_model(
                            tenant_id=ref.tenant_id,
                            provider=provider,
                            model=model,
                        )
                        changed = (
                            snapshot.indexing_technique != "high_quality"
                            or embedding.provider != snapshot.embedding_model_provider
                            or embedding.model != snapshot.embedding_model
                        )
                        data["embedding_model_provider"] = embedding.provider
                        data["embedding_model"] = embedding.model
                        data["is_multimodal"] = embedding.supports_vision
                        if changed:
                            index_action = (
                                DatasetIndexAction.ADD
                                if snapshot.indexing_technique != "high_quality"
                                else DatasetIndexAction.UPDATE
                            )
                        else:
                            retry_failed_vector_index = True
                    else:
                        data.pop("embedding_model_provider", None)
                        data.pop("embedding_model", None)
                elif new_technique == "economy":
                    data.pop("embedding_model_provider", None)
                    data.pop("embedding_model", None)
                    if snapshot.indexing_technique == "high_quality":
                        data.update(
                            embedding_model_provider=None,
                            embedding_model=None,
                            collection_binding_id=None,
                            is_multimodal=False,
                        )
                        index_action = DatasetIndexAction.REMOVE
                    elif data.get("indexing_technique") == "economy":
                        retry_failed_vector_index = True
                retrieval_model = _mapping(data.get("retrieval_model"))
                if retrieval_model is not None:
                    data["retrieval_model"] = retrieval_model
                    reranking = _reranking_configuration(retrieval_model)
                    if reranking is not None:
                        self._models.validate_reranking_model(
                            tenant_id=ref.tenant_id,
                            provider=reranking[0],
                            model=reranking[1],
                        )
            for key in ("retrieval_model", "summary_index_setting", "icon_info"):
                if key in data and data[key] is not None:
                    data[key] = _mapping(data[key])
            data.pop("partial_member_list", None)
            requested_permission = data.get("permission")
            partial_member_ids = _partial_member_ids(values.get("partial_member_list"))
            try:
                updated = self._mutations.update_dataset(
                    DatasetUpdateMutation(
                        ref_tenant_id=ref.tenant_id,
                        ref_dataset_id=ref.dataset_id,
                        actor_id=context.account_id,
                        expected=snapshot,
                        permission_expected=permission_snapshot,
                        values=data,
                        index_action=index_action,
                        retry_failed_vector_index=retry_failed_vector_index,
                        partial_member_ids=(
                            partial_member_ids
                            if requested_permission == "partial_members" or snapshot.permission == "partial_members"
                            else None
                        ),
                        clear_partial_members=requested_permission in {"only_me", "all_team_members"},
                    )
                )
            except DatasetNameConflictError as error:
                raise DatasetNameDuplicateError(str(error)) from error
            if not updated:
                continue
            result = self._operations.get_dataset(context, ref)
            if permission_keys is not None:
                result["permission_keys"] = permission_keys
            return result
        raise DatasetConcurrentUpdateError("Dataset changed while model settings were being validated")

    def delete_dataset(self, context: RequestContext, *, dataset_id: str) -> None:
        if not self._mutations.delete_with_relations(self._dataset(context, dataset_id)):
            raise DatasetNotFoundError()

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

    def prepare_rag_pipeline_dataset_settings(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        settings: RagPipelineDatasetSettings,
        has_published: bool,
    ) -> PreparedRagPipelineDatasetUpdate:
        """Resolve provider-backed settings before an outer publish transaction starts."""

        ref = self._dataset(context, dataset_id)
        snapshot = self._mutations.get_update_snapshot(ref)
        if snapshot is None:
            raise DatasetNotFoundError()
        if has_published and snapshot.chunk_structure and snapshot.chunk_structure != settings.chunk_structure:
            raise ValueError("Chunk structure is not allowed to be updated.")
        if has_published and snapshot.indexing_technique == "high_quality" and settings.indexing_technique == "economy":
            raise ValueError("Knowledge base indexing technique is not allowed to be updated to economy.")

        resolved: EmbeddingModelConfiguration | None = None
        action: DatasetIndexAction | None = None
        retry_failed_vector_index = False
        if settings.indexing_technique == "high_quality":
            provider = _non_empty_string(settings.embedding_model_provider)
            model = _non_empty_string(settings.embedding_model)
            if not provider or not model:
                raise ValueError("Embedding model provider and model are required for high quality indexing")
            resolved = self._models.resolve_embedding_model(
                tenant_id=ref.tenant_id,
                provider=provider,
                model=model,
            )
            if (
                snapshot.indexing_technique != "high_quality"
                or resolved.provider != snapshot.embedding_model_provider
                or resolved.model != snapshot.embedding_model
            ):
                action = (
                    DatasetIndexAction.ADD
                    if snapshot.indexing_technique != "high_quality"
                    else DatasetIndexAction.UPDATE
                )
            else:
                retry_failed_vector_index = True
        elif settings.indexing_technique != "economy":
            raise ValueError("Invalid index method")
        elif snapshot.indexing_technique == "high_quality":
            action = DatasetIndexAction.REMOVE
        else:
            retry_failed_vector_index = True

        reranking = _reranking_configuration(settings.retrieval_model)
        if reranking is not None:
            self._models.validate_reranking_model(
                tenant_id=ref.tenant_id,
                provider=reranking[0],
                model=reranking[1],
            )
        prepared = PreparedRagPipelineDatasetSettings(
            settings=settings,
            resolved_embedding_model_provider=resolved.provider if resolved else None,
            resolved_embedding_model=resolved.model if resolved else None,
            is_multimodal=resolved.supports_vision if resolved else False,
            index_action=action,
            retry_failed_vector_index=retry_failed_vector_index,
        )
        return PreparedRagPipelineDatasetUpdate(
            tenant_id=ref.tenant_id,
            dataset_id=ref.dataset_id,
            actor_id=context.account_id,
            expected=snapshot,
            prepared=prepared,
        )

    def auto_disable_logs(self, context: RequestContext, *, dataset_id: str) -> dict[str, Any]:
        return self._operations.auto_disable_logs(self._dataset(context, dataset_id))

    def set_api_enabled(self, context: RequestContext, *, dataset_id: str, status: str) -> None:
        if not self._mutations.set_api_enabled(
            self._dataset(context, dataset_id),
            actor_id=context.account_id,
            enabled=status == "enable",
        ):
            raise DatasetNotFoundError()

    def api_base_url(self, context: RequestContext, *, request_base_url: str) -> str:
        return normalize_api_base_url(self._service_api_url or request_base_url)

    def retrieval_settings(
        self, context: RequestContext, *, vector_type: str | None = None, is_mock: bool = False
    ) -> dict[str, list[str]]:
        return retrieval_methods(
            vector_type if is_mock else self._vector_store, is_mock=is_mock, tidb_fulltext=self._tidb_fulltext
        )
