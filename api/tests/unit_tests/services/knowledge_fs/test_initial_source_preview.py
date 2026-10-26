from collections.abc import Iterator
from dataclasses import dataclass, field
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.datasource.entities.datasource_entities import (
    OnlineDocumentInfo,
    OnlineDocumentPage,
    OnlineDocumentPagesMessage,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveBrowseFilesResponse,
    OnlineDriveFile,
    OnlineDriveFileBucket,
    WebsiteCrawlMessage,
    WebSiteInfo,
    WebSiteInfoDetail,
)
from models.account import Account
from models.oauth import DatasourceProvider
from services.knowledge_fs.initial_source_preview import (
    KnowledgeFSInitialSourcePreviewCanceledError,
    KnowledgeFSInitialSourcePreviewService,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSInitialSourcePreviewPayload,
    KnowledgeFSInitialWebsiteSourcePreviewPayload,
)


def _account() -> Account:
    account = Account(name="KnowledgeFS tester", email="knowledge-fs@example.com")
    account.id = "account-1"
    return account


def _service(
    session_maker: sessionmaker[Session], *, with_credential: bool = True
) -> KnowledgeFSInitialSourcePreviewService:
    if with_credential:
        credential = DatasourceProvider(
            tenant_id="tenant-1",
            name="Credential",
            provider="provider",
            plugin_id="langgenius/provider",
            auth_type="api_key",
            encrypted_credentials={},
            user_id="account-1",
        )
        credential.id = "credential-1"
        with session_maker.begin() as session:
            session.add(credential)
    return KnowledgeFSInitialSourcePreviewService(session_maker)


@dataclass
class _PluginRuntime:
    credentials: dict[str, object] = field(default_factory=dict)


@dataclass
class FakeDatasourceRuntime:
    """Streams the configured datasource messages and records each plugin invocation."""

    provider_type: str
    messages: list[object]
    runtime: _PluginRuntime = field(default_factory=_PluginRuntime)
    online_document_calls: list[dict[str, object]] = field(default_factory=list)
    online_drive_calls: list[dict[str, object]] = field(default_factory=list)
    website_crawl_calls: list[dict[str, object]] = field(default_factory=list)

    def datasource_provider_type(self) -> str:
        return self.provider_type

    def get_online_document_pages(self, **kwargs: object) -> Iterator[object]:
        self.online_document_calls.append(kwargs)
        return iter(self.messages)

    def online_drive_browse_files(self, **kwargs: object) -> Iterator[object]:
        self.online_drive_calls.append(kwargs)
        return iter(self.messages)

    def get_website_crawl(self, **kwargs: object) -> Iterator[object]:
        self.website_crawl_calls.append(kwargs)
        return iter(self.messages)


@dataclass
class _QueuedCancellation:
    answers: list[bool]
    call_count: int = 0

    def __call__(self) -> bool:
        self.call_count += 1
        return self.answers.pop(0)


def _payload(kind: str) -> KnowledgeFSInitialSourcePreviewPayload | KnowledgeFSInitialWebsiteSourcePreviewPayload:
    payload_type = (
        KnowledgeFSInitialWebsiteSourcePreviewPayload
        if kind == "website_crawl"
        else KnowledgeFSInitialSourcePreviewPayload
    )
    return payload_type.model_validate(
        {
            "credentialId": "credential-1",
            "datasource": "pages" if kind == "online_document" else "drive",
            "kind": kind,
            "parameters": {},
            "pluginId": "langgenius/provider",
            "provider": "provider",
        }
    )


