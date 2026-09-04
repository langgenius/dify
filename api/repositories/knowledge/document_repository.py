"""SQLAlchemy repository for tenant-owned document state."""

import json
from collections.abc import Mapping, Sequence

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.entities.dataset_reference import DatasetRef, DocumentRef
from models.dataset import Dataset, Document
from models.enums import IndexingStatus
from services.entities.knowledge_entities.records import DocumentRecord

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


def _document_record(document: Document) -> DocumentRecord:
    return DocumentRecord(
        id=document.id,
        workspace_id=document.tenant_id,
        dataset_id=document.dataset_id,
        name=document.name,
        data_source_type=str(document.data_source_type),
        data_source_info=_mapping(document.data_source_info),
        enabled=document.enabled,
        archived=document.archived,
        indexing_status=str(document.indexing_status),
        batch=document.batch,
        doc_form=str(document.doc_form),
        doc_language=document.doc_language,
        dataset_process_rule_id=document.dataset_process_rule_id,
        need_summary=document.need_summary,
        doc_metadata=_mapping(document.doc_metadata),
    )


class SQLAlchemyDocumentRepository:
    """Own SQL access to documents through their complete owner chain."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_by_ref(self, document_ref: DocumentRef) -> DocumentRecord | None:
        with self._session_factory() as session:
            document = session.scalar(
                select(Document)
                .where(
                    Document.id == document_ref.document_id,
                    Document.dataset_id == document_ref.dataset.dataset_id,
                    Document.tenant_id == document_ref.dataset.tenant_id,
                )
                .limit(1)
            )
            return _document_record(document) if document is not None else None

    def get_by_id_for_workspace(self, *, workspace_id: str, document_id: str) -> DocumentRecord | None:
        with self._session_factory() as session:
            document = session.scalar(
                select(Document)
                .join(Dataset, Dataset.id == Document.dataset_id)
                .where(
                    Document.id == document_id,
                    Document.tenant_id == workspace_id,
                    Dataset.tenant_id == workspace_id,
                )
                .limit(1)
            )
            return _document_record(document) if document is not None else None

    def list_by_refs(self, dataset_ref: DatasetRef, document_ids: Sequence[str]) -> tuple[DocumentRecord, ...]:
        return self._list_by_refs(dataset_ref, document_ids, available_only=False)

    def list_available_by_refs(
        self,
        dataset_ref: DatasetRef,
        document_ids: Sequence[str],
    ) -> tuple[DocumentRecord, ...]:
        return self._list_by_refs(dataset_ref, document_ids, available_only=True)

    def _list_by_refs(
        self,
        dataset_ref: DatasetRef,
        document_ids: Sequence[str],
        *,
        available_only: bool,
    ) -> tuple[DocumentRecord, ...]:
        unique_document_ids = tuple(dict.fromkeys(document_ids))
        if not unique_document_ids:
            return ()

        stmt = select(Document).where(
            Document.tenant_id == dataset_ref.tenant_id,
            Document.dataset_id == dataset_ref.dataset_id,
            Document.id.in_(unique_document_ids),
        )
        if available_only:
            stmt = stmt.where(
                Document.enabled.is_(True),
                Document.indexing_status == IndexingStatus.COMPLETED,
                Document.archived.is_(False),
            )

        with self._session_factory() as session:
            documents = session.scalars(stmt).all()
            records_by_id = {document.id: _document_record(document) for document in documents}
            return tuple(
                records_by_id[document_id] for document_id in unique_document_ids if document_id in records_by_id
            )

    def list_by_batch(self, dataset_ref: DatasetRef, batch: str) -> tuple[DocumentRecord, ...]:
        with self._session_factory() as session:
            documents = session.scalars(
                select(Document).where(
                    Document.tenant_id == dataset_ref.tenant_id,
                    Document.dataset_id == dataset_ref.dataset_id,
                    Document.batch == batch,
                )
            ).all()
            return tuple(_document_record(document) for document in documents)

    def list_active_notion_refs(self, dataset_ref: DatasetRef) -> tuple[DocumentRef, ...]:
        return tuple(dataset_ref.document(document.id) for document in self._list_active_notion(dataset_ref))

    def _list_active_notion(self, dataset_ref: DatasetRef) -> tuple[DocumentRecord, ...]:
        with self._session_factory() as session:
            documents = session.scalars(
                select(Document).where(
                    Document.tenant_id == dataset_ref.tenant_id,
                    Document.dataset_id == dataset_ref.dataset_id,
                    Document.data_source_type == "notion_import",
                    Document.enabled.is_(True),
                    Document.archived.is_(False),
                )
            ).all()
            return tuple(_document_record(document) for document in documents)

    def list_working_by_dataset(self, dataset_ref: DatasetRef) -> tuple[DocumentRecord, ...]:
        with self._session_factory() as session:
            documents = session.scalars(
                select(Document).where(
                    Document.tenant_id == dataset_ref.tenant_id,
                    Document.dataset_id == dataset_ref.dataset_id,
                    Document.enabled.is_(True),
                    Document.indexing_status == IndexingStatus.COMPLETED,
                    Document.archived.is_(False),
                )
            ).all()
            return tuple(_document_record(document) for document in documents)

    def list_bound_notion_page_ids(self, dataset_ref: DatasetRef) -> frozenset[str]:
        page_ids: set[str] = set()
        for document in self._list_active_notion(dataset_ref):
            if document.data_source_info is None:
                continue
            page_id = document.data_source_info.get("notion_page_id")
            if isinstance(page_id, str) and page_id:
                page_ids.add(page_id)
        return frozenset(page_ids)
