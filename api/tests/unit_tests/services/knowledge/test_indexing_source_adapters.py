from collections.abc import Sequence
from dataclasses import dataclass, field

import pytest

from core.rag.entities.extraction import UploadFileExtractionInput
from core.rag.extractor.entity.datasource_type import DatasourceType, NotionPageType
from services.data_source.credential_gateway import (
    DatasourceCredentialNotFoundError,
    DatasourceCredentialRefreshError,
)
from services.knowledge.indexing.adapters.sources import (
    CompositeStoredSourceResolver,
    FileSourceAdapter,
    NotionSourceResolver,
    WebsiteSourceAdapter,
)
from services.knowledge.indexing.errors import IndexingInputSourceError, UnsupportedStoredSourceError
from services.knowledge.indexing.estimate import StoredSource
from services.knowledge.resource_scope import DatasetRef


def _source(
    source_type: str,
    source_info: dict[str, object] | None,
    *,
    document_id: str = "document-1",
) -> StoredSource:
    return StoredSource(
        document_ref=DatasetRef("workspace-1", "dataset-1").document(document_id),
        source_type=source_type,
        source_info=source_info,
        document_model="text_model",
    )


@dataclass
class RecordingUploads:
    uploads: dict[str, UploadFileExtractionInput]
    calls: list[tuple[str, tuple[str, ...]]] = field(default_factory=list)

    def get_by_ids(self, *, workspace_id: str, file_ids: Sequence[str]) -> dict[str, UploadFileExtractionInput]:
        self.calls.append((workspace_id, tuple(file_ids)))
        return {file_id: self.uploads[file_id] for file_id in file_ids if file_id in self.uploads}


