from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from typing import Any, cast

from sqlalchemy import and_, func, or_, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.rag.entities.metadata_entities import MetadataCondition
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.repositories.knowledge_repository import (
    DatasetEntity,
    DatasetMetadataEntity,
    DocumentEntity,
    KnowledgeRepository,
)
from models.dataset import Dataset, DatasetMetadata, Document, RateLimitLog


class SQLAlchemyKnowledgeRepository(KnowledgeRepository):
    """
    SQLAlchemy implementation of KnowledgeRepository.

    Sessions are created per method call to avoid shared state across concurrent
    node executions. `close_session()` is therefore a no-op.
    """

    _session_factory: sessionmaker[Session]

    def __init__(self, session_factory: sessionmaker[Session] | Engine):
        if isinstance(session_factory, Engine):
            self._session_factory = sessionmaker(bind=session_factory, expire_on_commit=False)
        elif isinstance(session_factory, sessionmaker):
            self._session_factory = session_factory
        else:
            raise ValueError(
                f"Invalid session_factory type {type(session_factory).__name__}; expected sessionmaker or Engine"
            )

    def get_datasets_with_available_documents(
        self, tenant_id: str, dataset_ids: Sequence[str]
    ) -> Sequence[DatasetEntity]:
        """
        Fetch datasets that have available documents (or are external providers).
        """
        if not dataset_ids:
            return []

        with self._session_factory() as session:
            subquery = (
                select(Document.dataset_id, func.count(Document.id).label("available_document_count"))
                .where(
                    Document.tenant_id == tenant_id,
                    Document.indexing_status == "completed",
                    Document.enabled.is_(True),
                    Document.archived.is_(False),
                    Document.dataset_id.in_(dataset_ids),
                )
                .group_by(Document.dataset_id)
                .having(func.count(Document.id) > 0)
                .subquery()
            )

            stmt = (
                select(Dataset)
                .outerjoin(subquery, Dataset.id == subquery.c.dataset_id)
                .where(
                    Dataset.tenant_id == tenant_id,
                    Dataset.id.in_(dataset_ids),
                    (subquery.c.available_document_count > 0) | (Dataset.provider == "external"),
                )
            )
            return cast(Sequence[DatasetEntity], session.scalars(stmt).all())

    def get_document(self, tenant_id: str, document_id: str) -> DocumentEntity | None:
        stmt = select(Document).where(
            Document.id == document_id,
            Document.tenant_id == tenant_id,
            Document.enabled.is_(True),
            Document.archived.is_(False),
        )
        with self._session_factory() as session:
            return cast(DocumentEntity | None, session.scalar(stmt))

    def get_metadata_fields(self, tenant_id: str, dataset_ids: Sequence[str]) -> Sequence[DatasetMetadataEntity]:
        if not dataset_ids:
            return []

        stmt = (
            select(DatasetMetadata)
            .join(Dataset, DatasetMetadata.dataset_id == Dataset.id)
            .where(
                DatasetMetadata.dataset_id.in_(dataset_ids),
                Dataset.tenant_id == tenant_id,
            )
        )
        with self._session_factory() as session:
            return cast(Sequence[DatasetMetadataEntity], session.scalars(stmt).all())

    def add_rate_limit_log(self, tenant_id: str, subscription_plan: str, operation: str) -> None:
        # Use a separate transaction for logging to ensure it persists even if main transaction fails.
        with self._session_factory.begin() as session:
            rate_limit_log = RateLimitLog(
                tenant_id=tenant_id,
                subscription_plan=subscription_plan,
                operation=operation,
            )
            session.add(rate_limit_log)

    def get_documents_by_dataset_ids(self, tenant_id: str, dataset_ids: Sequence[str]) -> Sequence[DocumentEntity]:
        if not dataset_ids:
            return []

        stmt = select(Document).where(
            Document.dataset_id.in_(dataset_ids),
            Document.tenant_id == tenant_id,
            Document.indexing_status == "completed",
            Document.enabled.is_(True),
            Document.archived.is_(False),
        )
        with self._session_factory() as session:
            return cast(Sequence[DocumentEntity], session.scalars(stmt).all())

    def get_dataset(self, tenant_id: str, dataset_id: str) -> DatasetEntity | None:
        stmt = select(Dataset).where(
            Dataset.id == dataset_id,
            Dataset.tenant_id == tenant_id,
        )
        with self._session_factory() as session:
            return cast(DatasetEntity | None, session.scalar(stmt))

    def get_document_ids_by_filtering(
        self, tenant_id: str, dataset_ids: Sequence[str], filters: MetadataCondition | None
    ) -> dict[str, list[str]] | None:
        if not dataset_ids:
            return None

        stmt = select(Document.id, Document.dataset_id).where(
            Document.dataset_id.in_(dataset_ids),
            Document.tenant_id == tenant_id,
            Document.indexing_status == "completed",
            Document.enabled.is_(True),
            Document.archived.is_(False),
        )

        compiled_filters: list[Any] = []
        if filters and filters.conditions:
            for sequence, condition in enumerate(filters.conditions):
                DatasetRetrieval.process_metadata_filter_func(
                    sequence,
                    condition.comparison_operator,
                    condition.name,
                    condition.value,
                    compiled_filters,
                )

            if compiled_filters:
                if filters.logical_operator == "and":
                    stmt = stmt.where(and_(*compiled_filters))
                else:
                    stmt = stmt.where(or_(*compiled_filters))

        with self._session_factory() as session:
            results = session.execute(stmt).all()

        if not results:
            return None

        metadata_filter_document_ids: dict[str, list[str]] = defaultdict(list)
        for row in results:
            metadata_filter_document_ids[row.dataset_id].append(row.id)

        return dict(metadata_filter_document_ids)

    def close_session(self) -> None:
        return
