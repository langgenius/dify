"""SQLAlchemy query helpers for document-owned read projections."""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa
from sqlalchemy import Select, func, select, tuple_
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.built_in_field import BuiltInField, MetadataDataSource
from models.account import Account
from models.dataset import (
    Dataset,
    DatasetMetadata,
    DatasetMetadataBinding,
    DatasetProcessRule,
    DocMetadataDetailItem,
    Document,
    DocumentSegment,
)
from models.document_indexing_state import EffectiveDocumentIndexingState, resolve_document_indexing_state
from models.enums import IndexingStatus, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import UploadFile
from repositories.knowledge.task_state_repository import get_current_document_index_state_rows

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
    current = (
        KnowledgeTaskOutbox.tenant_id == Document.tenant_id,
        KnowledgeTaskOutbox.dataset_id == Document.dataset_id,
        KnowledgeTaskOutbox.resource_id == Document.id,
        KnowledgeTaskOutbox.task_kind == "document_index_state",
        KnowledgeTaskOutbox.payload["superseded"].as_boolean().is_not(True),
        KnowledgeTaskOutbox.payload["generation"].as_string() == sa.cast(Document.indexing_generation, sa.String),
        KnowledgeTaskOutbox.payload["action"].as_string().in_(("add", "remove")),
    )
    failed = sa.exists(select(KnowledgeTaskOutbox.id).where(*current, KnowledgeTaskOutbox.status == "failed"))
    pending = sa.exists(
        select(KnowledgeTaskOutbox.id).where(
            *current, KnowledgeTaskOutbox.status.in_(("pending", "processing", "dispatched", "executing"))
        )
    )
    processing = Document.indexing_status.in_(
        (IndexingStatus.PARSING, IndexingStatus.CLEANING, IndexingStatus.SPLITTING, IndexingStatus.INDEXING)
    )
    resumed = pending & Document.indexing_status.in_((IndexingStatus.COMPLETED, IndexingStatus.ERROR))
    filters: dict[str, tuple[sa.ColumnElement[bool], ...]] = {
        "queuing": (~failed, Document.indexing_status == IndexingStatus.WAITING, Document.is_paused.is_not(True)),
        "indexing": (~failed, processing | resumed, Document.is_paused.is_not(True)),
        "paused": (
            ~failed,
            Document.is_paused.is_(True),
            Document.indexing_status.not_in((IndexingStatus.COMPLETED, IndexingStatus.ERROR)) | resumed,
        ),
        "error": (failed | ((Document.indexing_status == IndexingStatus.ERROR) & ~pending),),
        "available": (
            ~failed,
            ~pending,
            Document.indexing_status == IndexingStatus.COMPLETED,
            Document.archived.is_(False),
            Document.enabled.is_(True),
        ),
        "disabled": (
            ~failed,
            ~pending,
            Document.indexing_status == IndexingStatus.COMPLETED,
            Document.archived.is_(False),
            Document.enabled.is_(False),
        ),
        "archived": (
            ~failed,
            ~pending,
            Document.indexing_status == IndexingStatus.COMPLETED,
            Document.archived.is_(True),
        ),
    }
    return filters[normalized]


def get_current_document_indexing_states(
    session: Session, *, tenant_id: str, dataset_id: str, documents: Sequence[Document]
) -> dict[str, KnowledgeTaskOutbox]:
    return get_current_document_index_state_rows(
        session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_generations={
            document.id: document.indexing_generation
            for document in documents
            if document.indexing_generation is not None
        },
    )


def project_current_document_index_states(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    documents: Sequence[Document],
    values: Sequence[dict[str, Any]],
) -> None:
    """Use the same effective state for listing, detail, progress and retry actions."""
    states = get_effective_document_indexing_states(
        session, tenant_id=tenant_id, dataset_id=dataset_id, documents=documents
    )
    values_by_id = {str(value["id"]): value for value in values}
    for document in documents:
        value = values_by_id.get(document.id)
        if value is None:
            continue
        effective = states[document.id]
        value.update(
            indexing_state=effective.indexing_state,
            indexing_status=effective.indexing_status,
            display_status=effective.display_status,
            indexing_retry_action=effective.indexing_retry_action,
            error=effective.error,
        )


def get_effective_document_indexing_states(
    session: Session, *, tenant_id: str, dataset_id: str, documents: Sequence[Document]
) -> dict[str, EffectiveDocumentIndexingState]:
    tasks = get_current_document_indexing_states(
        session, tenant_id=tenant_id, dataset_id=dataset_id, documents=documents
    )
    states: dict[str, EffectiveDocumentIndexingState] = {}
    for document in documents:
        task = tasks.get(document.id)
        states[document.id] = resolve_document_indexing_state(
            raw_status=str(document.indexing_status),
            is_paused=bool(document.is_paused),
            enabled=bool(document.enabled),
            archived=bool(document.archived),
            task_status=task.status if task is not None else None,
            task_action=str(task.payload.get("action")) if task is not None else None,
            raw_error=document.error,
            task_error=task.last_error if task is not None else None,
        )
    return states


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


