from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch

import pytest

from core.datasource.entities.datasource_entities import (
    OnlineDocumentInfo,
    OnlineDocumentPage,
    OnlineDocumentPagesMessage,
    OnlineDriveBrowseFilesResponse,
    OnlineDriveFile,
    OnlineDriveFileBucket,
)
from models.account import Account
from services.knowledge_fs.initial_source_preview import KnowledgeFSInitialSourcePreviewService
from services.knowledge_fs.product_dto import KnowledgeFSInitialSourcePreviewPayload

_CREDENTIAL = object()


def _service(credential=_CREDENTIAL) -> tuple[KnowledgeFSInitialSourcePreviewService, MagicMock]:
    session = MagicMock()
    session.scalar.return_value = credential
    context = MagicMock()
    context.__enter__.return_value = session
    return KnowledgeFSInitialSourcePreviewService(MagicMock(return_value=context)), session


def _payload(kind: str) -> KnowledgeFSInitialSourcePreviewPayload:
    return KnowledgeFSInitialSourcePreviewPayload.model_validate(
        {
            "credentialId": "credential-1",
            "datasource": "pages" if kind == "online_document" else "drive",
            "kind": kind,
            "parameters": {},
            "pluginId": "langgenius/provider",
            "provider": "provider",
        }
    )


def test_preview_lists_online_documents_with_stable_import_identity() -> None:
    service, _session = _service()
    runtime = MagicMock()
    runtime.datasource_provider_type.return_value = "online_document"
    runtime.get_online_document_pages.return_value = [
        OnlineDocumentPagesMessage(
            result=[
                OnlineDocumentInfo(
                    pages=[
                        OnlineDocumentPage(
                            last_edited_time="2026-08-10T00:00:00Z",
                            page_id="page-1",
                            page_name="Roadmap",
                            parent_id=None,
                            type="page",
                        )
                    ],
                    total=1,
                    workspace_id="workspace-1",
                    workspace_name="Product",
                )
            ]
        )
    ]
    with (
        patch(
            "services.knowledge_fs.initial_source_preview.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "secret"},
        ),
        patch(
            "services.knowledge_fs.initial_source_preview.DatasourceManager.get_datasource_runtime",
            return_value=runtime,
        ),
    ):
        response = service.preview(
            tenant_id="tenant-1",
            account=cast(Account, SimpleNamespace(id="account-1")),
            payload=_payload("online_document"),
        )

    assert response.kind == "online_document"
    assert response.documents[0].provider_item_id == '["workspace-1","page-1"]'
    assert response.documents[0].name == "Roadmap"
    assert response.files == []
    assert runtime.runtime.credentials == {"token": "secret"}


def test_preview_browses_online_drive_and_preserves_pagination() -> None:
    service, _session = _service()
    runtime = MagicMock()
    runtime.datasource_provider_type.return_value = "online_drive"
    runtime.online_drive_browse_files.return_value = [
        OnlineDriveBrowseFilesResponse(
            result=[
                OnlineDriveFileBucket(
                    bucket="manuals",
                    files=[
                        OnlineDriveFile(
                            id="file-1",
                            name="Plan.pdf",
                            size=128,
                            type="application/pdf",
                        )
                    ],
                    is_truncated=True,
                    next_page_parameters={"cursor": "next"},
                )
            ]
        )
    ]
    payload = _payload("online_drive")
    payload.parameters = {"prefix": "folder-1"}
    with (
        patch(
            "services.knowledge_fs.initial_source_preview.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "secret"},
        ),
        patch(
            "services.knowledge_fs.initial_source_preview.DatasourceManager.get_datasource_runtime",
            return_value=runtime,
        ),
    ):
        response = service.preview(
            tenant_id="tenant-1",
            account=cast(Account, SimpleNamespace(id="account-1")),
            payload=payload,
        )

    assert response.kind == "online_drive"
    assert response.files[0].provider_item_id == '["manuals","file-1"]'
    assert response.files[0].mime_type == "application/pdf"
    assert response.next_page_parameters == {"cursor": "next"}
    request = runtime.online_drive_browse_files.call_args.kwargs["request"]
    assert request.prefix == "folder-1"


def test_preview_exposes_an_empty_drive_bucket_as_a_browsable_container() -> None:
    service, _session = _service()
    runtime = MagicMock()
    runtime.datasource_provider_type.return_value = "online_drive"
    runtime.online_drive_browse_files.return_value = [
        OnlineDriveBrowseFilesResponse(
            result=[OnlineDriveFileBucket(bucket="manuals", files=[], is_truncated=False)]
        )
    ]
    with (
        patch(
            "services.knowledge_fs.initial_source_preview.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "secret"},
        ),
        patch(
            "services.knowledge_fs.initial_source_preview.DatasourceManager.get_datasource_runtime",
            return_value=runtime,
        ),
    ):
        response = service.preview(
            tenant_id="tenant-1",
            account=cast(Account, SimpleNamespace(id="account-1")),
            payload=_payload("online_drive"),
        )

    assert response.files[0].bucket == "manuals"
    assert response.files[0].id == ""
    assert response.files[0].provider_item_id == '["manuals",""]'
    assert response.files[0].type == "bucket"


def test_preview_rejects_a_credential_hidden_from_the_account() -> None:
    service, _session = _service(credential=None)
    with (
        patch(
            "services.knowledge_fs.initial_source_preview.DatasourceProviderService.get_datasource_credentials"
        ) as get_credentials,
        pytest.raises(PermissionError, match="credential is unavailable"),
    ):
        service.preview(
            tenant_id="tenant-1",
            account=cast(Account, SimpleNamespace(id="account-1")),
            payload=_payload("online_document"),
        )

    get_credentials.assert_not_called()
