"""Application service for listing and previewing importable Notion pages."""

from typing import Protocol

from core.rag.extractor.entity.datasource_type import NotionPageType
from machinery.context import RequestContext
from services.entities.data_source.notion_import import (
    NotionImportPage,
    NotionImportResult,
    NotionImportWorkspace,
    NotionWorkspace,
)
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.resource_scope import DatasetRef


class NotionDocumentBindingReader(Protocol):
    def list_bound_notion_page_ids(self, dataset_ref: DatasetRef) -> frozenset[str]: ...


class NotionDatasetReader(Protocol):
    def is_notion_dataset(self, dataset_ref: DatasetRef) -> bool: ...


class NotionSourceGateway(Protocol):
    def list_authorized_pages(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
    ) -> tuple[NotionWorkspace, ...]: ...

    def preview_page(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        page_id: str,
        page_type: NotionPageType,
    ) -> str: ...


class NotionImportError(Exception):
    """Base class for framework-neutral Notion import failures."""


class DatasetIsNotNotionSourceError(NotionImportError):
    def __init__(self) -> None:
        super().__init__("Dataset is not notion type")


class NotionImportCredentialUnavailableError(NotionImportError):
    def __init__(self) -> None:
        super().__init__("Notion credential is unavailable")


class NotionImportApplicationService:
    def __init__(
        self,
        *,
        dataset_access: DatasetAccess,
        datasets: NotionDatasetReader,
        documents: NotionDocumentBindingReader,
        source: NotionSourceGateway,
    ) -> None:
        self._dataset_access = dataset_access
        self._datasets = datasets
        self._documents = documents
        self._source = source

    def list_pages(
        self,
        context: RequestContext,
        *,
        credential_id: str,
        dataset_id: str | None = None,
    ) -> NotionImportResult:
        bound_page_ids: frozenset[str] = frozenset()
        if dataset_id is not None:
            dataset = self._dataset_access.require_accessible(context, dataset_id)
            dataset_ref = DatasetRef(dataset.workspace_id, dataset.id)
            if not self._datasets.is_notion_dataset(dataset_ref):
                raise DatasetIsNotNotionSourceError()
            bound_page_ids = self._documents.list_bound_notion_page_ids(dataset_ref)

        workspaces = self._source.list_authorized_pages(
            workspace_id=context.active_workspace_id,
            actor_id=context.account_id,
            credential_id=credential_id,
        )
        return NotionImportResult(
            workspaces=tuple(
                NotionImportWorkspace(
                    workspace_id=workspace.workspace_id,
                    workspace_name=workspace.workspace_name,
                    workspace_icon=workspace.workspace_icon,
                    pages=tuple(
                        NotionImportPage(
                            page_id=page.page_id,
                            page_name=page.page_name,
                            page_icon=page.page_icon,
                            parent_id=page.parent_id,
                            page_type=page.page_type,
                            is_bound=page.page_id in bound_page_ids,
                        )
                        for page in workspace.pages
                    ),
                )
                for workspace in workspaces
            )
        )

    def preview_page(
        self,
        context: RequestContext,
        *,
        credential_id: str,
        page_id: str,
        page_type: NotionPageType,
    ) -> str:
        return self._source.preview_page(
            workspace_id=context.active_workspace_id,
            actor_id=context.account_id,
            credential_id=credential_id,
            page_id=page_id,
            page_type=page_type,
        )
