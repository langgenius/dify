"""SQLAlchemy persistence for tenant-owned external knowledge configuration."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session, sessionmaker

from constants import HIDDEN_VALUE
from libs.datetime_utils import naive_utc_now
from libs.helper import escape_like_pattern
from libs.pagination import clamp_pagination, paginate_query
from models.dataset import Dataset, DatasetBindingItem, ExternalKnowledgeApis, ExternalKnowledgeBindings
from services.errors.dataset import DatasetNameDuplicateError
from services.errors.knowledge_retrieval import (
    ExternalKnowledgeRetrievalError,
    ExternalTemplateConcurrentUpdateError,
    ExternalTemplateNotFoundError,
)
from services.knowledge.dataset_access import DatasetNotFoundError
from services.knowledge.entities.external import ExternalKnowledgeRetrievalRequest, ExternalRetrievalConfig
from services.knowledge.entities.metadata import MetadataFilteringCondition
from services.knowledge.entities.resource_scope import DatasetRef


class SQLAlchemyExternalKnowledgeRepository:
    """Own sessions and transactions for external knowledge persistence."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    @staticmethod
    def _template(
        session: Session,
        *,
        tenant_id: str,
        template_id: str,
        for_update: bool = False,
    ) -> ExternalKnowledgeApis | None:
        statement = (
            select(ExternalKnowledgeApis)
            .where(ExternalKnowledgeApis.id == template_id, ExternalKnowledgeApis.tenant_id == tenant_id)
            .limit(1)
        )
        if for_update:
            statement = statement.with_for_update()
        return session.scalar(statement)

    @staticmethod
    def _template_bindings(
        session: Session, templates: Sequence[ExternalKnowledgeApis]
    ) -> dict[str, list[DatasetBindingItem]]:
        if not templates:
            return {}
        allowed = {(template.id, template.tenant_id) for template in templates}
        rows = session.execute(
            select(
                ExternalKnowledgeBindings.external_knowledge_api_id,
                ExternalKnowledgeBindings.tenant_id,
                Dataset.id,
                Dataset.name,
            )
            .join(Dataset, Dataset.id == ExternalKnowledgeBindings.dataset_id)
            .where(
                tuple_(ExternalKnowledgeBindings.external_knowledge_api_id, ExternalKnowledgeBindings.tenant_id).in_(
                    allowed
                ),
                Dataset.tenant_id == ExternalKnowledgeBindings.tenant_id,
            )
            .distinct()
        ).all()
        bindings: dict[str, list[DatasetBindingItem]] = {}
        for template_id, tenant_id, dataset_id, name in rows:
            if (template_id, tenant_id) in allowed:
                bindings.setdefault(template_id, []).append({"id": dataset_id, "name": name})
        return bindings

    @classmethod
    def _template_values(cls, session: Session, template: ExternalKnowledgeApis) -> dict[str, Any]:
        bindings = cls._template_bindings(session, [template]).get(template.id, [])
        return dict(template.to_dict(dataset_bindings=bindings))

    def list_templates(self, tenant_id: str, *, page: int, limit: int, keyword: str | None) -> dict[str, Any]:
        page, limit = clamp_pagination(page, limit, 100)
        statement = (
            select(ExternalKnowledgeApis)
            .where(ExternalKnowledgeApis.tenant_id == tenant_id)
            .order_by(ExternalKnowledgeApis.created_at.desc())
        )
        if keyword:
            escaped_search = escape_like_pattern(keyword)
            statement = statement.where(ExternalKnowledgeApis.name.ilike(f"%{escaped_search}%", escape="\\"))
        with self._sessions() as session:
            result = paginate_query(statement, session=session, page=page, per_page=limit, max_per_page=100)
            bindings = self._template_bindings(session, result.items)
            return {
                "data": [item.to_dict(dataset_bindings=bindings.get(item.id, [])) for item in result.items],
                "has_more": page * limit < result.total,
                "total": result.total,
                "page": page,
                "limit": limit,
            }

    def get_template(self, tenant_id: str, template_id: str) -> dict[str, Any] | None:
        with self._sessions() as session:
            template = self._template(session, tenant_id=tenant_id, template_id=template_id)
            return self._template_values(session, template) if template is not None else None

    def create_template(
        self,
        *,
        tenant_id: str,
        user_id: str,
        name: str,
        settings: Mapping[str, Any],
    ) -> dict[str, Any]:
        with self._sessions.begin() as session:
            template = ExternalKnowledgeApis(
                tenant_id=tenant_id,
                created_by=user_id,
                updated_by=user_id,
                name=name,
                description="",
                settings=json.dumps(settings, ensure_ascii=False),
            )
            session.add(template)
            session.flush()
            return self._template_values(session, template)

    def update_template(
        self,
        *,
        tenant_id: str,
        template_id: str,
        user_id: str,
        name: str,
        settings: Mapping[str, Any],
        expected_api_key: str | None,
    ) -> dict[str, Any]:
        with self._sessions.begin() as session:
            template = self._template(
                session,
                tenant_id=tenant_id,
                template_id=template_id,
                for_update=True,
            )
            if template is None:
                raise ExternalTemplateNotFoundError("API template not found.")
            current_settings = template.settings_dict
            if expected_api_key is not None:
                current_api_key = current_settings.get("api_key") if current_settings else None
                if current_api_key != expected_api_key:
                    raise ExternalTemplateConcurrentUpdateError(
                        "API template credentials changed while the update was being validated. Please retry."
                    )

            persisted_settings = dict(settings)
            if persisted_settings.get("api_key") == HIDDEN_VALUE:
                if not current_settings or not isinstance(current_settings.get("api_key"), str):
                    raise ValueError("api_key is required")
                persisted_settings["api_key"] = current_settings["api_key"]
            template.name = name
            template.description = ""
            template.settings = json.dumps(persisted_settings, ensure_ascii=False)
            template.updated_by = user_id
            template.updated_at = naive_utc_now()
            session.flush()
            return self._template_values(session, template)

    def delete_template(self, tenant_id: str, template_id: str) -> None:
        with self._sessions.begin() as session:
            template = self._template(session, tenant_id=tenant_id, template_id=template_id, for_update=True)
            if template is None:
                raise ExternalTemplateNotFoundError("API template not found.")
            session.delete(template)

    def template_usage(self, tenant_id: str, template_id: str) -> tuple[bool, int]:
        with self._sessions() as session:
            count = (
                session.scalar(
                    select(func.count(ExternalKnowledgeBindings.id)).where(
                        ExternalKnowledgeBindings.external_knowledge_api_id == template_id,
                        ExternalKnowledgeBindings.tenant_id == tenant_id,
                    )
                )
                or 0
            )
            return count > 0, count

    def create_dataset(
        self,
        *,
        tenant_id: str,
        user_id: str,
        name: str,
        description: str,
        retrieval_model: Mapping[str, Any] | None,
        template_id: str,
        external_knowledge_id: str,
    ) -> DatasetRef:
        with self._sessions.begin() as session:
            if (
                session.scalar(select(Dataset.id).where(Dataset.name == name, Dataset.tenant_id == tenant_id).limit(1))
                is not None
            ):
                raise DatasetNameDuplicateError(f"Dataset with name {name} already exists.")
            if self._template(session, tenant_id=tenant_id, template_id=template_id) is None:
                raise ExternalTemplateNotFoundError("API template not found.")
            dataset = Dataset(
                tenant_id=tenant_id,
                name=name,
                description=description,
                provider="external",
                retrieval_model=dict(retrieval_model) if retrieval_model is not None else None,
                created_by=user_id,
                maintainer=user_id,
            )
            session.add(dataset)
            session.flush()
            session.add(
                ExternalKnowledgeBindings(
                    tenant_id=tenant_id,
                    dataset_id=dataset.id,
                    external_knowledge_api_id=template_id,
                    external_knowledge_id=external_knowledge_id,
                    created_by=user_id,
                )
            )
            return DatasetRef(dataset.tenant_id, dataset.id)

    def get_retrieval_request(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        query: str,
        retrieval_model: ExternalRetrievalConfig | None,
        metadata_filters: MetadataFilteringCondition | None,
    ) -> ExternalKnowledgeRetrievalRequest | None:
        """Load provider configuration without constructing an HTTP request."""

        with self._sessions() as session:
            dataset = session.scalar(
                select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id).limit(1)
            )
            if dataset is None:
                raise DatasetNotFoundError()
            if dataset.provider != "external":
                return None
            binding = session.scalar(
                select(ExternalKnowledgeBindings)
                .where(
                    ExternalKnowledgeBindings.dataset_id == dataset_id,
                    ExternalKnowledgeBindings.tenant_id == tenant_id,
                )
                .limit(1)
            )
            if binding is None:
                raise ExternalKnowledgeRetrievalError("external knowledge configuration not found")
            template = self._template(
                session,
                tenant_id=tenant_id,
                template_id=binding.external_knowledge_api_id,
            )
            settings = template.settings_dict if template is not None else None
            if not settings:
                raise ExternalKnowledgeRetrievalError("external knowledge configuration not found")
            endpoint = settings.get("endpoint")
            api_key = settings.get("api_key")
            if not isinstance(endpoint, str) or not endpoint:
                raise ExternalKnowledgeRetrievalError("external knowledge configuration not found")
            if api_key is not None and not isinstance(api_key, str):
                raise ExternalKnowledgeRetrievalError("external knowledge configuration not found")
            parameters = (
                retrieval_model
                or ExternalRetrievalConfig.from_mapping(dataset.external_retrieval_model)
                or ExternalRetrievalConfig()
            )
            return ExternalKnowledgeRetrievalRequest(
                endpoint=endpoint,
                api_key=api_key,
                knowledge_id=binding.external_knowledge_id,
                query=query,
                retrieval_model=parameters,
                metadata_filters=metadata_filters,
            )
