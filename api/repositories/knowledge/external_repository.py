"""SQLAlchemy persistence for tenant-owned external knowledge configuration."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from json import JSONDecodeError
from typing import Any, Literal

from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session, sessionmaker

from constants import HIDDEN_VALUE
from core.rag.entities import MetadataFilteringCondition
from libs.datetime_utils import naive_utc_now
from libs.helper import escape_like_pattern
from libs.pagination import clamp_pagination, paginate_query
from models.dataset import (
    Dataset,
    DatasetBindingItem,
    ExternalKnowledgeApiDict,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
)


class ExternalTemplateNotFoundError(Exception):
    """The requested tenant-owned external knowledge template does not exist."""


class ExternalDatasetNameConflictError(Exception):
    """An external dataset command conflicts with an existing tenant-owned name."""


@dataclass(frozen=True)
class ExternalTemplateSnapshot:
    """Detached result returned after an external template command commits."""

    id: str
    tenant_id: str
    name: str
    description: str
    settings: str | None
    dataset_bindings: tuple[DatasetBindingItem, ...]
    created_by: str
    created_at: datetime
    updated_by: str | None
    updated_at: datetime

    def to_dict(self) -> ExternalKnowledgeApiDict:
        try:
            settings = json.loads(self.settings) if self.settings else None
        except JSONDecodeError:
            settings = None
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "name": self.name,
            "description": self.description,
            "settings": settings,
            "dataset_bindings": list(self.dataset_bindings),
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat(),
        }


@dataclass(frozen=True)
class ExternalDatasetSnapshot:
    """Detached identity and response fields for a committed external dataset."""

    id: str
    tenant_id: str
    name: str
    description: str
    provider: str
    created_by: str


class SQLAlchemyExternalKnowledgeRepository:
    """Persist external templates, bindings, and their external datasets."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_templates(
        self, *, tenant_id: str, page: int, per_page: int, search: str | None = None
    ) -> tuple[list[ExternalKnowledgeApis], int]:
        statement = (
            select(ExternalKnowledgeApis)
            .where(ExternalKnowledgeApis.tenant_id == tenant_id)
            .order_by(ExternalKnowledgeApis.created_at.desc())
        )
        if search:
            escaped_search = escape_like_pattern(search)
            statement = statement.where(ExternalKnowledgeApis.name.ilike(f"%{escaped_search}%", escape="\\"))
        result = paginate_query(statement, session=self._session, page=page, per_page=per_page, max_per_page=100)
        return result.items, result.total

    def get_template(self, *, tenant_id: str, template_id: str) -> ExternalKnowledgeApis | None:
        return self._session.scalar(
            select(ExternalKnowledgeApis)
            .where(ExternalKnowledgeApis.id == template_id, ExternalKnowledgeApis.tenant_id == tenant_id)
            .limit(1)
        )

    def create_template(
        self, *, tenant_id: str, user_id: str, name: str, description: str, settings: Mapping[str, Any]
    ) -> ExternalTemplateSnapshot:
        try:
            template = ExternalKnowledgeApis(
                tenant_id=tenant_id,
                created_by=user_id,
                updated_by=user_id,
                name=name,
                description=description,
                settings=json.dumps(settings, ensure_ascii=False),
            )
            self._session.add(template)
            self._session.flush()
            result = self._template_snapshot(template, [])
            self._session.commit()
            return result
        except Exception:
            self._session.rollback()
            raise

    def update_template(
        self,
        *,
        tenant_id: str,
        template_id: str,
        user_id: str,
        name: str,
        description: str,
        settings: Mapping[str, Any] | None,
    ) -> ExternalTemplateSnapshot:
        try:
            template = self.get_template(tenant_id=tenant_id, template_id=template_id)
            if template is None:
                raise ExternalTemplateNotFoundError
            persisted_settings = dict(settings) if settings is not None else None
            if (
                persisted_settings is not None
                and persisted_settings.get("api_key") == HIDDEN_VALUE
                and template.settings_dict
            ):
                persisted_settings["api_key"] = template.settings_dict.get("api_key")
            template.name = name
            template.description = description
            template.settings = json.dumps(persisted_settings, ensure_ascii=False)
            template.updated_by = user_id
            template.updated_at = naive_utc_now()
            self._session.flush()
            bindings = self.get_template_dataset_bindings(template)
            result = self._template_snapshot(template, bindings)
            self._session.commit()
            return result
        except Exception:
            self._session.rollback()
            raise

    def delete_template(self, *, tenant_id: str, template_id: str) -> None:
        try:
            template = self.get_template(tenant_id=tenant_id, template_id=template_id)
            if template is None:
                raise ExternalTemplateNotFoundError
            self._session.delete(template)
            self._session.flush()
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise

    def count_template_bindings(self, *, tenant_id: str, template_id: str) -> int:
        return (
            self._session.scalar(
                select(func.count(ExternalKnowledgeBindings.id)).where(
                    ExternalKnowledgeBindings.external_knowledge_api_id == template_id,
                    ExternalKnowledgeBindings.tenant_id == tenant_id,
                )
            )
            or 0
        )

    def get_dataset_binding(self, *, tenant_id: str, dataset_id: str) -> ExternalKnowledgeBindings | None:
        return self._session.scalar(
            select(ExternalKnowledgeBindings)
            .where(
                ExternalKnowledgeBindings.dataset_id == dataset_id,
                ExternalKnowledgeBindings.tenant_id == tenant_id,
            )
            .limit(1)
        )

    def dataset_name_exists(self, *, tenant_id: str, name: str) -> bool:
        return (
            self._session.scalar(
                select(Dataset.id).where(Dataset.name == name, Dataset.tenant_id == tenant_id).limit(1)
            )
            is not None
        )

    def create_external_dataset(
        self,
        *,
        tenant_id: str,
        user_id: str,
        name: str,
        description: str,
        retrieval_model: Mapping[str, Any] | None,
        template_id: str,
        external_knowledge_id: str,
    ) -> ExternalDatasetSnapshot:
        try:
            if self.dataset_name_exists(tenant_id=tenant_id, name=name):
                raise ExternalDatasetNameConflictError(name)
            if self.get_template(tenant_id=tenant_id, template_id=template_id) is None:
                raise ExternalTemplateNotFoundError
            dataset = Dataset(
                tenant_id=tenant_id,
                name=name,
                description=description,
                provider="external",
                retrieval_model=dict(retrieval_model) if retrieval_model is not None else None,
                created_by=user_id,
                maintainer=user_id,
            )
            self._session.add(dataset)
            self._session.flush()
            self._session.add(
                ExternalKnowledgeBindings(
                    tenant_id=tenant_id,
                    dataset_id=dataset.id,
                    external_knowledge_api_id=template_id,
                    external_knowledge_id=external_knowledge_id,
                    created_by=user_id,
                )
            )
            self._session.flush()
            result = ExternalDatasetSnapshot(
                id=dataset.id,
                tenant_id=dataset.tenant_id,
                name=dataset.name,
                description=dataset.description or "",
                provider=dataset.provider,
                created_by=dataset.created_by,
            )
            self._session.commit()
            return result
        except Exception:
            self._session.rollback()
            raise

    @staticmethod
    def _template_snapshot(
        template: ExternalKnowledgeApis, bindings: Sequence[DatasetBindingItem]
    ) -> ExternalTemplateSnapshot:
        return ExternalTemplateSnapshot(
            id=template.id,
            tenant_id=template.tenant_id,
            name=template.name,
            description=template.description,
            settings=template.settings,
            dataset_bindings=tuple(bindings),
            created_by=template.created_by,
            created_at=template.created_at,
            updated_by=template.updated_by,
            updated_at=template.updated_at,
        )

    def get_template_bindings_batch(
        self, templates: Sequence[ExternalKnowledgeApis]
    ) -> dict[str, list[DatasetBindingItem]]:
        if not templates:
            return {}
        allowed = {(template.id, template.tenant_id) for template in templates}
        rows = self._session.execute(
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

    def get_template_dataset_bindings(self, template: ExternalKnowledgeApis) -> list[DatasetBindingItem]:
        return self.get_template_bindings_batch([template]).get(template.id, [])

    def load_external_knowledge_infos(self, datasets: Sequence[Dataset]) -> dict[tuple[str, str], dict[str, Any]]:
        external_datasets = [dataset for dataset in datasets if dataset.provider == "external"]
        if not external_datasets:
            return {}
        external_owners = [(dataset.tenant_id, dataset.id) for dataset in external_datasets]
        external_tenant_ids = {dataset.tenant_id for dataset in external_datasets}
        bindings = self._session.scalars(
            select(ExternalKnowledgeBindings).where(
                tuple_(ExternalKnowledgeBindings.tenant_id, ExternalKnowledgeBindings.dataset_id).in_(external_owners)
            )
        ).all()
        if not bindings:
            return {}
        templates = {
            (template.id, template.tenant_id): template
            for template in self._session.scalars(
                select(ExternalKnowledgeApis).where(
                    ExternalKnowledgeApis.id.in_({binding.external_knowledge_api_id for binding in bindings}),
                    ExternalKnowledgeApis.tenant_id.in_(external_tenant_ids),
                )
            ).all()
        }
        infos: dict[tuple[str, str], dict[str, Any]] = {}
        for binding in bindings:
            info = Dataset.build_external_knowledge_info(
                binding, templates.get((binding.external_knowledge_api_id, binding.tenant_id))
            )
            if info is not None:
                infos[(binding.dataset_id, binding.tenant_id)] = info
        return infos


class SQLAlchemyExternalKnowledgePersistence:
    """Own bounded sessions for external template, dataset, and retrieval commands."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    def list_templates(self, tenant_id: str, *, page: int, limit: int, keyword: str | None) -> dict[str, Any]:
        page, limit = clamp_pagination(page, limit, 100)
        with self._sessions() as session:
            repository = SQLAlchemyExternalKnowledgeRepository(session)
            templates, total = repository.list_templates(
                tenant_id=tenant_id,
                page=page,
                per_page=limit,
                search=keyword,
            )
            bindings = repository.get_template_bindings_batch(templates)
            return {
                "data": [item.to_dict(dataset_bindings=bindings.get(item.id, [])) for item in templates],
                "has_more": page * limit < total,
                "total": total,
                "page": page,
                "limit": limit,
            }

    def get_template(self, tenant_id: str, template_id: str) -> dict[str, Any] | None:
        with self._sessions() as session:
            repository = SQLAlchemyExternalKnowledgeRepository(session)
            template = repository.get_template(tenant_id=tenant_id, template_id=template_id)
            if template is None:
                return None
            return dict(template.to_dict(dataset_bindings=repository.get_template_dataset_bindings(template)))

    def create_template(
        self,
        *,
        tenant_id: str,
        user_id: str,
        name: str,
        settings: Mapping[str, Any],
    ) -> dict[str, Any]:
        with self._sessions() as session:
            template = SQLAlchemyExternalKnowledgeRepository(session).create_template(
                tenant_id=tenant_id,
                user_id=user_id,
                name=name,
                description="",
                settings=settings,
            )
            return dict(template.to_dict())

    def update_template(
        self,
        *,
        tenant_id: str,
        template_id: str,
        user_id: str,
        name: str,
        settings: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        with self._sessions() as session:
            try:
                template = SQLAlchemyExternalKnowledgeRepository(session).update_template(
                    tenant_id=tenant_id,
                    template_id=template_id,
                    user_id=user_id,
                    name=name,
                    description="",
                    settings=settings,
                )
            except ExternalTemplateNotFoundError:
                return None
            return dict(template.to_dict())

    def delete_template(self, tenant_id: str, template_id: str) -> bool:
        with self._sessions() as session:
            try:
                SQLAlchemyExternalKnowledgeRepository(session).delete_template(
                    tenant_id=tenant_id,
                    template_id=template_id,
                )
            except ExternalTemplateNotFoundError:
                return False
            return True

    def template_usage(self, tenant_id: str, template_id: str) -> tuple[bool, int]:
        with self._sessions() as session:
            count = SQLAlchemyExternalKnowledgeRepository(session).count_template_bindings(
                tenant_id=tenant_id,
                template_id=template_id,
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
    ) -> tuple[Literal["created", "name_conflict", "template_missing"], str | None, str | None]:
        with self._sessions() as session:
            try:
                dataset = SQLAlchemyExternalKnowledgeRepository(session).create_external_dataset(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    name=name,
                    description=description,
                    retrieval_model=retrieval_model,
                    template_id=template_id,
                    external_knowledge_id=external_knowledge_id,
                )
            except ExternalDatasetNameConflictError:
                return "name_conflict", None, None
            except ExternalTemplateNotFoundError:
                return "template_missing", None, None
            return "created", dataset.tenant_id, dataset.id

    def prepare_retrieval(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        query: str,
        retrieval_model: Mapping[str, Any] | None,
        metadata_filters: Mapping[str, Any] | None,
    ) -> tuple[
        Literal["prepared", "missing", "not_external", "configuration_missing"],
        dict[str, Any] | None,
    ]:
        """Materialize owned configuration before the caller performs provider I/O."""

        with self._sessions() as session:
            dataset = session.scalar(
                select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id).limit(1)
            )
            if dataset is None:
                return "missing", None
            if dataset.provider != "external":
                return "not_external", None
            repository = SQLAlchemyExternalKnowledgeRepository(session)
            binding = repository.get_dataset_binding(tenant_id=tenant_id, dataset_id=dataset_id)
            if binding is None:
                return "configuration_missing", None
            template = repository.get_template(
                tenant_id=tenant_id,
                template_id=binding.external_knowledge_api_id,
            )
            if template is None or template.settings is None:
                return "configuration_missing", None
            try:
                settings = json.loads(template.settings)
            except (JSONDecodeError, TypeError):
                return "configuration_missing", None
            if not isinstance(settings, dict):
                return "configuration_missing", None
            parameters = dict(retrieval_model or {})
            score_threshold = (
                parameters.get("score_threshold", 0.0) if parameters.get("score_threshold_enabled") else 0.0
            )
            headers = {"Content-Type": "application/json"}
            if settings.get("api_key"):
                headers["Authorization"] = f"Bearer {settings['api_key']}"
            metadata_condition = (
                MetadataFilteringCondition.model_validate(dict(metadata_filters)).model_dump()
                if metadata_filters
                else None
            )
            return (
                "prepared",
                {
                    "url": f"{settings.get('endpoint')}/retrieval",
                    "request_method": "post",
                    "headers": headers,
                    "params": {
                        "retrieval_setting": {
                            "top_k": parameters.get("top_k"),
                            "score_threshold": score_threshold,
                        },
                        "query": query,
                        "knowledge_id": binding.external_knowledge_id,
                        "metadata_condition": metadata_condition,
                    },
                },
            )
