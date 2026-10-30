from dataclasses import dataclass, field
from typing import cast

import pytest

from machinery.context import RequestContext
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccessDeniedError, DatasetAccessSnapshot
from services.knowledge.document_sync import (
    DocumentSyncApplicationService,
    DocumentSyncReader,
    SyncDocumentArchivedError,
    SyncDocumentNotFoundError,
    SyncDocumentRecord,
    SyncDocumentSourceError,
)
from services.knowledge.documents.application import DocumentTaskDispatcher
from services.knowledge.documents.contracts import (
    DocumentBatchCleanupJob,
    DocumentCleanupJob,
    DocumentPersistenceArchivedError,
)
from services.knowledge.entities.datasets import DatasetCleanupRecord
from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef


def _context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "workspace-1")


def _dataset() -> AccessibleDataset:
    return AccessibleDataset(
        id="dataset-1",
        workspace_id="workspace-1",
    )


def _document(*, data_source_type: str = "notion_import") -> SyncDocumentRecord:
    return SyncDocumentRecord(
        id="document-1",
        data_source_type=data_source_type,
    )


@dataclass
class DatasetAccessStub:
    error: Exception | None = None
    calls: list[str] = field(default_factory=list)

    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        assert context == _context()
        self.calls.append(dataset_id)
        if self.error is not None:
            raise self.error
        return _dataset()

    def check_access(self, context: RequestContext, snapshot: DatasetAccessSnapshot) -> AccessibleDataset:
        raise AssertionError(f"Unexpected snapshot access for dataset {snapshot.dataset.id} by {context.account_id}")


@dataclass
class DocumentReaderStub:
    document: SyncDocumentRecord | None = field(default_factory=_document)
    active_refs: tuple[DocumentRef, ...] = ()
    list_calls: list[DatasetRef] = field(default_factory=list)
    get_calls: list[DocumentRef] = field(default_factory=list)
    sync_calls: list[DocumentRef] = field(default_factory=list)
    sync_error: Exception | None = None

    def list_active_notion_refs(self, dataset_ref: DatasetRef) -> tuple[DocumentRef, ...]:
        self.list_calls.append(dataset_ref)
        return self.active_refs

    def get_sync_document(self, document_ref: DocumentRef) -> SyncDocumentRecord | None:
        self.get_calls.append(document_ref)
        return self.document

    def sync_notion(self, ref: DocumentRef) -> None:
        if self.sync_error is not None:
            raise self.sync_error
        self.sync_calls.append(ref)


@dataclass
class TaskDispatcherStub:
    sync_calls: list[DocumentRef] = field(default_factory=list)
    cleanup_calls: list[tuple[DatasetRef, DocumentCleanupJob | DocumentBatchCleanupJob]] = field(default_factory=list)
    dataset_cleanup_calls: list[DatasetCleanupRecord] = field(default_factory=list)

    def cleanup(self, ref: DatasetRef, cleanup: DocumentCleanupJob | DocumentBatchCleanupJob) -> None:
        self.cleanup_calls.append((ref, cleanup))

    def cleanup_dataset(self, cleanup: DatasetCleanupRecord) -> None:
        self.dataset_cleanup_calls.append(cleanup)

    def sync_notion(self, ref: DocumentRef) -> None:
        self.sync_calls.append(ref)


def _service(documents: DocumentReaderStub, tasks: TaskDispatcherStub | None = None) -> DocumentSyncApplicationService:
    return DocumentSyncApplicationService(
        dataset_access=DatasetAccessStub(),
        documents=cast(DocumentSyncReader, documents),
        tasks=cast(DocumentTaskDispatcher, tasks or TaskDispatcherStub()),
    )


def test_sync_dataset_dispatches_snapshot_after_tenant_scoped_read() -> None:
    dataset_ref = DatasetRef("workspace-1", "dataset-1")
    documents = DocumentReaderStub(active_refs=(dataset_ref.document("document-1"), dataset_ref.document("document-2")))
    tasks = TaskDispatcherStub()
    service = _service(documents, tasks)

    count = service.sync_dataset(_context(), "dataset-1")

    assert count == 2
    assert documents.list_calls == [dataset_ref]
    assert documents.sync_calls == [
        dataset_ref.document("document-1"),
        dataset_ref.document("document-2"),
    ]
    assert tasks.sync_calls == documents.sync_calls


def test_sync_document_validates_owner_chain_and_source_before_dispatch() -> None:
    documents = DocumentReaderStub()
    tasks = TaskDispatcherStub()
    service = _service(documents, tasks)

    service.sync_document(_context(), "dataset-1", "document-1")

    assert documents.get_calls == [DatasetRef("workspace-1", "dataset-1").document("document-1")]
    assert documents.sync_calls == [DatasetRef("workspace-1", "dataset-1").document("document-1")]
    assert tasks.sync_calls == documents.sync_calls


@pytest.mark.parametrize(
    ("document", "error"),
    [
        (None, SyncDocumentNotFoundError),
        (_document(data_source_type="upload_file"), SyncDocumentSourceError),
    ],
)
def test_sync_document_rejects_invalid_document_before_dispatch(
    document: SyncDocumentRecord | None, error: type[Exception]
) -> None:
    documents = DocumentReaderStub(document=document)
    service = _service(documents)

    with pytest.raises(error):
        service.sync_document(_context(), "dataset-1", "document-1")

    assert documents.sync_calls == []


def test_sync_stops_before_document_read_and_dispatch_when_dataset_access_is_denied() -> None:
    documents = DocumentReaderStub()
    service = DocumentSyncApplicationService(
        dataset_access=DatasetAccessStub(error=DatasetAccessDeniedError()),
        documents=cast(DocumentSyncReader, documents),
        tasks=cast(DocumentTaskDispatcher, TaskDispatcherStub()),
    )

    with pytest.raises(DatasetAccessDeniedError):
        service.sync_document(_context(), "dataset-1", "document-1")

    assert documents.get_calls == []
    assert documents.sync_calls == []


def test_sync_maps_archived_race_from_locked_command() -> None:
    documents = DocumentReaderStub(sync_error=DocumentPersistenceArchivedError("Document is archived."))
    service = _service(documents)

    with pytest.raises(SyncDocumentArchivedError, match="Document is archived"):
        service.sync_document(_context(), "dataset-1", "document-1")
