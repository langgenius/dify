"""SQLAlchemy query helpers for document-owned read projections."""

from collections.abc import Sequence
from dataclasses import dataclass, field

import sqlalchemy as sa
from sqlalchemy import Select, func, select, tuple_
from sqlalchemy.orm import Session

from models.account import Account
from models.dataset import (
    Dataset,
    DatasetMetadata,
    DatasetMetadataBinding,
    DatasetProcessRule,
    Document,
    DocumentSegment,
)
from models.enums import IndexingStatus, SegmentStatus
from models.model import UploadFile
from services.knowledge.documents.contracts import (
    DocumentMetadataProjection,
    DocumentProcessRuleProjection,
    DocumentReadProjection,
    DocumentSourceFileProjection,
)

_DOCUMENT_DISPLAY_STATUS_ALIASES = {"active": "available", "enabled": "available"}
_DOCUMENT_DISPLAY_STATUSES = frozenset({"queuing", "indexing", "paused", "error", "available", "disabled", "archived"})


@dataclass(frozen=True)
class DocumentReadBatch:
    uploads: dict[tuple[str, str], UploadFile] = field(default_factory=dict)
    metadatas: dict[str, list[DatasetMetadata]] = field(default_factory=dict)
    built_in_enabled: dict[tuple[str, str], bool] = field(default_factory=dict)
    uploader_names: dict[str, str] = field(default_factory=dict)
    segment_counts: dict[str, int] = field(default_factory=dict)
    hit_counts: dict[str, int] = field(default_factory=dict)
    process_rules: dict[str, DatasetProcessRule] = field(default_factory=dict)


def _normalize_document_display_status(status: str | None) -> str | None:
    if not status:
        return None
    normalized = _DOCUMENT_DISPLAY_STATUS_ALIASES.get(status.lower(), status.lower())
    return normalized if normalized in _DOCUMENT_DISPLAY_STATUSES else None


def _build_document_display_status_filters(status: str | None) -> tuple[sa.ColumnElement[bool], ...]:
    normalized = _normalize_document_display_status(status)
    if normalized is None:
        return ()
    processing = Document.indexing_status.in_(
        (IndexingStatus.PARSING, IndexingStatus.CLEANING, IndexingStatus.SPLITTING, IndexingStatus.INDEXING)
    )
    filters: dict[str, tuple[sa.ColumnElement[bool], ...]] = {
        "queuing": (Document.indexing_status == IndexingStatus.WAITING, Document.is_paused.is_not(True)),
        "indexing": (processing, Document.is_paused.is_not(True)),
        "paused": (
            Document.is_paused.is_(True),
            Document.indexing_status.not_in((IndexingStatus.COMPLETED, IndexingStatus.ERROR)),
        ),
        "error": (Document.indexing_status == IndexingStatus.ERROR,),
        "available": (
            Document.indexing_status == IndexingStatus.COMPLETED,
            Document.archived.is_(False),
            Document.enabled.is_(True),
        ),
        "disabled": (
            Document.indexing_status == IndexingStatus.COMPLETED,
            Document.archived.is_(False),
            Document.enabled.is_(False),
        ),
        "archived": (
            Document.indexing_status == IndexingStatus.COMPLETED,
            Document.archived.is_(True),
        ),
    }
    return filters[normalized]


def apply_document_display_status_filter(
    statement: Select[tuple[Document]], status: str | None
) -> Select[tuple[Document]]:
    filters = _build_document_display_status_filters(status)
    return statement.where(*filters) if filters else statement


def get_documents_by_ids(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
) -> Sequence[Document]:
    unique_ids = tuple(dict.fromkeys(document_ids))
    if not unique_ids:
        return ()
    return session.scalars(
        select(Document).where(
            Document.id.in_(unique_ids),
            Document.dataset_id == dataset_id,
            Document.tenant_id == tenant_id,
        )
    ).all()


def list_dataset_documents(session: Session, *, tenant_id: str, dataset_id: str) -> Sequence[Document]:
    return session.scalars(
        select(Document).where(
            Document.tenant_id == tenant_id,
            Document.dataset_id == dataset_id,
        )
    ).all()


def get_error_documents(session: Session, *, tenant_id: str, dataset_id: str) -> Sequence[Document]:
    return session.scalars(
        select(Document).where(
            Document.tenant_id == tenant_id,
            Document.dataset_id == dataset_id,
            Document.indexing_status.in_((IndexingStatus.ERROR, IndexingStatus.PAUSED)),
        )
    ).all()


