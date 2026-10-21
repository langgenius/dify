"""Session-owning dataset administration adapters."""

import datetime
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.helper.name_generator import generate_incremental_name
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from enums import CloudPlan, DeploymentEdition
from graphon.model_runtime.entities.model_entities import ModelType
from libs.pagination import clamp_pagination
from machinery.context import RequestContext
from models import Dataset, Document
from models.dataset import DatasetPermissionEnum
from models.provider_ids import ModelProviderID
from repositories.knowledge.dataset_read_repository import (
    get_dataset_list_actor_role,
    list_auto_disabled_document_ids,
    list_dataset_permission_member_ids,
    list_dataset_queries,
    list_related_apps,
    list_visible_datasets,
    list_visible_datasets_by_ids,
)
from repositories.knowledge.dataset_repository import (
    SQLAlchemyDatasetRepository,
    _get_dataset,
    get_dataset_vector_index_state,
    get_dataset_vector_index_states,
)
from repositories.knowledge.document_query_repository import (
    get_document_segment_counts,
    get_error_documents,
    list_dataset_documents,
)
from services.app.query_service import RelatedApps
from services.enterprise import rbac_service
from services.feature_service import FeatureService
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.dataset_read_service import get_dataset_queries, load_dataset_detail, load_dataset_details
from services.knowledge.datasets.contracts import (
    DatasetListFilter,
    DatasetVisibility,
)
from services.knowledge.entities.datasets import DatasetDetailRecord, DatasetPage
from services.knowledge.resource_scope import DatasetRef
from services.rbac import contracts as rbac_contracts
from services.rbac.members import MemberService
from services.tag_application_service import TagTargetQuery


def require_dataset(session: Session, ref: DatasetRef) -> Dataset:
    dataset = _get_dataset(session, ref)
    if dataset is None:
        raise DatasetNotFoundError()
    return dataset


def _normalize_provider(item: DatasetDetailRecord) -> DatasetDetailRecord:
    if item["indexing_technique"] == "high_quality" and item["embedding_model_provider"]:
        item["embedding_model_provider"] = str(ModelProviderID(item["embedding_model_provider"]))
    return item


def _apply_vector_index_state(
    item: DatasetDetailRecord,
    *,
    dataset: Dataset,
    session: Session,
) -> DatasetDetailRecord:
    state = get_dataset_vector_index_state(session, dataset=dataset)
    item["vector_indexing_status"] = state.status if state is not None else None
    item["vector_indexing_error"] = state.error if state is not None else None
    return item


def _status(document: Document, counts: tuple[int, int] | None = None) -> dict[str, Any]:
    result = {
        "id": document.id,
        "indexing_status": document.indexing_status,
        "processing_started_at": document.processing_started_at,
        "parsing_completed_at": document.parsing_completed_at,
        "cleaning_completed_at": document.cleaning_completed_at,
        "splitting_completed_at": document.splitting_completed_at,
        "completed_at": document.completed_at,
        "paused_at": document.paused_at,
        "error": document.error,
        "stopped_at": document.stopped_at,
    }
    if counts is not None:
        result.update(completed_segments=counts[0], total_segments=counts[1])
    return result