def format_document_source_detail(document: Document, file: UploadFile | None) -> dict[str, Any]:
    if document.data_source_type == "upload_file" and file is not None:
        return {
            "upload_file": {
                "id": file.id,
                "name": file.name,
                "size": file.size,
                "extension": file.extension,
                "mime_type": file.mime_type,
                "created_by": file.created_by,
                "created_at": file.created_at.timestamp(),
            }
        }
    if document.data_source_type in {"notion_import", "website_crawl"}:
        return document.data_source_info_dict
    return {}


def format_document_built_in_fields(document: Document, *, uploader_name: str | None) -> list[DocMetadataDetailItem]:
    return [
        {"id": "built-in", "name": BuiltInField.document_name, "type": "string", "value": document.name},
        {"id": "built-in", "name": BuiltInField.uploader, "type": "string", "value": uploader_name},
        {
            "id": "built-in",
            "name": BuiltInField.upload_date,
            "type": "time",
            "value": str(document.created_at.timestamp()),
        },
        {
            "id": "built-in",
            "name": BuiltInField.last_update_date,
            "type": "time",
            "value": str(document.updated_at.timestamp()),
        },
        {
            "id": "built-in",
            "name": BuiltInField.source,
            "type": "string",
            "value": MetadataDataSource[document.data_source_type],
        },
    ]


def format_document_metadata(
    document: Document,
    metadatas: Sequence[DatasetMetadata],
    *,
    built_in_enabled: bool,
    uploader_name: str | None,
) -> list[DocMetadataDetailItem] | None:
    values = document.doc_metadata or {}
    details: list[DocMetadataDetailItem] = [
        {"id": metadata.id, "name": metadata.name, "type": metadata.type, "value": values.get(metadata.name)}
        for metadata in metadatas
    ]
    if built_in_enabled:
        details.extend(format_document_built_in_fields(document, uploader_name=uploader_name))
    return details or None


def document_response_values(document: Document, batch: DocumentReadBatch) -> dict[str, Any]:
    """Build response-only values from a loaded snapshot without database access."""

    file_id = document.data_source_info_dict.get("upload_file_id")
    process_rule = batch.process_rules.get(document.dataset_process_rule_id)
    if process_rule is not None and process_rule.dataset_id != document.dataset_id:
        process_rule = None
    return {
        "data_source_detail_dict": format_document_source_detail(
            document, batch.uploads.get((document.tenant_id, file_id)) if isinstance(file_id, str) else None
        ),
        "hit_count": batch.hit_counts.get(document.id, 0),
        "doc_metadata_details": format_document_metadata(
            document,
            batch.metadatas.get(document.id, []),
            built_in_enabled=batch.built_in_enabled.get((document.tenant_id, document.dataset_id), False),
            uploader_name=batch.uploader_names.get(document.created_by),
        ),
        "process_rule_dict": process_rule.to_dict() if process_rule else None,
    }


def load_document_details(documents: Iterable[Document], *, session: Session) -> list[dict[str, Any]]:
    """Materialize document attributes and relations while the caller's session is open."""

    items = list(documents)
    batch = load_document_read_batch(items, session=session)
    values = [
        {
            "id": document.id,
            "position": document.position,
            "data_source_type": document.data_source_type,
            "data_source_info_dict": document.data_source_info_dict,
            "dataset_process_rule_id": document.dataset_process_rule_id,
            "name": document.name,
            "created_from": document.created_from,
            "created_by": document.created_by,
            "created_at": document.created_at,
            "tokens": document.tokens,
            "indexing_status": document.indexing_status,
            "error": document.error,
            "enabled": document.enabled,
            "disabled_at": document.disabled_at,
            "disabled_by": document.disabled_by,
            "archived": document.archived,
            "display_status": document.display_status,
            "word_count": document.word_count,
            "doc_form": document.doc_form,
            "summary_index_status": vars(document).get("summary_index_status"),
            "need_summary": document.need_summary,
            "completed_segments": vars(document).get("completed_segments"),
            "total_segments": vars(document).get("total_segments"),
            **document_response_values(document, batch),
        }
        for document in items
    ]
    owners: dict[tuple[str, str], list[Document]] = {}
    for document in items:
        owners.setdefault((document.tenant_id, document.dataset_id), []).append(document)
    for (tenant_id, dataset_id), owned_documents in owners.items():
        project_current_document_index_states(
            session, tenant_id=tenant_id, dataset_id=dataset_id, documents=owned_documents, values=values
        )
    return values


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