@dataclass
class RecordingActorCredentials:
    credentials: dict[str, object] | None = None
    error: Exception | None = None
    calls: list[dict[str, object]] = field(default_factory=list)

    def resolve(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.credentials or {}


@dataclass
class RecordingStoredCredentials:
    credentials: dict[str, object] | None = None
    error: Exception | None = None
    calls: list[dict[str, object]] = field(default_factory=list)

    def resolve_for_document(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.credentials or {}


@dataclass
class MissingSelectedStoredCredentials:
    calls: list[dict[str, object]] = field(default_factory=list)

    def resolve_for_document(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        if kwargs["credential_id"] is not None:
            raise DatasourceCredentialNotFoundError()
        return {"integration_secret": "default-secret"}


def _notion_resolver(
    *,
    actor: RecordingActorCredentials | None = None,
    stored: RecordingStoredCredentials | None = None,
    integration_token: str | None = None,
) -> NotionSourceResolver:
    return NotionSourceResolver(
        actor_credentials=actor or RecordingActorCredentials({"integration_secret": "actor-secret"}),
        stored_credentials=stored or RecordingStoredCredentials({"integration_secret": "stored-secret"}),
        integration_token=integration_token,
    )


def test_datasource_adapters_resolve_file_website_and_notion_inputs() -> None:
    upload = UploadFileExtractionInput(
        id="file-1",
        tenant_id="workspace-1",
        key="file.txt",
        created_by="account-1",
    )
    uploads = RecordingUploads({upload.id: upload})
    notion = _notion_resolver()
    resolver = CompositeStoredSourceResolver(
        adapters={
            "upload_file": FileSourceAdapter(uploads=uploads),
            "website_crawl": WebsiteSourceAdapter(),
            "notion_import": notion,
        }
    )

    file_extraction = resolver.resolve(
        _source("upload_file", {"upload_file_id": upload.id}),
    )
    website_extraction = resolver.resolve(
        _source(
            "website_crawl",
            {
                "provider": "firecrawl",
                "job_id": "job-1",
                "url": "https://example.com",
                "mode": "crawl",
                "only_main_content": True,
            },
        ),
    )
    notion_extraction = resolver.resolve(
        _source(
            "notion_import",
            {
                "credential_id": "credential-1",
                "notion_workspace_id": "notion-workspace-1",
                "notion_page_id": "notion-page-1",
                "type": "page",
            },
        ),
    )

    assert file_extraction.datasource_type == DatasourceType.FILE
    assert file_extraction.upload_file == upload
    assert uploads.calls == [("workspace-1", ("file-1",))]
    assert website_extraction.website_info is not None
    assert website_extraction.website_info.tenant_id == "workspace-1"
    assert website_extraction.website_info.only_main_content is True
    assert notion_extraction.notion_info is not None
    assert notion_extraction.notion_info.notion_access_token == "stored-secret"


def test_stored_notion_resolution_uses_trusted_document_owner_chain() -> None:
    actor = RecordingActorCredentials({"integration_secret": "actor-secret"})
    stored = RecordingStoredCredentials({"integration_secret": "stored-secret"})
    resolver = _notion_resolver(actor=actor, stored=stored)

    extraction = resolver.resolve(
        _source(
            "notion_import",
            {
                "credential_id": "private-credential",
                "notion_workspace_id": "notion-workspace-1",
                "notion_page_id": "notion-page-1",
                "type": "database",
            },
        ),
    )

    assert actor.calls == []
    assert stored.calls == [
        {
            "workspace_id": "workspace-1",
            "dataset_id": "dataset-1",
            "document_id": "document-1",
            "credential_id": "private-credential",
            "provider": "notion_datasource",
            "plugin_id": "langgenius/notion_datasource",
        }
    ]
    assert extraction.notion_info is not None
    assert extraction.notion_info.notion_page_type == NotionPageType.DATABASE.value


def test_legacy_notion_document_requests_tenant_default_credential() -> None:
    stored = RecordingStoredCredentials({"integration_secret": "default-secret"})
    resolver = _notion_resolver(stored=stored)

    resolver.resolve(
        _source(
            "notion_import",
            {
                "notion_workspace_id": "notion-workspace-1",
                "notion_page_id": "notion-page-1",
                "type": "page",
            },
        ),
    )

    assert stored.calls[0]["credential_id"] is None


def test_missing_stored_notion_credential_falls_back_to_tenant_default() -> None:
    stored = MissingSelectedStoredCredentials()
    resolver = NotionSourceResolver(
        actor_credentials=RecordingActorCredentials(),
        stored_credentials=stored,
    )

    extraction = resolver.resolve(
        _source(
            "notion_import",
            {
                "credential_id": "deleted-credential",
                "notion_workspace_id": "notion-workspace-1",
                "notion_page_id": "notion-page-1",
                "type": "page",
            },
        ),
    )

    assert [call["credential_id"] for call in stored.calls] == ["deleted-credential", None]
    assert extraction.notion_info is not None
    assert extraction.notion_info.notion_access_token == "default-secret"


def test_stored_notion_refresh_failure_does_not_switch_integration_identity() -> None:
    stored = RecordingStoredCredentials(error=DatasourceCredentialRefreshError("credential-1"))
    resolver = _notion_resolver(stored=stored, integration_token="environment-secret")

    with pytest.raises(DatasourceCredentialRefreshError):
        resolver.resolve(
            _source(
                "notion_import",
                {
                    "credential_id": "credential-1",
                    "notion_workspace_id": "notion-workspace-1",
                    "notion_page_id": "notion-page-1",
                    "type": "page",
                },
            ),
        )

    assert [call["credential_id"] for call in stored.calls] == ["credential-1"]


def test_notion_resolution_falls_back_to_configured_integration_token() -> None:
    stored = RecordingStoredCredentials(error=DatasourceCredentialNotFoundError())
    resolver = _notion_resolver(stored=stored, integration_token="environment-secret")

    extraction = resolver.resolve(
        _source(
            "notion_import",
            {
                "notion_workspace_id": "notion-workspace-1",
                "notion_page_id": "notion-page-1",
                "type": "page",
            },
        ),
    )

    assert extraction.notion_info is not None
    assert extraction.notion_info.notion_access_token == "environment-secret"


def test_new_notion_selection_uses_actor_scoped_credential() -> None:
    actor = RecordingActorCredentials({"integration_secret": "actor-secret"})
    stored = RecordingStoredCredentials({"integration_secret": "stored-secret"})
    resolver = _notion_resolver(actor=actor, stored=stored)

    extraction = resolver.resolve_selection(
        workspace_id="workspace-1",
        actor_id="account-1",
        credential_id="credential-1",
        notion_workspace_id="notion-workspace-1",
        page_id="notion-page-1",
        page_type=NotionPageType.PAGE,
        document_model="text_model",
    )

    assert stored.calls == []
    assert actor.calls[0]["actor_id"] == "account-1"
    assert extraction.notion_info is not None
    assert extraction.notion_info.notion_access_token == "actor-secret"


def test_new_notion_selection_does_not_fall_back_when_actor_cannot_access_credential() -> None:
    actor = RecordingActorCredentials(error=DatasourceCredentialNotFoundError())
    resolver = _notion_resolver(actor=actor, integration_token="environment-secret")

    with pytest.raises(DatasourceCredentialNotFoundError):
        resolver.resolve_selection(
            workspace_id="workspace-1",
            actor_id="account-1",
            credential_id="private-credential",
            notion_workspace_id="notion-workspace-1",
            page_id="notion-page-1",
            page_type=NotionPageType.PAGE,
            document_model="text_model",
        )


def test_invalid_or_unknown_sources_are_rejected_at_the_adapter_boundary() -> None:
    resolver = CompositeStoredSourceResolver(adapters={"website_crawl": WebsiteSourceAdapter()})

    with pytest.raises(IndexingInputSourceError, match="provider"):
        resolver.resolve(
            _source("website_crawl", {"job_id": "job", "url": "url", "mode": "crawl"}),
        )
    with pytest.raises(UnsupportedStoredSourceError, match="mystery"):
        resolver.resolve(_source("mystery", {}))
