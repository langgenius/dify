"""SQLAlchemy repository for tenant-owned document state."""

import json
from collections.abc import Mapping

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import exists, select, update
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Document
from models.enums import IndexingStatus
from services.knowledge.document_sync import SyncDocumentRecord
from services.knowledge.indexing.estimate import EstimateDocumentRecord
from services.knowledge.resource_scope import DatasetRef, DocumentRef

_MAPPING_ADAPTER = TypeAdapter(dict[str, object])


def _mapping(value: object) -> Mapping[str, object] | None:
    if value is None:
        return None
    try:
        if isinstance(value, str):
            return _MAPPING_ADAPTER.validate_python(json.loads(value))
        return _MAPPING_ADAPTER.validate_python(value)
    except (TypeError, ValueError, ValidationError):
        return {}


def _estimate_document_record(document: Document) -> EstimateDocumentRecord:
    return EstimateDocumentRecord(
        id=document.id,
        workspace_id=document.tenant_id,
        dataset_id=document.dataset_id,
        data_source_type=str(document.data_source_type),
        data_source_info=_mapping(document.data_source_info),
        indexing_status=str(document.indexing_status),
        doc_form=str(document.doc_form),
        doc_language=document.doc_language,
        dataset_process_rule_id=document.dataset_process_rule_id,
    )


def _get_document(session: Session, document_ref: DocumentRef) -> Document | None:
    """Shared SQL for implementation adapters that already own a transaction."""
    return session.scalar(
        select(Document)
        .where(
            Document.id == document_ref.document_id,
            Document.dataset_id == document_ref.dataset.dataset_id,
            Document.tenant_id == document_ref.dataset.tenant_id,
        )
        .limit(1)
    )


class SQLAlchemyDocumentRepository:
    """Own SQL access to documents through their complete owner chain."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def exists(self, *, workspace_id: str, dataset_id: str, document_id: str) -> bool:
        with self._session_factory() as session:
            return bool(
                session.scalar(
                    select(
                        exists().where(
                            Document.tenant_id == workspace_id,
                            Document.dataset_id == dataset_id,
                            Document.id == document_id,
                        )
                    )
                )
            )

    def mark_failed(self, *, workspace_id: str, dataset_id: str, document_id: str, error: str) -> None:
        with self._session_factory.begin() as session:
            session.execute(
                update(Document)
                .where(
                    Document.tenant_id == workspace_id,
                    Document.dataset_id == dataset_id,
                    Document.id == document_id,
                )
                .values(indexing_status=IndexingStatus.ERROR, error=error)
            )

    def get_estimate_document(self, document_ref: DocumentRef) -> EstimateDocumentRecord | None:
        with self._session_factory() as session:
            document = _get_document(session, document_ref)
            return _estimate_document_record(document) if document is not None else None

    def list_estimate_documents_by_batch(
        self, dataset_ref: DatasetRef, batch: str
    ) -> tuple[EstimateDocumentRecord, ...]:
        with self._session_factory() as session:
            documents = session.scalars(
                select(Document).where(
                    Document.tenant_id == dataset_ref.tenant_id,
                    Document.dataset_id == dataset_ref.dataset_id,
                    Document.batch == batch,
                )
            ).all()
            return tuple(_estimate_document_record(document) for document in documents)

    def get_sync_document(self, document_ref: DocumentRef) -> SyncDocumentRecord | None:
        with self._session_factory() as session:
            document = _get_document(session, document_ref)
            if document is None:
                return None
            return SyncDocumentRecord(id=document.id, data_source_type=str(document.data_source_type))

    def list_active_notion_refs(self, dataset_ref: DatasetRef) -> tuple[DocumentRef, ...]:
        return tuple(dataset_ref.document(document_id) for document_id in self._list_active_notion_ids(dataset_ref))

    def _list_active_notion_ids(self, dataset_ref: DatasetRef) -> tuple[str, ...]:
        with self._session_factory() as session:
            return tuple(
                session.scalars(
                    select(Document.id).where(
                        Document.tenant_id == dataset_ref.tenant_id,
                        Document.dataset_id == dataset_ref.dataset_id,
                        Document.data_source_type == "notion_import",
                        Document.enabled.is_(True),
                        Document.archived.is_(False),
                    )
                ).all()
            )

    def list_bound_notion_page_ids(self, dataset_ref: DatasetRef) -> frozenset[str]:
        page_ids: set[str] = set()
        with self._session_factory() as session:
            documents = session.scalars(
                select(Document).where(
                    Document.tenant_id == dataset_ref.tenant_id,
                    Document.dataset_id == dataset_ref.dataset_id,
                    Document.data_source_type == "notion_import",
                    Document.enabled.is_(True),
                )
            ).all()
        for document in documents:
            source_info = _mapping(document.data_source_info)
            if source_info is None:
                continue
            page_id = source_info.get("notion_page_id")
            if isinstance(page_id, str) and page_id:
                page_ids.add(page_id)
        return frozenset(page_ids)
