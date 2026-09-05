from dataclasses import dataclass, field

import pytest

from core.rag.extractor.entity.datasource_type import NotionPageType
from machinery.context import RequestContext
from services.data_source.notion_import_application_service import (
    DatasetIsNotNotionSourceError,
    NotionImportApplicationService,
)
from services.entities.data_source.notion_import import AuthorizedNotionPage, NotionWorkspace
from services.knowledge.dataset_access import AccessibleDataset
from services.knowledge.resource_scope import DatasetRef


def _context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "workspace-1")


def _dataset() -> AccessibleDataset:
    return AccessibleDataset(
        id="dataset-1",
        workspace_id="workspace-1",
    )


@dataclass
class DatasetAccessStub:
    dataset: AccessibleDataset = field(default_factory=_dataset)
    calls: list[str] = field(default_factory=list)

    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        assert context == _context()
        self.calls.append(dataset_id)
        return self.dataset


@dataclass
class NotionDatasetReaderStub:
    is_notion: bool = True
    refs: list[DatasetRef] = field(default_factory=list)

    def is_notion_dataset(self, dataset_ref: DatasetRef) -> bool:
        self.refs.append(dataset_ref)
        return self.is_notion


@dataclass
class DocumentBindingReaderStub:
    page_ids: frozenset[str] = frozenset()
    refs: list[DatasetRef] = field(default_factory=list)

    def list_bound_notion_page_ids(self, dataset_ref: DatasetRef) -> frozenset[str]:
        self.refs.append(dataset_ref)
        return self.page_ids


@dataclass
class NotionSourceStub:
    workspaces: tuple[NotionWorkspace, ...] = ()
    list_calls: list[tuple[str, str, str]] = field(default_factory=list)
    preview_calls: list[tuple[str, str, str, str, str]] = field(default_factory=list)

    def list_authorized_pages(
        self, *, workspace_id: str, actor_id: str, credential_id: str
    ) -> tuple[NotionWorkspace, ...]:
        self.list_calls.append((workspace_id, actor_id, credential_id))
        return self.workspaces

    def preview_page(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        page_id: str,
        page_type: NotionPageType,
    ) -> str:
        self.preview_calls.append((workspace_id, actor_id, credential_id, page_id, page_type))
        return "preview"


def _service(
    *,
    access: DatasetAccessStub | None = None,
    datasets: NotionDatasetReaderStub | None = None,
    documents: DocumentBindingReaderStub | None = None,
    source: NotionSourceStub | None = None,
) -> NotionImportApplicationService:
    return NotionImportApplicationService(
        dataset_access=access or DatasetAccessStub(),
        datasets=datasets or NotionDatasetReaderStub(),
        documents=documents or DocumentBindingReaderStub(),
        source=source or NotionSourceStub(),
    )


def test_list_pages_preserves_workspaces_and_marks_bound_pages() -> None:
    page_1 = AuthorizedNotionPage("page-1", "One", None, None, NotionPageType.PAGE)
    page_2 = AuthorizedNotionPage("page-2", "Two", None, "page-1", NotionPageType.PAGE)
    source = NotionSourceStub(
        workspaces=(
            NotionWorkspace("notion-workspace-1", "First", None, (page_1,)),
            NotionWorkspace("notion-workspace-2", "Second", None, (page_2,)),
        )
    )
    documents = DocumentBindingReaderStub(page_ids=frozenset({"page-2"}))

    result = _service(documents=documents, source=source).list_pages(
        _context(), credential_id="credential-1", dataset_id="dataset-1"
    )

    assert [workspace.workspace_id for workspace in result.workspaces] == [
        "notion-workspace-1",
        "notion-workspace-2",
    ]
    assert result.workspaces[0].pages[0].is_bound is False
    assert result.workspaces[1].pages[0].is_bound is True
    assert documents.refs == [DatasetRef("workspace-1", "dataset-1")]
    assert source.list_calls == [("workspace-1", "account-1", "credential-1")]


def test_list_pages_without_dataset_does_not_read_document_bindings() -> None:
    access = DatasetAccessStub()
    documents = DocumentBindingReaderStub()

    _service(access=access, documents=documents).list_pages(_context(), credential_id="credential-1")

    assert access.calls == []
    assert documents.refs == []


def test_list_pages_rejects_non_notion_dataset_before_external_call() -> None:
    datasets = NotionDatasetReaderStub(is_notion=False)
    source = NotionSourceStub()

    with pytest.raises(DatasetIsNotNotionSourceError):
        _service(datasets=datasets, source=source).list_pages(
            _context(), credential_id="credential-1", dataset_id="dataset-1"
        )

    assert datasets.refs == [DatasetRef("workspace-1", "dataset-1")]
    assert source.list_calls == []


def test_preview_passes_explicit_actor_and_workspace() -> None:
    source = NotionSourceStub()

    content = _service(source=source).preview_page(
        _context(), credential_id="credential-1", page_id="page-1", page_type=NotionPageType.PAGE
    )

    assert content == "preview"
    assert source.preview_calls == [("workspace-1", "account-1", "credential-1", "page-1", "page")]
