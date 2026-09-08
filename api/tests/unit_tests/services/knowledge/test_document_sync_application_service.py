from unittest.mock import Mock, call, create_autospec

import pytest

from machinery.context import RequestContext
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess, DatasetAccessDeniedError
from services.knowledge.document_sync import (
    DocumentSyncApplicationService,
    DocumentSyncReader,
    SyncDocumentNotFoundError,
    SyncDocumentRecord,
    SyncDocumentSourceError,
)
from services.knowledge.resource_scope import DatasetRef

CONTEXT = RequestContext("request-1", None, "account-1", "workspace-1")
DATASET = DatasetRef("workspace-1", "dataset-1")
type ServiceFixture = tuple[DocumentSyncApplicationService, Mock, Mock, Mock]


@pytest.fixture
def fixture() -> ServiceFixture:
    access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    access.require_accessible.return_value = AccessibleDataset(id="dataset-1", workspace_id="workspace-1")
    documents = create_autospec(DocumentSyncReader, instance=True, spec_set=True)
    documents.get_sync_document.return_value = SyncDocumentRecord("document-1", "notion_import")
    dispatcher = Mock()
    service = DocumentSyncApplicationService(dataset_access=access, documents=documents, dispatcher=dispatcher)
    return service, access, documents, dispatcher


def test_sync_dataset_dispatches_snapshot_after_tenant_scoped_read(fixture: ServiceFixture) -> None:
    service, access, documents, dispatcher = fixture
    documents.list_active_notion_refs.return_value = (DATASET.document("document-1"), DATASET.document("document-2"))

    assert service.sync_dataset(CONTEXT, "dataset-1") == 2

    access.require_accessible.assert_called_once_with(CONTEXT, "dataset-1")
    documents.list_active_notion_refs.assert_called_once_with(DATASET)
    assert dispatcher.call_args_list == [call("dataset-1", "document-1"), call("dataset-1", "document-2")]


def test_sync_document_validates_owner_chain_and_source_before_dispatch(fixture: ServiceFixture) -> None:
    service, access, documents, dispatcher = fixture

    service.sync_document(CONTEXT, "dataset-1", "document-1")

    access.require_accessible.assert_called_once_with(CONTEXT, "dataset-1")
    documents.get_sync_document.assert_called_once_with(DATASET.document("document-1"))
    dispatcher.assert_called_once_with("dataset-1", "document-1")


@pytest.mark.parametrize(
    ("document", "error"),
    [(None, SyncDocumentNotFoundError), (SyncDocumentRecord("document-1", "upload_file"), SyncDocumentSourceError)],
)
def test_sync_document_rejects_invalid_document_before_dispatch(
    fixture: ServiceFixture, document: SyncDocumentRecord | None, error: type[Exception]
) -> None:
    service, _, documents, dispatcher = fixture
    documents.get_sync_document.return_value = document

    with pytest.raises(error):
        service.sync_document(CONTEXT, "dataset-1", "document-1")

    dispatcher.assert_not_called()


def test_sync_stops_before_document_read_and_dispatch_when_dataset_access_is_denied(fixture: ServiceFixture) -> None:
    service, access, documents, dispatcher = fixture
    access.require_accessible.side_effect = DatasetAccessDeniedError()

    with pytest.raises(DatasetAccessDeniedError):
        service.sync_document(CONTEXT, "dataset-1", "document-1")

    documents.get_sync_document.assert_not_called()
    dispatcher.assert_not_called()
