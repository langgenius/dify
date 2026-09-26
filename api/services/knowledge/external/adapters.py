"""External knowledge persistence and network adapters with bounded sessions."""

from collections.abc import Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.entities import MetadataFilteringCondition
from libs.pagination import clamp_pagination
from machinery.context import RequestContext
from models.dataset import DatasetQuery, ExternalKnowledgeApis
from models.enums import CreatorUserRole, DatasetQuerySource
from repositories.knowledge.dataset_read_repository import (
    get_external_api_bindings_batch,
    get_external_api_dataset_bindings,
)
from services.enterprise import rbac_service
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalDatasetCreatePayload
from services.hit_testing_service import HitTestingService
from services.knowledge.dataset_read_service import load_dataset_detail
from services.knowledge.datasets.adapters import require_dataset
from services.knowledge.external.application import ExternalTemplateNotFoundError
from services.knowledge.external.service import ExternalDatasetService
from services.knowledge.resource_scope import DatasetRef


class SQLAlchemyExternalKnowledgeOperations:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    @staticmethod
    def _template(session: Session, workspace_id: str, template_id: str) -> ExternalKnowledgeApis:
        template = session.scalar(
            select(ExternalKnowledgeApis).where(
                ExternalKnowledgeApis.id == template_id, ExternalKnowledgeApis.tenant_id == workspace_id
            )
        )
        if template is None:
            raise ExternalTemplateNotFoundError("API template not found.")
        return template

    @staticmethod
    def _values(session: Session, template: ExternalKnowledgeApis) -> dict[str, Any]:
        return dict(template.to_dict(dataset_bindings=get_external_api_dataset_bindings(template, session=session)))

    def list_templates(self, workspace_id: str, *, page: int, limit: int, keyword: str | None) -> dict[str, Any]:
        page, limit = clamp_pagination(page, limit, 100)
        with self._sessions() as session:
            templates, total = ExternalDatasetService.get_external_knowledge_apis(
                page, limit, workspace_id, keyword, session=session
            )
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
        # The legacy creator probes the endpoint before its first SQL statement.
        # An unopened session keeps that external request outside a transaction.
        with self._sessions() as session:
            template = ExternalDatasetService.create_external_knowledge_api(
                context.active_workspace_id,
                context.account_id,
                {"name": name, "settings": dict(settings)},
                session=session,
            )
            result = self._values(session, template)
            session.commit()
            return result

    def update_template(
        self, context: RequestContext, template_id: str, *, name: str, settings: Mapping[str, Any]
    ) -> dict[str, Any]:
        with self._sessions.begin() as session:
            self._template(session, context.active_workspace_id, template_id)
            template = ExternalDatasetService.update_external_knowledge_api(
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
            return ExternalDatasetService.external_knowledge_api_use_check(template_id, workspace_id, session=session)

    def create_dataset(self, context: RequestContext, payload: ExternalDatasetCreatePayload) -> dict[str, Any]:
        with self._sessions() as session:
            self._template(session, context.active_workspace_id, payload.external_knowledge_api_id)
            dataset = ExternalDatasetService.create_external_dataset(
                context.active_workspace_id, context.account_id, payload, session=session
            )
            permissions = rbac_service.RBACService.DatasetPermissions.batch_get(
                context.active_workspace_id, context.account_id, [dataset.id], session=session
            )
            result = load_dataset_detail(dataset, session=session)
            result["permission_keys"] = permissions.get(dataset.id, [])
            session.commit()
            return result

    def retrieve(
        self,
        context: RequestContext,
        ref: DatasetRef,
        *,
        query: str,
        retrieval_model: dict[str, Any] | None,
        metadata_filters: dict[str, Any] | None,
    ) -> dict[str, Any]:
        with self._sessions() as session:
            dataset = require_dataset(session, ref)
            if dataset.provider != "external":
                return {"query": {"content": query}, "records": []}
            request = ExternalDatasetService.prepare_external_knowledge_retrieval(
                tenant_id=ref.tenant_id,
                dataset_id=ref.dataset_id,
                query=HitTestingService.escape_query_for_search(query),
                external_retrieval_parameters=retrieval_model or {},
                metadata_condition=MetadataFilteringCondition.model_validate(metadata_filters)
                if metadata_filters
                else None,
                session=session,
            )
        documents = ExternalDatasetService.execute_external_knowledge_retrieval(request)
        with self._sessions.begin() as session:
            require_dataset(session, ref)
            session.add(
                DatasetQuery(
                    dataset_id=ref.dataset_id,
                    content=query,
                    source=DatasetQuerySource.HIT_TESTING,
                    source_app_id=None,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=context.account_id,
                )
            )
        return dict(HitTestingService.compact_external_retrieve_response(dataset, query, documents))