def get_document_segment_counts(session: Session, documents: Sequence[Document]) -> dict[str, tuple[int, int]]:
    if not documents:
        return {}
    owners = {(str(item.tenant_id), str(item.dataset_id), str(item.id)) for item in documents}
    rows = session.execute(
        select(
            DocumentSegment.document_id,
            func.count(DocumentSegment.id),
            func.coalesce(func.sum(sa.case((DocumentSegment.completed_at.isnot(None), 1), else_=0)), 0),
        )
        .where(
            tuple_(
                DocumentSegment.tenant_id,
                DocumentSegment.dataset_id,
                DocumentSegment.document_id,
            ).in_(owners),
            DocumentSegment.status != SegmentStatus.RE_SEGMENT,
        )
        .group_by(DocumentSegment.document_id)
    )
    return {str(document_id): (int(completed or 0), int(total or 0)) for document_id, total, completed in rows}


def get_documents_position(session: Session, *, tenant_id: str, dataset_id: str) -> int:
    position = session.scalar(
        select(func.max(Document.position)).where(
            Document.tenant_id == tenant_id,
            Document.dataset_id == dataset_id,
        )
    )
    return int(position) + 1 if position is not None else 1


def load_document_read_batch(documents: Sequence[Document], *, session: Session) -> DocumentReadBatch:
    """Load a page's document relations with a bounded number of queries."""
    if not documents:
        return DocumentReadBatch()
    owners = [(doc.tenant_id, doc.dataset_id, doc.id) for doc in documents]
    dataset_owners = list({(doc.tenant_id, doc.dataset_id) for doc in documents})
    upload_owners = list(
        {
            (doc.tenant_id, file_id)
            for doc in documents
            if doc.data_source_type == "upload_file" and (file_id := doc.data_source_info_dict.get("upload_file_id"))
        }
    )
    uploads = (
        {
            (file.tenant_id, file.id): file
            for file in session.scalars(
                select(UploadFile).where(tuple_(UploadFile.tenant_id, UploadFile.id).in_(upload_owners))
            )
        }
        if upload_owners
        else {}
    )
    metadatas: dict[str, list[DatasetMetadata]] = {}
    for doc_id, metadata in session.execute(
        select(DatasetMetadataBinding.document_id, DatasetMetadata)
        .join(DatasetMetadata, DatasetMetadata.id == DatasetMetadataBinding.metadata_id)
        .where(
            tuple_(
                DatasetMetadataBinding.tenant_id,
                DatasetMetadataBinding.dataset_id,
                DatasetMetadataBinding.document_id,
            ).in_(owners),
            DatasetMetadata.tenant_id == DatasetMetadataBinding.tenant_id,
            DatasetMetadata.dataset_id == DatasetMetadataBinding.dataset_id,
        )
    ):
        metadatas.setdefault(doc_id, []).append(metadata)
    built_in_enabled = {
        (tenant_id, dataset_id): enabled
        for tenant_id, dataset_id, enabled in session.execute(
            select(Dataset.tenant_id, Dataset.id, Dataset.built_in_field_enabled).where(
                tuple_(Dataset.tenant_id, Dataset.id).in_(dataset_owners)
            )
        )
    }
    uploader_names = dict(
        session.execute(select(Account.id, Account.name).where(Account.id.in_({doc.created_by for doc in documents})))
        .tuples()
        .all()
    )
    counts = session.execute(
        select(
            DocumentSegment.document_id,
            func.count(DocumentSegment.id),
            func.coalesce(func.sum(DocumentSegment.hit_count), 0),
        )
        .where(tuple_(DocumentSegment.tenant_id, DocumentSegment.dataset_id, DocumentSegment.document_id).in_(owners))
        .group_by(DocumentSegment.document_id)
    ).all()
    rule_ids = {doc.dataset_process_rule_id for doc in documents if doc.dataset_process_rule_id}
    process_rules = (
        {
            rule.id: rule
            for rule in session.scalars(
                select(DatasetProcessRule)
                .join(Dataset, Dataset.id == DatasetProcessRule.dataset_id)
                .where(DatasetProcessRule.id.in_(rule_ids), tuple_(Dataset.tenant_id, Dataset.id).in_(dataset_owners))
            )
        }
        if rule_ids
        else {}
    )
    return DocumentReadBatch(
        uploads=uploads,
        metadatas=metadatas,
        built_in_enabled=built_in_enabled,
        uploader_names=uploader_names,
        segment_counts={doc_id: count for doc_id, count, _ in counts},
        hit_counts={doc_id: hits for doc_id, _, hits in counts},
        process_rules=process_rules,
    )


