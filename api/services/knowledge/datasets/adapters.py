"""Session-owning dataset administration adapters."""

from collections.abc import Generator, Mapping
from contextlib import contextmanager
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from graphon.model_runtime.entities.model_entities import ModelType
from libs.pagination import clamp_pagination
from machinery.context import RequestContext
from models import Account, ApiToken, App, Dataset, Document
from models.dataset import DatasetPermission, DatasetPermissionEnum
from models.enums import ApiTokenType
from models.provider_ids import ModelProviderID
from repositories.knowledge.dataset_repository import _get_dataset
from services import dataset_api_key_service
from services.api_token_service import ApiTokenCache
from services.enterprise import rbac_service
from services.errors.account import NoPermissionError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.dataset_read_service import get_dataset_queries, load_dataset_detail, load_dataset_details
from services.knowledge.dataset_service import DatasetPermissionService, DatasetService, DocumentService
from services.knowledge.datasets.application import (
    DatasetKeyLimitError,
    DatasetKeyNotFoundError,
    DatasetListFilter,
    DatasetVisibility,
)
from services.knowledge.resource_scope import DatasetRef
from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task


@contextmanager
def _translate_permissions() -> Generator[None, None, None]:
    try:
        yield
    except NoPermissionError as error:
        raise DatasetAccessDeniedError() from error


def require_dataset(session: Session, ref: DatasetRef) -> Dataset:
    dataset = _get_dataset(session, ref)
    if dataset is None:
        raise DatasetNotFoundError()
    return dataset


def load_actor(session: Session, context: RequestContext) -> Account:
    account = session.get(Account, context.account_id)
    if account is None:
        raise DatasetAccessDeniedError()
    account.set_tenant_id_with_session(context.active_workspace_id, session=session)
    return account


def _normalize_provider(item: dict[str, Any]) -> dict[str, Any]:
    if item["indexing_technique"] == "high_quality" and item["embedding_model_provider"]:
        item["embedding_model_provider"] = str(ModelProviderID(item["embedding_model_provider"]))
    return item


def _status(document: Document, counts: tuple[int, int] | None = None) -> dict[str, Any]:
    result = {
        name: getattr(document, name)
        for name in (
            "id",
            "indexing_status",
            "processing_started_at",
            "parsing_completed_at",
            "cleaning_completed_at",
            "splitting_completed_at",
            "completed_at",
            "paused_at",
            "error",
            "stopped_at",
        )
    }
    if counts is not None:
        result.update(completed_segments=counts[0], total_segments=counts[1])
    return result


def _key_values(key: ApiToken, dataset_ids: list[str]) -> dict[str, Any]:
    return {
        "id": key.id,
        "type": key.type,
        "token": key.token,
        "created_at": key.created_at,
        "last_used_at": key.last_used_at,
        "dataset_ids": dataset_ids,
    }


