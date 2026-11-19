"""Persistence boundary for tenant-scoped knowledge retrieval."""

import json
import logging
from collections.abc import Mapping, Sequence
from typing import Any, cast

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, load_only, sessionmaker
from tenacity import before_sleep_log, retry, retry_if_exception, stop_after_attempt, wait_exponential

from core.rag.index_processor.constant.query_type import QueryType
from enums.creator import CreatorUserRole
from libs.helper import parse_uuid_str_or_none
from models.dataset import Dataset, DatasetMetadata, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import DatasetQuerySource
from models.model import UploadFile
from repositories.knowledge.dataset_read_repository import stage_dataset_queries
from repositories.knowledge.metadata_filter import query_metadata_filter_document_ids
from services.knowledge.entities.metadata import Condition
from services.knowledge.retrieval.retrieval import RetrievalDatasetSnapshot

logger = logging.getLogger(__name__)

_POSTGRES_DEADLOCK_SQLSTATE = "40P01"
_HIT_COUNT_UPDATE_MAX_ATTEMPTS = 3


def _is_postgres_deadlock_error(exc: BaseException) -> bool:
    if not isinstance(exc, DBAPIError) or exc.orig is None:
        return False
    orig = cast(Any, exc.orig)
    return (hasattr(orig, "sqlstate") and orig.sqlstate == _POSTGRES_DEADLOCK_SQLSTATE) or (
        hasattr(orig, "pgcode") and orig.pgcode == _POSTGRES_DEADLOCK_SQLSTATE
    )


def _retrieval_dataset_snapshot(dataset: Dataset) -> RetrievalDatasetSnapshot:
    return RetrievalDatasetSnapshot(
        id=dataset.id,
        tenant_id=dataset.tenant_id,
        name=dataset.name,
        description=dataset.description,
        provider=str(dataset.provider),
        retrieval_model=dict(dataset.retrieval_model) if dataset.retrieval_model else None,
        indexing_technique=str(dataset.indexing_technique) if dataset.indexing_technique else None,
        embedding_model_provider=dataset.embedding_model_provider,
        embedding_model=dataset.embedding_model,
    )


def _resolve_creator_user_role(user_from: str) -> CreatorUserRole | None:
    normalized_user_from = str(user_from).strip().lower().replace("-", "_")
    if normalized_user_from == CreatorUserRole.ACCOUNT.value:
        return CreatorUserRole.ACCOUNT
    if normalized_user_from == CreatorUserRole.END_USER.value:
        return CreatorUserRole.END_USER
    logger.warning("Skipping dataset query audit log for unsupported user_from=%r", user_from)
    return None


def expand_attachment_document_filter(
    *, session: Session, tenant_id: str, dataset_id: str, document_ids: Sequence[str]
) -> tuple[str, ...]:
    """Resolve provider-facing attachment identities through the complete current owner chain."""
    logical_ids = tuple(dict.fromkeys(str(document_id) for document_id in document_ids))
    if not logical_ids:
        return ()
    attachment_ids = session.scalars(
        select(SegmentAttachmentBinding.attachment_id)
        .join(
            DocumentSegment,
            (DocumentSegment.id == SegmentAttachmentBinding.segment_id)
            & (DocumentSegment.tenant_id == SegmentAttachmentBinding.tenant_id)
            & (DocumentSegment.dataset_id == SegmentAttachmentBinding.dataset_id)
            & (DocumentSegment.document_id == SegmentAttachmentBinding.document_id),
        )
        .join(
            Document,
            (Document.id == SegmentAttachmentBinding.document_id)
            & (Document.tenant_id == SegmentAttachmentBinding.tenant_id)
            & (Document.dataset_id == SegmentAttachmentBinding.dataset_id),
        )
        .join(
            Dataset,
            (Dataset.id == SegmentAttachmentBinding.dataset_id)
            & (Dataset.tenant_id == SegmentAttachmentBinding.tenant_id),
        )
        .join(
            UploadFile,
            (UploadFile.id == SegmentAttachmentBinding.attachment_id)
            & (UploadFile.tenant_id == SegmentAttachmentBinding.tenant_id),
        )
        .where(
            SegmentAttachmentBinding.tenant_id == tenant_id,
            SegmentAttachmentBinding.dataset_id == dataset_id,
            SegmentAttachmentBinding.document_id.in_(logical_ids),
            Document.indexing_status == "completed",
            Document.enabled.is_(True),
            Document.archived.is_(False),
            DocumentSegment.status == "completed",
            DocumentSegment.enabled.is_(True),
        )
        .order_by(SegmentAttachmentBinding.attachment_id)
    ).all()
    return tuple(dict.fromkeys((*logical_ids, *(str(attachment_id) for attachment_id in attachment_ids))))