class SQLAlchemyDatasetOperations:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        tags: TagTargetQuery,
        app_queries: RelatedApps,
        members: MemberService,
        datasets: SQLAlchemyDatasetRepository,
    ) -> None:
        self._sessions = session_factory
        self._tags = tags
        self._app_queries = app_queries
        self._members_service = members
        self._datasets = datasets

    def visibility(self, context: RequestContext) -> DatasetVisibility:
        permissions = self._members_service.permissions(context.active_workspace_id, context.account_id)
        scope = (
            rbac_service.RBACService.DatasetAccess.whitelist_resources(context.active_workspace_id, context.account_id)
            if dify_config.RBAC_ENABLED
            else None
        )
        return DatasetVisibility(
            default_permissions=permissions.dataset.default_permission_keys,
            workspace_permissions=permissions.workspace.permission_keys,
            overrides={item.resource_id: item.permission_keys for item in permissions.dataset.overrides},
            unrestricted=scope is None or scope.unrestricted,
            whitelist_ids=scope.resource_ids if scope is not None else (),
        )

    def embedding_models(self, workspace_id: str) -> set[str]:
        manager = create_plugin_provider_manager(tenant_id=workspace_id)
        models = manager.get_configurations(tenant_id=workspace_id).get_models(
            model_type=ModelType.TEXT_EMBEDDING, only_active=True
        )
        return {f"{model.model}:{model.provider.provider}" for model in models}

    def list_datasets(
        self, context: RequestContext, query: DatasetListFilter, accessible_ids: list[str] | None, include_own: bool
    ) -> DatasetPage:
        page, limit = clamp_pagination(query.page, query.limit, 100)
        tag_target_ids = (
            self._tags.find_target_ids(
                tenant_id=context.active_workspace_id,
                tag_type="knowledge",
                tag_ids=list(query.tag_ids),
                match_all=True,
            )
            if query.tag_ids and not query.ids
            else None
        )
        with self._sessions() as session:
            actor_role = get_dataset_list_actor_role(
                session,
                tenant_id=context.active_workspace_id,
                actor_id=context.account_id,
            )
            if actor_role is None:
                raise DatasetAccessDeniedError()
            if query.ids:
                datasets, total = list_visible_datasets_by_ids(
                    session,
                    tenant_id=context.active_workspace_id,
                    dataset_ids=query.ids,
                    actor_id=context.account_id,
                    actor_role=actor_role,
                    rbac_enabled=dify_config.RBAC_ENABLED,
                    include_all=query.include_all,
                    accessible_dataset_ids=accessible_ids,
                    include_own_datasets=include_own,
                )
            else:
                datasets, total = list_visible_datasets(
                    session,
                    tenant_id=context.active_workspace_id,
                    actor_id=context.account_id,
                    actor_role=actor_role,
                    rbac_enabled=dify_config.RBAC_ENABLED,
                    include_all=query.include_all,
                    accessible_dataset_ids=accessible_ids,
                    include_own_datasets=include_own,
                    keyword=query.keyword,
                    tag_target_ids=tag_target_ids,
                    page=page,
                    per_page=limit,
                )
            data = load_dataset_details(datasets, session=session)
            partial_ids = [item["id"] for item in data if item["permission"] == "partial_members"]
            members = list_dataset_permission_member_ids(
                session,
                tenant_id=context.active_workspace_id,
                dataset_ids=partial_ids,
            )
            vector_states = get_dataset_vector_index_states(
                session,
                tenant_id=context.active_workspace_id,
                datasets=datasets,
            )
            for item in data:
                _normalize_provider(item)
                item["partial_member_list"] = list(members.get(item["id"], ()))
                vector_state = vector_states.get(item["id"])
                item["vector_indexing_status"] = vector_state.status if vector_state is not None else None
                item["vector_indexing_error"] = vector_state.error if vector_state is not None else None
            return {
                "data": data,
                "has_more": not query.ids and page * limit < total,
                "total": total,
                "page": page,
                "limit": limit,
            }

    def console_permission_keys(self, context: RequestContext, dataset_id: str) -> list[str]:
        permissions = self._members_service.resource_permissions(
            context.active_workspace_id,
            context.account_id,
            rbac_contracts.RBACResourceType.DATASET,
            [dataset_id],
        )
        return permissions.get(dataset_id, [])

    @staticmethod
    def initialize_creator_access(context: RequestContext, dataset_id: str) -> None:
        if not dify_config.RBAC_ENABLED:
            return
        rbac_service.RBACService.DatasetAccess.replace_whitelist(
            context.active_workspace_id,
            context.account_id,
            dataset_id,
            rbac_contracts.ReplaceMemberBindings(automatic_include_workspace_members=False),
        )
        rbac_service.sync_creator_access_policy_member_bindings(
            context.active_workspace_id,
            context.account_id,
            rbac_contracts.RBACResourceType.DATASET,
            dataset_id,
        )

    def get_dataset(self, context: RequestContext, ref: DatasetRef) -> DatasetDetailRecord:
        with self._sessions() as session:
            dataset = require_dataset(session, ref)
            result = load_dataset_detail(dataset, session=session)
            if dataset.permission == DatasetPermissionEnum.PARTIAL_TEAM:
                result["partial_member_list"] = self._members(session, ref)
            return _normalize_provider(_apply_vector_index_state(result, dataset=dataset, session=session))

    def next_rag_pipeline_dataset_name(self, tenant_id: str) -> str:
        return generate_incremental_name(self._datasets.list_names(tenant_id), "Untitled")

    def is_in_use(self, ref: DatasetRef) -> bool:
        with self._sessions() as session:
            require_dataset(session, ref)
            return bool(list_related_apps(session, tenant_id=ref.tenant_id, dataset_id=ref.dataset_id))

    def queries(self, ref: DatasetRef, *, page: int, limit: int) -> dict[str, Any]:
        page, limit = clamp_pagination(page, limit, 100)
        with self._sessions() as session:
            require_dataset(session, ref)
            queries, total = list_dataset_queries(
                session,
                tenant_id=ref.tenant_id,
                dataset_id=ref.dataset_id,
                page=page,
                per_page=limit,
            )
            data = [
                {
                    "id": query.id,
                    "queries": get_dataset_queries(query, session=session),
                    "source": query.source,
                    "source_app_id": query.source_app_id,
                    "created_by_role": query.created_by_role,
                    "created_by": query.created_by,
                    "created_at": query.created_at,
                }
                for query in queries
            ]
            return {"data": data, "has_more": page * limit < total, "total": total, "page": page, "limit": limit}

    def related_apps(self, ref: DatasetRef) -> dict[str, Any]:
        with self._sessions() as session:
            require_dataset(session, ref)
            joins = list_related_apps(session, tenant_id=ref.tenant_id, dataset_id=ref.dataset_id)
            app_ids = [join.app_id for join in joins]
        apps = self._app_queries.related_apps(ref.tenant_id, app_ids)
        return {"data": apps, "total": len(apps)}

    def indexing_status(self, ref: DatasetRef) -> dict[str, Any]:
        with self._sessions() as session:
            require_dataset(session, ref)
            documents = list_dataset_documents(session, tenant_id=ref.tenant_id, dataset_id=ref.dataset_id)
            counts = get_document_segment_counts(session, documents)
            return {"data": [_status(document, counts.get(document.id, (0, 0))) for document in documents]}

    def error_documents(self, ref: DatasetRef) -> dict[str, Any]:
        with self._sessions() as session:
            require_dataset(session, ref)
            documents = get_error_documents(session, tenant_id=ref.tenant_id, dataset_id=ref.dataset_id)
            return {"data": [_status(document) for document in documents], "total": len(documents)}

    @staticmethod
    def _members(session: Session, ref: DatasetRef) -> list[str]:
        members = list_dataset_permission_member_ids(
            session,
            tenant_id=ref.tenant_id,
            dataset_ids=(ref.dataset_id,),
        )
        return list(members.get(ref.dataset_id, ()))

    def partial_members(self, ref: DatasetRef) -> list[str]:
        with self._sessions() as session:
            require_dataset(session, ref)
            return self._members(session, ref)

    def auto_disable_logs(self, ref: DatasetRef) -> dict[str, Any]:
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return {"document_ids": [], "count": 0}
        features = FeatureService.get_features(ref.tenant_id, exclude_vector_space=True)
        if features.billing.subscription.plan == CloudPlan.SANDBOX:
            return {"document_ids": [], "count": 0}
        with self._sessions() as session:
            require_dataset(session, ref)
            document_ids = list_auto_disabled_document_ids(
                session,
                tenant_id=ref.tenant_id,
                dataset_id=ref.dataset_id,
                created_after=datetime.datetime.now() - datetime.timedelta(days=30),
            )
            return {"document_ids": document_ids, "count": len(document_ids)}