class SQLAlchemyDatasetOperations:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    def visibility(self, context: RequestContext) -> DatasetVisibility:
        with self._sessions() as session:
            permissions = rbac_service.RBACService.MyPermissions.get(
                context.active_workspace_id, context.account_id, session=session
            )
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
    ) -> dict[str, Any]:
        page, limit = clamp_pagination(query.page, query.limit, 100)
        with self._sessions() as session:
            account = load_actor(session, context)
            if query.ids:
                datasets, total = DatasetService.get_datasets_by_ids(
                    list(query.ids),
                    context.active_workspace_id,
                    user=account,
                    accessible_dataset_ids=accessible_ids,
                    include_own_datasets=include_own,
                    session=session,
                )
            else:
                datasets, total = DatasetService.get_datasets(
                    page,
                    limit,
                    session,
                    context.active_workspace_id,
                    account,
                    query.keyword,
                    list(query.tag_ids),
                    query.include_all,
                    accessible_dataset_ids=accessible_ids,
                    include_own_datasets=include_own,
                )
            data = load_dataset_details(datasets, session=session)
            partial_ids = [item["id"] for item in data if item["permission"] == "partial_members"]
            members: dict[str, list[str]] = {}
            if partial_ids:
                for dataset_id, account_id in session.execute(
                    select(DatasetPermission.dataset_id, DatasetPermission.account_id).where(
                        DatasetPermission.dataset_id.in_(partial_ids),
                        DatasetPermission.tenant_id == context.active_workspace_id,
                    )
                ):
                    members.setdefault(dataset_id, []).append(account_id)
            for item in data:
                _normalize_provider(item)
                item["partial_member_list"] = members.get(item["id"], [])
            return {
                "data": data,
                "has_more": not query.ids and page * limit < total,
                "total": total,
                "page": page,
                "limit": limit,
            }

    @staticmethod
    def _detail(session: Session, context: RequestContext, dataset: Dataset) -> dict[str, Any]:
        result = load_dataset_detail(dataset, session=session)
        permissions = rbac_service.RBACService.DatasetPermissions.batch_get(
            context.active_workspace_id, context.account_id, [dataset.id], session=session
        )
        result["permission_keys"] = permissions.get(dataset.id, [])
        return result

    def get_dataset(self, context: RequestContext, ref: DatasetRef) -> dict[str, Any]:
        with self._sessions() as session:
            dataset = require_dataset(session, ref)
            result = load_dataset_detail(dataset, session=session)
            permissions = rbac_service.RBACService.MyPermissions.get(
                context.active_workspace_id, context.account_id, dataset_id=ref.dataset_id, session=session
            )
            result["permission_keys"] = permissions.dataset.permission_keys_by_resource_ids([dataset.id]).get(
                dataset.id, []
            )
            if dataset.permission == DatasetPermissionEnum.PARTIAL_TEAM:
                result["partial_member_list"] = self._members(session, ref)
            return _normalize_provider(result)

    def create_dataset(self, context: RequestContext, values: Mapping[str, Any]) -> dict[str, Any]:
        with _translate_permissions(), self._sessions() as session:
            dataset = DatasetService.create_empty_dataset(
                session=session,
                tenant_id=context.active_workspace_id,
                account=load_actor(session, context),
                **dict(values),
            )
            result = self._detail(session, context, dataset)
            result["partial_member_list"] = None
            dataset_id = dataset.id
            session.commit()
        if dify_config.RBAC_ENABLED:
            rbac_service.RBACService.DatasetAccess.replace_whitelist(
                context.active_workspace_id,
                context.account_id,
                dataset_id,
                rbac_service.ReplaceMemberBindings(automatic_include_workspace_members=True),
            )
            initialize_created_app_rbac_access_task.delay(
                context.active_workspace_id, context.account_id, dataset_id=dataset_id
            )
        return result

    def update_dataset(self, context: RequestContext, ref: DatasetRef, values: Mapping[str, Any]) -> dict[str, Any]:
        data = dict(values)
        if (
            data.get("indexing_technique") == "high_quality"
            and data.get("embedding_model_provider") is not None
            and data.get("embedding_model") is not None
        ):
            data["is_multimodal"] = DatasetService.check_is_multimodal_model(
                ref.tenant_id, data["embedding_model_provider"], data["embedding_model"]
            )
        with _translate_permissions(), self._sessions() as session:
            dataset = require_dataset(session, ref)
            account = load_actor(session, context)
            if not dify_config.RBAC_ENABLED:
                DatasetPermissionService.check_permission(
                    account, dataset, data.get("permission"), data.get("partial_member_list"), session=session
                )
            # The legacy updater consumes fields from its input; retain the
            # member selection for the permission update in this transaction.
            dataset = DatasetService.update_dataset(ref.dataset_id, dict(data), account, session=session)
            if dataset is None:
                raise DatasetNotFoundError()
            result = self._detail(session, context, dataset)
            if (
                data.get("partial_member_list") is not None
                and data.get("permission") == DatasetPermissionEnum.PARTIAL_TEAM
            ):
                DatasetPermissionService.update_partial_member_list(
                    ref.tenant_id, ref.dataset_id, data["partial_member_list"], session
                )
            elif data.get("permission") in {DatasetPermissionEnum.ONLY_ME, DatasetPermissionEnum.ALL_TEAM}:
                DatasetPermissionService.clear_partial_member_list(ref.dataset_id, session)
            result["partial_member_list"] = self._members(session, ref)
            session.commit()
            return result

    def delete_dataset(self, context: RequestContext, ref: DatasetRef) -> None:
        with _translate_permissions(), self._sessions() as session:
            require_dataset(session, ref)
            if not DatasetService.delete_dataset(ref.dataset_id, load_actor(session, context), session):
                raise DatasetNotFoundError()
            DatasetPermissionService.clear_partial_member_list(ref.dataset_id, session)
            session.commit()

    def is_in_use(self, ref: DatasetRef) -> bool:
        with self._sessions() as session:
            require_dataset(session, ref)
            return DatasetService.dataset_use_check(ref, session)

    def queries(self, ref: DatasetRef, *, page: int, limit: int) -> dict[str, Any]:
        page, limit = clamp_pagination(page, limit, 100)
        with self._sessions() as session:
            require_dataset(session, ref)
            queries, total = DatasetService.get_dataset_queries(
                dataset_id=ref.dataset_id, page=page, per_page=limit, session=session
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
            joins = DatasetService.get_related_apps(ref.dataset_id, session)
            apps = session.scalars(
                select(App).where(App.id.in_([join.app_id for join in joins]), App.tenant_id == ref.tenant_id)
            ).all()
            values = [
                {
                    **{
                        key: getattr(app, key)
                        for key in ("id", "name", "description", "icon_type", "icon", "icon_background")
                    },
                    "mode_compatible_with_agent": app.mode_compatible_with_agent_with_session(session=session),
                }
                for app in apps
            ]
            return {"data": values, "total": len(values)}

    def indexing_status(self, ref: DatasetRef) -> dict[str, Any]:
        with self._sessions() as session:
            require_dataset(session, ref)
            documents = session.scalars(
                select(Document).where(Document.dataset_id == ref.dataset_id, Document.tenant_id == ref.tenant_id)
            ).all()
            counts = DocumentService.get_document_segment_counts(documents, session=session)
            return {"data": [_status(document, counts.get(document.id, (0, 0))) for document in documents]}

    def error_documents(self, ref: DatasetRef) -> dict[str, Any]:
        with self._sessions() as session:
            require_dataset(session, ref)
            documents = DocumentService.get_error_documents_by_dataset_ref(ref, session)
            return {"data": [_status(document) for document in documents], "total": len(documents)}

    @staticmethod
    def _members(session: Session, ref: DatasetRef) -> list[str]:
        return list(
            session.scalars(
                select(DatasetPermission.account_id).where(
                    DatasetPermission.dataset_id == ref.dataset_id, DatasetPermission.tenant_id == ref.tenant_id
                )
            ).all()
        )

    def partial_members(self, ref: DatasetRef) -> list[str]:
        with self._sessions() as session:
            require_dataset(session, ref)
            return self._members(session, ref)

    def auto_disable_logs(self, ref: DatasetRef) -> dict[str, Any]:
        with self._sessions() as session:
            return dict(DatasetService.get_dataset_auto_disable_logs(ref, session))

    def set_api_enabled(self, context: RequestContext, ref: DatasetRef, enabled: bool) -> None:
        with self._sessions() as session:
            DatasetService.update_dataset_api_status(
                require_dataset(session, ref), enabled, load_actor(session, context), session
            )
            session.commit()

    def list_keys(self, workspace_id: str) -> list[dict[str, Any]]:
        with self._sessions() as session:
            keys = session.scalars(
                select(ApiToken).where(ApiToken.type == ApiTokenType.DATASET, ApiToken.tenant_id == workspace_id)
            ).all()
            bindings = dataset_api_key_service.list_bindings_by_token(session, [key.id for key in keys])
            return [_key_values(key, bindings.get(key.id, [])) for key in keys]

    def create_key(self, workspace_id: str, dataset_ids: list[str], *, max_keys: int) -> dict[str, Any]:
        with self._sessions.begin() as session:
            unknown = dataset_api_key_service.find_unknown_dataset_ids(session, dataset_ids, workspace_id)
            if unknown:
                raise ValueError(f"Unknown knowledge base id(s): {', '.join(unknown)}")
            count = (
                session.scalar(
                    select(func.count(ApiToken.id)).where(
                        ApiToken.type == ApiTokenType.DATASET, ApiToken.tenant_id == workspace_id
                    )
                )
                or 0
            )
            if count >= max_keys:
                raise DatasetKeyLimitError(f"Cannot create more than {max_keys} API keys for this resource type.")
            key = ApiToken(
                tenant_id=workspace_id,
                type=ApiTokenType.DATASET,
                token=ApiToken.generate_api_key("dataset-", 24, session=session),
            )
            session.add(key)
            session.flush()
            dataset_api_key_service.bind_datasets(session, key.id, dataset_ids)
            return _key_values(key, dataset_ids)

    def delete_key(self, workspace_id: str, key_id: str) -> None:
        with self._sessions() as session:
            key = session.scalar(
                select(ApiToken).where(
                    ApiToken.tenant_id == workspace_id, ApiToken.type == ApiTokenType.DATASET, ApiToken.id == key_id
                )
            )
            if key is None:
                raise DatasetKeyNotFoundError("API key not found")
            token = key.token
        # Revoke cache before deletion as required by the token consistency contract,
        # but release the read transaction before accessing Redis.
        ApiTokenCache.delete(token, ApiTokenType.DATASET)
        with self._sessions.begin() as session:
            key = session.scalar(
                select(ApiToken).where(
                    ApiToken.tenant_id == workspace_id, ApiToken.type == ApiTokenType.DATASET, ApiToken.id == key_id
                )
            )
            if key is not None:
                session.delete(key)