def test_preview_lists_online_documents_with_stable_import_identity(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    service = _service(sqlite_session_factory)
    runtime = FakeDatasourceRuntime(
        provider_type="online_document",
        messages=[
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
        ],
    )
    with (
        patch(
            "services.data_source.provider_service.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "secret"},
        ),
        patch(
            "services.knowledge_fs.initial_source_preview.DatasourceManager.get_datasource_runtime",
            return_value=runtime,
        ),
    ):
        response = service.preview(
            tenant_id="tenant-1",
            account=_account(),
            payload=_payload("online_document"),
        )

    assert response.kind == "online_document"
    assert response.documents[0].provider_item_id == '["workspace-1","page-1"]'
    assert response.documents[0].name == "Roadmap"
    assert response.files == []
    assert runtime.runtime.credentials == {"token": "secret"}


def test_preview_browses_online_drive_and_preserves_pagination(sqlite_session_factory: sessionmaker[Session]) -> None:
    service = _service(sqlite_session_factory)
    runtime = FakeDatasourceRuntime(
        provider_type="online_drive",
        messages=[
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
        ],
    )
    payload = _payload("online_drive")
    payload.parameters = {"prefix": "folder-1"}
    with (
        patch(
            "services.data_source.provider_service.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "secret"},
        ),
        patch(
            "services.knowledge_fs.initial_source_preview.DatasourceManager.get_datasource_runtime",
            return_value=runtime,
        ),
    ):
        response = service.preview(
            tenant_id="tenant-1",
            account=_account(),
            payload=payload,
        )

    assert response.kind == "online_drive"
    assert response.files[0].provider_item_id == '["manuals","file-1"]'
    assert response.files[0].mime_type == "application/pdf"
    assert response.next_page_parameters == {"cursor": "next"}
    request = runtime.online_drive_calls[-1]["request"]
    assert isinstance(request, OnlineDriveBrowseFilesRequest)
    assert request.prefix == "folder-1"


def test_preview_crawls_a_website_with_exact_declared_parameters(sqlite_session_factory: sessionmaker[Session]) -> None:
    service = _service(sqlite_session_factory)
    runtime = FakeDatasourceRuntime(
        provider_type="website_crawl",
        messages=[
            WebsiteCrawlMessage(
                result=WebSiteInfo(
                    status="completed",
                    web_info_list=[
                        WebSiteInfoDetail(
                            content="# Result",
                            description="Search result",
                            source_url="https://example.com/result",
                            title="Result",
                        )
                    ],
                )
            )
        ],
    )
    payload = _payload("website_crawl")
    payload.parameters = {"query": "agentic RAG", "search_depth": "advanced"}
    account = _account()
    with (
        patch(
            "services.data_source.provider_service.DatasourceProviderService.get_datasource_credentials",
            return_value={"api_key": "secret"},
        ) as get_credentials,
        patch(
            "services.knowledge_fs.initial_source_preview.DatasourceManager.get_datasource_runtime",
            return_value=runtime,
        ),
    ):
        response = service.preview(
            tenant_id="tenant-1",
            account=account,
            payload=payload,
        )

    assert response.kind == "website_crawl"
    assert response.pages[0].source_url == "https://example.com/result"
    get_credentials.assert_called_once_with(
        tenant_id="tenant-1",
        provider="provider",
        plugin_id="langgenius/provider",
        credential_id="credential-1",
        current_user=account,
    )
    assert runtime.website_crawl_calls == [
        {
            "user_id": "account-1",
            "datasource_parameters": {"query": "agentic RAG", "search_depth": "advanced"},
            "provider_type": "website_crawl",
        }
    ]


def test_preview_stops_consuming_website_results_after_cancellation(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    service = _service(sqlite_session_factory)
    runtime = FakeDatasourceRuntime(
        provider_type="website_crawl",
        messages=[WebsiteCrawlMessage(result=WebSiteInfo(status="running", web_info_list=[]))],
    )
    is_canceled = _QueuedCancellation(answers=[False, True])
    with (
        patch(
            "services.data_source.provider_service.DatasourceProviderService.get_datasource_credentials",
            return_value={"api_key": "secret"},
        ),
        patch(
            "services.knowledge_fs.initial_source_preview.DatasourceManager.get_datasource_runtime",
            return_value=runtime,
        ),
        pytest.raises(KnowledgeFSInitialSourcePreviewCanceledError),
    ):
        service.preview(
            tenant_id="tenant-1",
            account=_account(),
            payload=_payload("website_crawl"),
            is_canceled=is_canceled,
        )

    assert is_canceled.call_count == 2


def test_preview_exposes_an_empty_drive_bucket_as_a_browsable_container(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    service = _service(sqlite_session_factory)
    runtime = FakeDatasourceRuntime(
        provider_type="online_drive",
        messages=[
            OnlineDriveBrowseFilesResponse(
                result=[OnlineDriveFileBucket(bucket="manuals", files=[], is_truncated=False)]
            )
        ],
    )
    with (
        patch(
            "services.data_source.provider_service.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "secret"},
        ),
        patch(
            "services.knowledge_fs.initial_source_preview.DatasourceManager.get_datasource_runtime",
            return_value=runtime,
        ),
    ):
        response = service.preview(
            tenant_id="tenant-1",
            account=_account(),
            payload=_payload("online_drive"),
        )

    assert response.files[0].bucket == "manuals"
    assert response.files[0].id == ""
    assert response.files[0].provider_item_id == '["manuals",""]'
    assert response.files[0].type == "bucket"


def test_preview_rejects_a_credential_hidden_from_the_account(sqlite_session_factory: sessionmaker[Session]) -> None:
    service = _service(sqlite_session_factory, with_credential=False)
    with (
        patch(
            "services.data_source.provider_service.DatasourceProviderService.get_datasource_credentials"
        ) as get_credentials,
        pytest.raises(PermissionError, match="credential is unavailable"),
    ):
        service.preview(
            tenant_id="tenant-1",
            account=_account(),
            payload=_payload("online_document"),
        )

    get_credentials.assert_not_called()
