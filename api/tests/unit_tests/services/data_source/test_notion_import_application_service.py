from unittest.mock import Mock, create_autospec

import pytest

from core.rag.extractor.entity.datasource_type import NotionPageType
from machinery.context import RequestContext
from services.data_source.notion_import_application_service import (
    DatasetIsNotNotionSourceError,
    NotionDatasetReader,
    NotionDocumentBindingReader,
    NotionImportApplicationService,
    NotionSourceGateway,
)
from services.entities.data_source.notion_import import AuthorizedNotionPage, NotionWorkspace
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess
from services.knowledge.resource_scope import DatasetRef

CONTEXT = RequestContext("request-1", None, "account-1", "workspace-1")
DATASET = DatasetRef("workspace-1", "dataset-1")
type ServiceFixture = tuple[NotionImportApplicationService, Mock, Mock, Mock, Mock]


@pytest.fixture
def fixture() -> ServiceFixture:
    access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    access.require_accessible.return_value = AccessibleDataset(id="dataset-1", workspace_id="workspace-1")
    datasets = create_autospec(NotionDatasetReader, instance=True, spec_set=True)
    datasets.is_notion_dataset.return_value = True
    documents = create_autospec(NotionDocumentBindingReader, instance=True, spec_set=True)
    documents.list_bound_notion_page_ids.return_value = frozenset()
    source = create_autospec(NotionSourceGateway, instance=True, spec_set=True)
    source.list_authorized_pages.return_value = ()
    source.preview_page.return_value = "preview"
    service = NotionImportApplicationService(
        dataset_access=access, datasets=datasets, documents=documents, source=source
    )
    return service, access, datasets, documents, source


def test_list_pages_preserves_workspaces_and_marks_bound_pages(fixture: ServiceFixture) -> None:
    service, access, datasets, documents, source = fixture
    page_1 = AuthorizedNotionPage("page-1", "One", None, None, NotionPageType.PAGE)
    page_2 = AuthorizedNotionPage("page-2", "Two", None, "page-1", NotionPageType.PAGE)
    source.list_authorized_pages.return_value = (
        NotionWorkspace("notion-workspace-1", "First", None, (page_1,)),
        NotionWorkspace("notion-workspace-2", "Second", None, (page_2,)),
    )
    documents.list_bound_notion_page_ids.return_value = frozenset({"page-2"})

    result = service.list_pages(CONTEXT, credential_id="credential-1", dataset_id="dataset-1")

    assert [workspace.workspace_id for workspace in result.workspaces] == ["notion-workspace-1", "notion-workspace-2"]
    assert result.workspaces[0].pages[0].is_bound is False
    assert result.workspaces[1].pages[0].is_bound is True
    access.require_accessible.assert_called_once_with(CONTEXT, "dataset-1")
    datasets.is_notion_dataset.assert_called_once_with(DATASET)
    documents.list_bound_notion_page_ids.assert_called_once_with(DATASET)
    source.list_authorized_pages.assert_called_once_with(
        workspace_id="workspace-1", actor_id="account-1", credential_id="credential-1"
    )


def test_list_pages_without_dataset_does_not_read_document_bindings(fixture: ServiceFixture) -> None:
    service, access, _, documents, _ = fixture

    service.list_pages(CONTEXT, credential_id="credential-1")

    access.require_accessible.assert_not_called()
    documents.list_bound_notion_page_ids.assert_not_called()


def test_list_pages_rejects_non_notion_dataset_before_external_call(fixture: ServiceFixture) -> None:
    service, _, datasets, _, source = fixture
    datasets.is_notion_dataset.return_value = False

    with pytest.raises(DatasetIsNotNotionSourceError):
        service.list_pages(CONTEXT, credential_id="credential-1", dataset_id="dataset-1")

    datasets.is_notion_dataset.assert_called_once_with(DATASET)
    source.list_authorized_pages.assert_not_called()


def test_preview_passes_explicit_actor_and_workspace(fixture: ServiceFixture) -> None:
    service, _, _, _, source = fixture

    content = service.preview_page(
        CONTEXT, credential_id="credential-1", page_id="page-1", page_type=NotionPageType.PAGE
    )

    assert content == "preview"
    source.preview_page.assert_called_once_with(
        workspace_id="workspace-1",
        actor_id="account-1",
        credential_id="credential-1",
        page_id="page-1",
        page_type=NotionPageType.PAGE,
    )
