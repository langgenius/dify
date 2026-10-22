"""External knowledge persistence with tenant-scoped, bounded sessions."""

import json
from collections.abc import Mapping
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from constants import HIDDEN_VALUE
from core.rag.entities import MetadataFilteringCondition
from libs.datetime_utils import naive_utc_now
from libs.pagination import clamp_pagination, paginate_query
from machinery.context import RequestContext
from models.dataset import Dataset, ExternalKnowledgeApis, ExternalKnowledgeBindings
from repositories.knowledge.dataset_read_repository import (
    get_external_api_bindings_batch,
    get_external_api_dataset_bindings,
)
from repositories.knowledge.dataset_repository import _get_dataset
from services.errors.dataset import DatasetNameDuplicateError, DatasetNotFoundError
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError, ExternalTemplateNotFoundError
from services.knowledge.entities.external import ExternalDatasetCreatePayload, ExternalKnowledgeRetrievalRequest
from services.knowledge.entities.resource_scope import DatasetRef


def get_external_knowledge_apis(
    page, per_page, tenant_id, search=None, *, session: Session
) -> tuple[list[ExternalKnowledgeApis], int]:
    query = (
        select(ExternalKnowledgeApis)
        .where(ExternalKnowledgeApis.tenant_id == tenant_id)
        .order_by(ExternalKnowledgeApis.created_at.desc())
    )
    if search:
        from libs.helper import escape_like_pattern

        escaped_search = escape_like_pattern(search)
        query = query.where(ExternalKnowledgeApis.name.ilike(f"%{escaped_search}%", escape="\\"))

    external_knowledge_apis = paginate_query(query, session=session, page=page, per_page=per_page, max_per_page=100)

    return external_knowledge_apis.items, external_knowledge_apis.total


def get_external_knowledge_api(
    external_knowledge_api_id: str, tenant_id: str, *, session: Session
) -> ExternalKnowledgeApis:
    external_knowledge_api: ExternalKnowledgeApis | None = session.scalar(
        select(ExternalKnowledgeApis)
        .where(ExternalKnowledgeApis.id == external_knowledge_api_id, ExternalKnowledgeApis.tenant_id == tenant_id)
        .limit(1)
    )
    if external_knowledge_api is None:
        raise ExternalTemplateNotFoundError("api template not found")
    return external_knowledge_api


def update_external_knowledge_api(
    tenant_id: str,
    user_id: str,
    external_knowledge_api_id: str,
    args: dict[str, Any],
    *,
    session: Session,
) -> ExternalKnowledgeApis:
    external_knowledge_api = get_external_knowledge_api(external_knowledge_api_id, tenant_id, session=session)
    settings = args.get("settings")
    if settings and settings.get("api_key") == HIDDEN_VALUE and external_knowledge_api.settings_dict:
        settings["api_key"] = external_knowledge_api.settings_dict.get("api_key")

    external_knowledge_api.name = str(args.get("name"))
    external_knowledge_api.description = str(args.get("description", ""))
    external_knowledge_api.settings = json.dumps(settings, ensure_ascii=False)
    external_knowledge_api.updated_by = user_id
    external_knowledge_api.updated_at = naive_utc_now()
    session.flush()

    return external_knowledge_api


def external_knowledge_api_use_check(
    external_knowledge_api_id: str, tenant_id: str, *, session: Session
) -> tuple[bool, int]:
    """
    Return usage for an external knowledge API within a single tenant.

    The caller already scopes access by tenant, so this query must do the
    same; otherwise the endpoint becomes a cross-tenant UUID oracle.
    """
    count = (
        session.scalar(
            select(func.count(ExternalKnowledgeBindings.id)).where(
                ExternalKnowledgeBindings.external_knowledge_api_id == external_knowledge_api_id,
                ExternalKnowledgeBindings.tenant_id == tenant_id,
            )
        )
        or 0
    )
    return count > 0, count


def get_external_knowledge_binding_with_dataset_id(
    tenant_id: str, dataset_id: str, *, session: Session
) -> ExternalKnowledgeBindings:
    external_knowledge_binding: ExternalKnowledgeBindings | None = session.scalar(
        select(ExternalKnowledgeBindings)
        .where(ExternalKnowledgeBindings.dataset_id == dataset_id, ExternalKnowledgeBindings.tenant_id == tenant_id)
        .limit(1)
    )
    if not external_knowledge_binding:
        raise ValueError("external knowledge binding not found")
    return external_knowledge_binding


def create_external_dataset(
    tenant_id: str, user_id: str, args: ExternalDatasetCreatePayload, *, session: Session
) -> Dataset:
    """Create a tenant-scoped external dataset and binding in the caller's transaction."""
    # check if dataset name already exists
    if session.scalar(select(Dataset).where(Dataset.name == args.name, Dataset.tenant_id == tenant_id).limit(1)):
        raise DatasetNameDuplicateError(f"Dataset with name {args.name} already exists.")
    get_external_knowledge_api(args.external_knowledge_api_id, tenant_id, session=session)

    dataset = Dataset(
        tenant_id=tenant_id,
        name=args.name,
        description=args.description or "",
        provider="external",
        retrieval_model=args.external_retrieval_model,
        created_by=user_id,
        maintainer=user_id,
    )

    session.add(dataset)
    session.flush()

    external_knowledge_binding = ExternalKnowledgeBindings(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        external_knowledge_api_id=args.external_knowledge_api_id or "",
        external_knowledge_id=args.external_knowledge_id or "",
        created_by=user_id,
    )
    session.add(external_knowledge_binding)

    return dataset