class SQLAlchemyRetrievalRepository:
    """Own the short database transactions needed by the retrieval coordinator."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    def list_available_datasets(self, *, tenant_id: str, dataset_ids: Sequence[str]) -> list[RetrievalDatasetSnapshot]:
        requested_ids = tuple(dict.fromkeys(str(dataset_id) for dataset_id in dataset_ids))
        if not requested_ids:
            return []
        with self._sessions() as session:
            available_documents = (
                select(Document.dataset_id, func.count(Document.id).label("available_document_count"))
                .where(
                    Document.tenant_id == tenant_id,
                    Document.indexing_status == "completed",
                    Document.enabled.is_(True),
                    Document.archived.is_(False),
                    Document.dataset_id.in_(requested_ids),
                )
                .group_by(Document.dataset_id)
                .having(func.count(Document.id) > 0)
                .subquery()
            )
            datasets = session.scalars(
                select(Dataset)
                .outerjoin(available_documents, Dataset.id == available_documents.c.dataset_id)
                .where(
                    Dataset.tenant_id == tenant_id,
                    Dataset.id.in_(requested_ids),
                    (available_documents.c.available_document_count > 0) | (Dataset.provider == "external"),
                )
            ).all()
            snapshots = {dataset.id: _retrieval_dataset_snapshot(dataset) for dataset in datasets}
        return [snapshots[dataset_id] for dataset_id in requested_ids if dataset_id in snapshots]

    def get_available_dataset(self, *, tenant_id: str, dataset_id: str) -> RetrievalDatasetSnapshot | None:
        datasets = self.list_available_datasets(tenant_id=tenant_id, dataset_ids=(dataset_id,))
        return datasets[0] if datasets else None

    def list_metadata_field_names(self, *, tenant_id: str, dataset_ids: Sequence[str]) -> list[str]:
        if not dataset_ids:
            return []
        with self._sessions() as session:
            return list(
                session.scalars(
                    select(DatasetMetadata.name).where(
                        DatasetMetadata.tenant_id == tenant_id,
                        DatasetMetadata.dataset_id.in_(tuple(dataset_ids)),
                    )
                )
            )

    def filter_document_ids(
        self,
        *,
        tenant_id: str,
        dataset_ids: Sequence[str],
        logical_operator: str,
        conditions: Sequence[Condition] | None,
    ) -> dict[str, list[str]]:
        with self._sessions() as session:
            return query_metadata_filter_document_ids(
                session,
                tenant_id=tenant_id,
                dataset_ids=dataset_ids,
                logical_operator=logical_operator,
                conditions=conditions,
            )

    def expand_document_ids_filter(
        self, *, tenant_id: str, dataset_id: str, document_ids: Sequence[str]
    ) -> tuple[str, ...]:
        with self._sessions() as session:
            return expand_attachment_document_filter(
                session=session,
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_ids=document_ids,
            )

    def record_app_query(
        self,
        *,
        tenant_id: str,
        dataset_ids: Sequence[str],
        query: str | None,
        attachment_ids: Sequence[str] | None,
        app_id: str,
        user_from: str,
        user_id: str,
    ) -> None:
        if not query and not attachment_ids:
            return
        created_by = parse_uuid_str_or_none(user_id)
        if created_by is None:
            logger.debug(
                "Skipping dataset query log: empty created_by user_id (user_from=%s, app_id=%s)",
                user_from,
                app_id,
            )
            return
        created_by_role = _resolve_creator_user_role(user_from)
        if created_by_role is None:
            return
        contents: list[dict[str, str]] = []
        if query:
            contents.append({"content_type": QueryType.TEXT_QUERY, "content": query})
        contents.extend(
            {"content_type": QueryType.IMAGE_QUERY, "content": str(attachment_id)}
            for attachment_id in attachment_ids or ()
        )
        if not contents:
            return
        with self._sessions.begin() as session:
            stage_dataset_queries(
                session,
                tenant_id=tenant_id,
                dataset_ids=dataset_ids,
                content=json.dumps(contents),
                source=DatasetQuerySource.APP,
                source_app_id=app_id,
                created_by_role=created_by_role,
                created_by=created_by,
            )

    @retry(
        retry=retry_if_exception(_is_postgres_deadlock_error),
        stop=stop_after_attempt(_HIT_COUNT_UPDATE_MAX_ATTEMPTS),
        wait=wait_exponential(multiplier=0.05, min=0.05, max=0.1),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    def increment_segment_hit_counts(self, segment_ids: Sequence[str]) -> None:
        segment_ids_to_update = {str(segment_id) for segment_id in segment_ids if segment_id}
        if not segment_ids_to_update:
            return
        with self._sessions.begin() as session:
            session.scalars(
                select(DocumentSegment.id)
                .where(DocumentSegment.id.in_(segment_ids_to_update))
                .order_by(DocumentSegment.id)
                .with_for_update()
            ).all()
            session.execute(
                update(DocumentSegment)
                .where(DocumentSegment.id.in_(segment_ids_to_update))
                .values(hit_count=DocumentSegment.hit_count + 1)
                .execution_options(synchronize_session=False)
            )


def get_retrieval_source_documents(
    *, tenant_id: str, dataset_ids: Sequence[str], document_ids: Sequence[str], session: Session
) -> Sequence[Document]:
    """Read citation fields without loading document processing payloads.

    Other document fields are intentionally unavailable; this read must not grow
    implicit per-document queries when response assembly changes.
    """
    if not dataset_ids or not document_ids:
        return []
    return session.scalars(
        select(Document)
        .where(
            Document.tenant_id == tenant_id,
            Document.dataset_id.in_(set(dataset_ids)),
            Document.id.in_(set(document_ids)),
        )
        .options(
            load_only(
                Document.id,
                Document.tenant_id,
                Document.dataset_id,
                Document.name,
                Document.data_source_type,
                Document.doc_metadata,
                raiseload=True,
            )
        )
    ).all()


def get_retrieval_source_datasets(*, tenant_id: str, dataset_ids: Sequence[str], session: Session) -> Sequence[Dataset]:
    """Read the citation fields for the selected tenant-owned datasets in the caller's transaction."""
    if not dataset_ids:
        return []
    return session.scalars(
        select(Dataset)
        .where(
            Dataset.tenant_id == tenant_id,
            Dataset.id.in_(set(dataset_ids)),
        )
        .options(
            load_only(
                Dataset.id,
                Dataset.tenant_id,
                Dataset.name,
                raiseload=True,
            )
        )
    ).all()


