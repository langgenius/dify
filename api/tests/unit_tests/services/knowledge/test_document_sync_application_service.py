from dataclasses import dataclass, field

import pytest

from machinery.context import RequestContext
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccessDeniedError
from services.knowledge.document_sync import (
    DocumentSyncApplicationService,
    SyncDocumentNotFoundError,
    SyncDocumentRecord,
    SyncDocumentSourceError,
)
from services.knowledge.document_sync_adapters import CeleryDocumentSyncDispatcher
from services.knowledge.resource_scope import DatasetRef, DocumentRef


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


@dataclass
class DocumentReaderStub:
    document: SyncDocumentRecord | None = field(default_factory=_document)
    active_refs: tuple[DocumentRef, ...] = ()
    list_calls: list[DatasetRef] = field(default_factory=list)
    get_calls: list[DocumentRef] = field(default_factory=list)

    def list_active_notion_refs(self, dataset_ref: DatasetRef) -> tuple[DocumentRef, ...]:
        self.list_calls.append(dataset_ref)
        return self.active_refs

    def get_sync_document(self, document_ref: DocumentRef) -> SyncDocumentRecord | None:
        self.get_calls.append(document_ref)
        return self.document


@dataclass
class DispatcherRecorder:
    calls: list[tuple[str, str]] = field(default_factory=list)

    def dispatch(self, *, dataset_id: str, document_id: str) -> None:
        self.calls.append((dataset_id, document_id))


def test_celery_dispatcher_forwards_owned_identifiers_to_injected_delay() -> None:
    calls: list[tuple[str, str]] = []
    dispatcher = CeleryDocumentSyncDispatcher(
        delay=lambda dataset_id, document_id: calls.append((dataset_id, document_id))
    )

    dispatcher.dispatch(dataset_id="dataset-1", document_id="document-1")

    assert calls == [("dataset-1", "document-1")]


def test_sync_dataset_dispatches_snapshot_after_tenant_scoped_read() -> None:
    dataset_ref = DatasetRef("workspace-1", "dataset-1")
    documents = DocumentReaderStub(active_refs=(dataset_ref.document("document-1"), dataset_ref.document("document-2")))
    dispatcher = DispatcherRecorder()
    service = DocumentSyncApplicationService(
        dataset_access=DatasetAccessStub(), documents=documents, dispatcher=dispatcher
    )

    count = service.sync_dataset(_context(), "dataset-1")

    assert count == 2
    assert documents.list_calls == [dataset_ref]
    assert dispatcher.calls == [("dataset-1", "document-1"), ("dataset-1", "document-2")]


def test_sync_document_validates_owner_chain_and_source_before_dispatch() -> None:
    documents = DocumentReaderStub()
    dispatcher = DispatcherRecorder()
    service = DocumentSyncApplicationService(
        dataset_access=DatasetAccessStub(), documents=documents, dispatcher=dispatcher
    )

    service.sync_document(_context(), "dataset-1", "document-1")

    assert documents.get_calls == [DatasetRef("workspace-1", "dataset-1").document("document-1")]
    assert dispatcher.calls == [("dataset-1", "document-1")]


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
    dispatcher = DispatcherRecorder()
    service = DocumentSyncApplicationService(
        dataset_access=DatasetAccessStub(),
        documents=DocumentReaderStub(document=document),
        dispatcher=dispatcher,
    )

    with pytest.raises(error):
        service.sync_document(_context(), "dataset-1", "document-1")

    assert dispatcher.calls == []


def test_sync_stops_before_document_read_and_dispatch_when_dataset_access_is_denied() -> None:
    documents = DocumentReaderStub()
    dispatcher = DispatcherRecorder()
    service = DocumentSyncApplicationService(
        dataset_access=DatasetAccessStub(error=DatasetAccessDeniedError()),
        documents=documents,
        dispatcher=dispatcher,
    )

    with pytest.raises(DatasetAccessDeniedError):
        service.sync_document(_context(), "dataset-1", "document-1")

    assert documents.get_calls == []
    assert dispatcher.calls == []