def load_document_read_projections(
    documents: Sequence[Document], *, session: Session
) -> tuple[DocumentReadProjection, ...]:
    """Materialize typed document data while the caller's read transaction is open."""

    batch = load_document_read_batch(documents, session=session)
    projections: list[DocumentReadProjection] = []
    for document in documents:
        source_info = dict(document.data_source_info_dict)
        file_id = source_info.get("upload_file_id")
        file = batch.uploads.get((document.tenant_id, file_id)) if isinstance(file_id, str) else None
        process_rule = batch.process_rules.get(document.dataset_process_rule_id)
        if process_rule is not None and process_rule.dataset_id != document.dataset_id:
            process_rule = None
        projections.append(
            DocumentReadProjection(
                id=document.id,
                tenant_id=document.tenant_id,
                dataset_id=document.dataset_id,
                position=document.position,
                data_source_type=document.data_source_type,
                data_source_info=source_info,
                dataset_process_rule_id=document.dataset_process_rule_id,
                name=document.name,
                created_from=document.created_from,
                created_by=document.created_by,
                created_at=document.created_at,
                updated_at=document.updated_at,
                tokens=document.tokens,
                indexing_status=document.indexing_status,
                error=document.error,
                enabled=document.enabled,
                disabled_at=document.disabled_at,
                disabled_by=document.disabled_by,
                archived=document.archived,
                display_status=document.display_status,
                word_count=document.word_count,
                doc_form=document.doc_form,
                need_summary=document.need_summary,
                completed_segments=vars(document).get("completed_segments"),
                total_segments=vars(document).get("total_segments"),
                summary_index_status=vars(document).get("summary_index_status"),
                hit_count=batch.hit_counts.get(document.id, 0),
                source_file=(
                    DocumentSourceFileProjection(
                        id=file.id,
                        name=file.name,
                        size=file.size,
                        extension=file.extension,
                        mime_type=file.mime_type,
                        created_by=file.created_by,
                        created_at=file.created_at,
                    )
                    if file is not None
                    else None
                ),
                metadata=tuple(
                    DocumentMetadataProjection(id=metadata.id, name=metadata.name, type=metadata.type)
                    for metadata in batch.metadatas.get(document.id, ())
                ),
                doc_metadata=dict(document.doc_metadata or {}),
                built_in_enabled=batch.built_in_enabled.get((document.tenant_id, document.dataset_id), False),
                uploader_name=batch.uploader_names.get(document.created_by),
                process_rule=(
                    DocumentProcessRuleProjection(
                        id=process_rule.id,
                        dataset_id=process_rule.dataset_id,
                        mode=process_rule.mode,
                        rules=process_rule.rules_dict,
                    )
                    if process_rule is not None
                    else None
                ),
            )
        )
    return tuple(projections)


def get_document_process_rule(document: Document, *, session: Session) -> DatasetProcessRule | None:
    if document.dataset_process_rule_id:
        return session.scalar(
            select(DatasetProcessRule).where(
                DatasetProcessRule.id == document.dataset_process_rule_id,
                DatasetProcessRule.dataset_id == document.dataset_id,
            )
        )
    return None


def get_document_segment_count(document: Document, *, session: Session) -> int:
    return (
        session.scalar(
            select(func.count(DocumentSegment.id)).where(
                DocumentSegment.document_id == document.id,
                DocumentSegment.dataset_id == document.dataset_id,
                DocumentSegment.tenant_id == document.tenant_id,
            )
        )
        or 0
    )


def get_document_hit_count(document: Document, *, session: Session) -> int:
    return (
        session.scalar(
            select(func.coalesce(func.sum(DocumentSegment.hit_count), 0)).where(
                DocumentSegment.document_id == document.id,
                DocumentSegment.dataset_id == document.dataset_id,
                DocumentSegment.tenant_id == document.tenant_id,
            )
        )
        or 0
    )


def get_document_upload_file(document: Document, *, session: Session) -> UploadFile | None:
    file_id = document.data_source_info_dict.get("upload_file_id")
    if not file_id:
        return None
    return session.scalar(
        select(UploadFile).where(UploadFile.id == file_id, UploadFile.tenant_id == document.tenant_id)
    )


def get_document_metadata_rows(document: Document, *, session: Session) -> Sequence[DatasetMetadata]:
    return session.scalars(
        select(DatasetMetadata)
        .join(DatasetMetadataBinding, DatasetMetadataBinding.metadata_id == DatasetMetadata.id)
        .where(
            DatasetMetadata.tenant_id == document.tenant_id,
            DatasetMetadata.dataset_id == document.dataset_id,
            DatasetMetadataBinding.tenant_id == document.tenant_id,
            DatasetMetadataBinding.dataset_id == document.dataset_id,
            DatasetMetadataBinding.document_id == document.id,
        )
    ).all()


def get_document_dataset(document: Document, *, session: Session) -> Dataset | None:
    """Load the owning dataset with the caller-owned database session."""
    return session.scalar(
        select(Dataset).where(Dataset.id == document.dataset_id, Dataset.tenant_id == document.tenant_id)
    )


def get_document_uploader(document: Document, *, session: Session) -> str | None:
    user = session.scalar(select(Account).where(Account.id == document.created_by))
    return user.name if user else None