def get_authorized_retrieval_attachment_file_keys(
    *,
    tenant_id: str,
    attachment_ids: Sequence[str],
    dataset_document_filters: Mapping[str, Sequence[str] | None],
    session: Session,
) -> dict[str, str]:
    """Resolve candidate attachment keys through the current complete owner chain.

    The dataset/document scope is supplied by the trusted retrieval caller. Candidate
    vector metadata contributes only physical attachment IDs and cannot widen that scope.
    """
    physical_attachment_ids = tuple(dict.fromkeys(str(attachment_id) for attachment_id in attachment_ids))
    if not physical_attachment_ids or not dataset_document_filters:
        return {}

    dataset_scope = []
    for dataset_id, document_ids in dataset_document_filters.items():
        dataset_condition = SegmentAttachmentBinding.dataset_id == str(dataset_id)
        if document_ids is not None:
            logical_document_ids = tuple(dict.fromkeys(str(document_id) for document_id in document_ids))
            if not logical_document_ids:
                continue
            dataset_condition = and_(
                dataset_condition,
                SegmentAttachmentBinding.document_id.in_(logical_document_ids),
            )
        dataset_scope.append(dataset_condition)
    if not dataset_scope:
        return {}

    rows = session.execute(
        select(SegmentAttachmentBinding.attachment_id, UploadFile.key)
        .select_from(SegmentAttachmentBinding)
        .join(
            Dataset,
            (Dataset.id == SegmentAttachmentBinding.dataset_id)
            & (Dataset.tenant_id == SegmentAttachmentBinding.tenant_id),
        )
        .join(
            Document,
            (Document.id == SegmentAttachmentBinding.document_id)
            & (Document.tenant_id == SegmentAttachmentBinding.tenant_id)
            & (Document.dataset_id == SegmentAttachmentBinding.dataset_id),
        )
        .join(
            DocumentSegment,
            (DocumentSegment.id == SegmentAttachmentBinding.segment_id)
            & (DocumentSegment.tenant_id == SegmentAttachmentBinding.tenant_id)
            & (DocumentSegment.dataset_id == SegmentAttachmentBinding.dataset_id)
            & (DocumentSegment.document_id == SegmentAttachmentBinding.document_id),
        )
        .join(
            UploadFile,
            (UploadFile.id == SegmentAttachmentBinding.attachment_id)
            & (UploadFile.tenant_id == SegmentAttachmentBinding.tenant_id),
        )
        .where(
            SegmentAttachmentBinding.tenant_id == tenant_id,
            SegmentAttachmentBinding.attachment_id.in_(physical_attachment_ids),
            or_(*dataset_scope),
            Document.indexing_status == "completed",
            Document.enabled.is_(True),
            Document.archived.is_(False),
            DocumentSegment.status == "completed",
            DocumentSegment.enabled.is_(True),
        )
        .order_by(SegmentAttachmentBinding.attachment_id)
    ).tuples()
    return {str(attachment_id): key for attachment_id, key in rows}