def load_external_knowledge_retrieval_request(
    tenant_id: str,
    dataset_id: str,
    query: str,
    external_retrieval_parameters: dict[str, Any],
    metadata_condition: MetadataFilteringCondition | None = None,
    *,
    session: Session,
) -> ExternalKnowledgeRetrievalRequest:
    """Materialize tenant-owned retrieval configuration before releasing the session."""
    try:
        binding = get_external_knowledge_binding_with_dataset_id(tenant_id, dataset_id, session=session)
    except ValueError as error:
        raise ExternalKnowledgeRetrievalError("external knowledge binding not found") from error
    try:
        template = get_external_knowledge_api(binding.external_knowledge_api_id, tenant_id, session=session)
    except ExternalTemplateNotFoundError as error:
        raise ExternalKnowledgeRetrievalError("external api template not found") from error
    if template.settings is None:
        raise ExternalKnowledgeRetrievalError("external api template not found")
    settings = json.loads(template.settings)
    return ExternalKnowledgeRetrievalRequest(
        endpoint=str(settings.get("endpoint")),
        api_key=str(settings["api_key"]) if settings.get("api_key") else None,
        knowledge_id=binding.external_knowledge_id,
        query=query,
        retrieval_model=dict(external_retrieval_parameters),
        metadata_filters=metadata_condition.model_dump() if metadata_condition else None,
    )


class SQLAlchemyExternalKnowledgeRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    @staticmethod
    def require_template(tenant_id: str, template_id: str, *, session: Session) -> None:
        """Read within an existing dataset transaction, including uncommitted templates."""
        get_external_knowledge_api(template_id, tenant_id, session=session)

    @staticmethod
    def _template(session: Session, workspace_id: str, template_id: str) -> ExternalKnowledgeApis:
        return get_external_knowledge_api(template_id, workspace_id, session=session)

    @staticmethod
    def _values(session: Session, template: ExternalKnowledgeApis) -> dict[str, Any]:
        return dict(template.to_dict(dataset_bindings=get_external_api_dataset_bindings(template, session=session)))

    def list_templates(self, workspace_id: str, *, page: int, limit: int, keyword: str | None) -> dict[str, Any]:
        page, limit = clamp_pagination(page, limit, 100)
        with self._sessions() as session:
            templates, total = get_external_knowledge_apis(page, limit, workspace_id, keyword, session=session)
            bindings = get_external_api_bindings_batch(templates, session=session)
            return {
                "data": [item.to_dict(dataset_bindings=bindings.get(item.id, [])) for item in templates],
                "has_more": page * limit < total,
                "total": total,
                "page": page,
                "limit": limit,
            }

    def get_template(self, workspace_id: str, template_id: str) -> dict[str, Any]:
        with self._sessions() as session:
            return self._values(session, self._template(session, workspace_id, template_id))

    def create_template(self, context: RequestContext, *, name: str, settings: Mapping[str, Any]) -> dict[str, Any]:
        with self._sessions.begin() as session:
            template = ExternalKnowledgeApis(
                tenant_id=context.active_workspace_id,
                created_by=context.account_id,
                updated_by=context.account_id,
                name=name,
                description="",
                settings=json.dumps(dict(settings), ensure_ascii=False),
            )
            session.add(template)
            session.flush()
            return self._values(session, template)

    def update_template(
        self, context: RequestContext, template_id: str, *, name: str, settings: Mapping[str, Any]
    ) -> dict[str, Any]:
        with self._sessions.begin() as session:
            template = update_external_knowledge_api(
                context.active_workspace_id,
                context.account_id,
                template_id,
                {"name": name, "settings": dict(settings)},
                session=session,
            )
            return self._values(session, template)

    def delete_template(self, workspace_id: str, template_id: str) -> None:
        with self._sessions.begin() as session:
            session.delete(self._template(session, workspace_id, template_id))

    def template_usage(self, workspace_id: str, template_id: str) -> tuple[bool, int]:
        with self._sessions() as session:
            return external_knowledge_api_use_check(template_id, workspace_id, session=session)

    def create_dataset(self, context: RequestContext, payload: ExternalDatasetCreatePayload) -> DatasetRef:
        with self._sessions.begin() as session:
            dataset = create_external_dataset(context.active_workspace_id, context.account_id, payload, session=session)
            return DatasetRef(dataset.tenant_id, dataset.id)

    def prepare_retrieval(
        self,
        ref: DatasetRef,
        *,
        query: str,
        retrieval_model: dict[str, Any] | None,
        metadata_filters: dict[str, Any] | None,
    ) -> ExternalKnowledgeRetrievalRequest | None:
        with self._sessions() as session:
            dataset = _get_dataset(session, ref)
            if dataset is None:
                raise DatasetNotFoundError()
            if dataset.provider != "external":
                return None
            return load_external_knowledge_retrieval_request(
                tenant_id=ref.tenant_id,
                dataset_id=ref.dataset_id,
                query=query,
                external_retrieval_parameters=retrieval_model or {},
                metadata_condition=MetadataFilteringCondition.model_validate(metadata_filters)
                if metadata_filters
                else None,
                session=session,
            )
