"""SQLAlchemy repository for tenant-owned document state."""

import json
from collections.abc import Mapping

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import exists, select, update
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models import Account
from models.dataset import Dataset, DatasetProcessRule, Document, Pipeline
from models.enums import IndexingStatus
from repositories.knowledge.dataset_read_repository import get_pipeline_dataset
from services.knowledge.document_sync import SyncDocumentRecord
from services.knowledge.indexing.errors import DocumentIsDeletedPausedError, DocumentIsPausedError
from services.knowledge.indexing.estimate import EstimateDocumentRecord, StoredSource
from services.knowledge.indexing.execution import IndexingDocument
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


def require_indexing_document(session: Session, ref: DocumentRef, *, lock: bool = False) -> Document:
    """Validate the persisted owner chain before each indexing phase."""
    statement = (
        select(Document)
        .join(Dataset, Dataset.id == Document.dataset_id)
        .where(
            Document.id == ref.document_id,
            Document.dataset_id == ref.dataset.dataset_id,
            Document.tenant_id == ref.dataset.tenant_id,
            Dataset.tenant_id == ref.dataset.tenant_id,
        )
    )
    if lock:
        statement = statement.with_for_update(of=Document)
    document = session.scalar(statement)
    if document is None:
        raise DocumentIsDeletedPausedError()
    if document.is_paused:
        raise DocumentIsPausedError()
    return document


class SQLAlchemyDocumentRepository:
    """Own SQL access to documents through their complete owner chain."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_pipeline_dataset(self, pipeline: Pipeline, *, session: Session) -> Dataset | None:
        """Read within the pipeline caller's transaction, including uncommitted changes."""
        return get_pipeline_dataset(pipeline, session=session)

    def get_indexing_document(self, ref: DocumentRef) -> IndexingDocument:
        with self._session_factory() as session:
            document = require_indexing_document(session, ref)
            rule = session.scalar(
                select(DatasetProcessRule).where(
                    DatasetProcessRule.id == document.dataset_process_rule_id,
                    DatasetProcessRule.dataset_id == ref.dataset.dataset_id,
                )
            )
            return IndexingDocument(
                source=StoredSource.from_document(_estimate_document_record(document)),
                processing_rule=rule.to_dict() if rule else {},
                doc_language=document.doc_language or "English",
                need_summary=bool(document.need_summary),
            )

    def get_indexing_models(self, ref: DocumentRef) -> tuple[Dataset, Document]:
        """Detached legacy processor inputs; never pass them to another thread."""
        with self._session_factory() as session:
            document = require_indexing_document(session, ref)
            dataset = session.scalar(
                select(Dataset).where(
                    Dataset.id == ref.dataset.dataset_id,
                    Dataset.tenant_id == ref.dataset.tenant_id,
                )
            )
            assert dataset is not None
            return dataset, document

    def get_indexing_user(self, ref: DocumentRef) -> Account:
        with self._session_factory() as session:
            document = require_indexing_document(session, ref)
            account = session.get(Account, document.created_by)
            if account is None:
                raise ValueError("no current user found")
            account.set_tenant_id_with_session(ref.dataset.tenant_id, session=session)
            return account

    def mark_splitting(self, ref: DocumentRef) -> None:
        with self._session_factory.begin() as session:
            document = require_indexing_document(session, ref, lock=True)
            document.indexing_status = IndexingStatus.SPLITTING
            document.parsing_completed_at = naive_utc_now()

    def complete_indexing(self, ref: DocumentRef, *, tokens: int, latency: float) -> None:
        with self._session_factory.begin() as session:
            document = require_indexing_document(session, ref, lock=True)
            document.indexing_status = IndexingStatus.COMPLETED
            document.tokens = tokens
            document.indexing_latency = latency
            document.completed_at = naive_utc_now()
            document.error = None

    def fail_indexing(self, ref: DocumentRef, error: str) -> None:
        try:
            with self._session_factory.begin() as session:
                document = require_indexing_document(session, ref, lock=True)
                document.indexing_status = IndexingStatus.ERROR
                document.error = error
                document.stopped_at = naive_utc_now()
        except DocumentIsDeletedPausedError:
            return

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
        with self._session_factory() as session:
            return tuple(
                dataset_ref.document(document_id)
                for document_id in session.scalars(
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
