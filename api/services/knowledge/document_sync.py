"""Request-side document synchronization use cases."""

from typing import NamedTuple, Protocol
from uuid import uuid4

from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.documents.contracts import (
    DocumentPersistenceArchivedError,
    DocumentPersistenceInvalidStateError,
    DocumentPersistenceNotFoundError,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef


class SyncDocumentRecord(NamedTuple):
    """Document state required to authorize and dispatch a sync request."""

    id: str
    data_source_type: str


class DocumentSyncReader(Protocol):
    def get_sync_document(self, document_ref: DocumentRef) -> SyncDocumentRecord | None: ...

    def list_active_notion_refs(self, dataset_ref: DatasetRef) -> tuple[DocumentRef, ...]: ...

    def sync_notion(self, ref: DocumentRef, *, generation: str) -> None: ...


class DocumentSyncError(Exception):
    """Base class for document synchronization failures."""


class SyncDocumentNotFoundError(DocumentSyncError):
    def __init__(self) -> None:
        super().__init__("Document not found")


class SyncDocumentSourceError(DocumentSyncError):
    def __init__(self) -> None:
        super().__init__("Document is not notion type")


class SyncDocumentArchivedError(DocumentSyncError):
    pass


class DocumentSyncApplicationService:
    """Authorize synchronization requests and dispatch the worker use case."""

    def __init__(
        self,
        *,
        dataset_access: DatasetAccess,
        documents: DocumentSyncReader,
    ) -> None:
        self._dataset_access = dataset_access
        self._documents = documents

    def sync_dataset(self, context: RequestContext, dataset_id: str) -> int:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        dataset_ref = DatasetRef(dataset.workspace_id, dataset.id)
        document_refs = self._documents.list_active_notion_refs(dataset_ref)
        for document_ref in document_refs:
            self._sync_notion(document_ref)
        return len(document_refs)

    def sync_document(self, context: RequestContext, dataset_id: str, document_id: str) -> None:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        document_ref = DatasetRef(dataset.workspace_id, dataset.id).document(document_id)
        document = self._documents.get_sync_document(document_ref)
        if document is None:
            raise SyncDocumentNotFoundError()
        if document.data_source_type != "notion_import":
            raise SyncDocumentSourceError()
        self._sync_notion(document_ref)

    def _sync_notion(self, document_ref: DocumentRef) -> None:
        try:
            self._documents.sync_notion(document_ref, generation=str(uuid4()))
        except DocumentPersistenceNotFoundError as error:
            raise SyncDocumentNotFoundError() from error
        except DocumentPersistenceArchivedError as error:
            raise SyncDocumentArchivedError(str(error)) from error
        except DocumentPersistenceInvalidStateError as error:
            raise SyncDocumentSourceError() from error
