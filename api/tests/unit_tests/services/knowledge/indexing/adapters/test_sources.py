from collections.abc import Sequence
from dataclasses import dataclass, field

import pytest

from core.rag.extractor.notion_extractor import NotionExtractor
from services.credentials.refresh import CredentialRefreshUnavailableError
from services.data_source.credential_gateway import (
    DatasourceCredentialNotFoundError,
    DatasourceCredentialRefreshError,
)
from services.data_source.entities.notion_import import NotionPageType
from services.data_source.website_crawl_cache import website_crawl_provider_instance_id
from services.extraction.contracts import DatasourceType, UploadFileExtractionInput
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.adapters.sources import (
    CompositeStoredSourceResolver,
    FileSourceAdapter,
    NotionSourceResolver,
    WebsiteSourceAdapter,
)
from services.knowledge.indexing.contracts import StoredSource
from services.knowledge.indexing.errors import (
    IndexingInputSourceError,
    SourceCredentialUnavailableError,
    UnsupportedStoredSourceError,
)
from tests.helpers.unit.config_override import apply_config_overrides


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
                "provider_instance_id": website_crawl_provider_instance_id(provider="firecrawl"),
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
    assert website_extraction.website_info.job_ref.tenant_id == "workspace-1"
    assert website_extraction.website_info.only_main_content is True
    assert notion_extraction.notion_info is not None
    assert notion_extraction.notion_info.notion_access_token == "stored-secret"


@pytest.mark.parametrize("mode", ["crawl", "scrape"])
def test_stored_jina_single_page_source_accepts_empty_job_id(mode: str) -> None:
    resolver = CompositeStoredSourceResolver(adapters={"website_crawl": WebsiteSourceAdapter()})

    extraction = resolver.resolve(
        _source(
            "website_crawl",
            {
                "provider": "jinareader",
                "provider_instance_id": website_crawl_provider_instance_id(provider="jinareader"),
                "job_id": "",
                "url": "https://example.com/single-page",
                "mode": mode,
            },
        )
    )

    assert extraction.website_info is not None
    assert extraction.website_info.job_ref.provider == "jinareader"
    assert extraction.website_info.job_ref.job_id == ""
    assert extraction.website_info.mode == mode


@pytest.mark.parametrize("provider", ["firecrawl", "watercrawl"])
def test_async_website_crawl_source_still_requires_job_id(provider: str) -> None:
    resolver = CompositeStoredSourceResolver(adapters={"website_crawl": WebsiteSourceAdapter()})

    with pytest.raises(IndexingInputSourceError, match="job_id"):
        resolver.resolve(
            _source(
                "website_crawl",
                {
                    "provider": provider,
                    "job_id": "",
                    "url": "https://example.com",
                    "mode": "crawl",
                },
            )
        )


@pytest.mark.parametrize(
    ("provider", "mode", "field"),
    [("unknown", "crawl", "provider"), ("jinareader", "unknown", "mode")],
)
def test_stored_website_source_rejects_unsupported_provider_or_mode(provider: str, mode: str, field: str) -> None:
    resolver = CompositeStoredSourceResolver(adapters={"website_crawl": WebsiteSourceAdapter()})

    with pytest.raises(IndexingInputSourceError, match=field):
        resolver.resolve(
            _source(
                "website_crawl",
                {
                    "provider": provider,
                    "job_id": "job-1",
                    "url": "https://example.com",
                    "mode": mode,
                },
            )
        )


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


@pytest.mark.parametrize(
    ("credential_id", "credentials", "error", "expected_token"),
    [
        (None, {"integration_secret": "default-secret"}, None, "environment-secret"),
        ("credential-1", {"integration_secret": "saved-secret"}, None, "saved-secret"),
        ("deleted-credential", {}, DatasourceCredentialNotFoundError(), None),
        ("credential-1", {}, DatasourceCredentialRefreshError("credential-1"), None),
        ("credential-1", {}, CredentialRefreshUnavailableError(), None),
        ("credential-1", {}, ValueError("decrypt failed"), None),
        ("credential-1", {}, None, None),
        ("credential-1", {"integration_secret": ""}, None, None),
        ("credential-1", {"integration_secret": 42}, None, None),
        ("", {}, None, None),
    ],
    ids=[
        "legacy",
        "saved",
        "deleted",
        "refresh-failed",
        "refresh-unavailable",
        "decrypt-failed",
        "missing-token",
        "empty-token",
        "invalid-token",
        "explicit-empty-id",
    ],
)
@pytest.mark.parametrize("integration_token", ["environment-secret", None, ""])
def test_stored_notion_preview_and_indexing_fall_back_only_for_legacy_sources(
    monkeypatch: pytest.MonkeyPatch,
    credential_id: str | None,
    credentials: dict[str, object],
    error: Exception | None,
    expected_token: str | None,
    integration_token: str | None,
) -> None:
    apply_config_overrides(monkeypatch, NOTION_INTEGRATION_TOKEN=integration_token)
    stored = RecordingStoredCredentials(credentials, error=error)
    resolver = _notion_resolver(stored=stored)
    source_info: dict[str, object] = {
        "notion_workspace_id": "notion-workspace-1",
        "notion_page_id": "notion-page-1",
        "type": "page",
    }
    if credential_id is not None:
        source_info["credential_id"] = credential_id
    source = _source("notion_import", source_info)

    if isinstance(error, CredentialRefreshUnavailableError):
        with pytest.raises(CredentialRefreshUnavailableError):
            resolver.resolve(source)
    elif expected_token is None or (credential_id is None and not integration_token):
        with pytest.raises(SourceCredentialUnavailableError):
            resolver.resolve(source)
    else:
        resolved = resolver.resolve(source)
        assert resolved.notion_info is not None
        token = resolved.notion_info.notion_access_token
        assert isinstance(token, str)
        assert token == expected_token
        extractor = NotionExtractor(
            notion_obj_id=resolved.notion_info.notion_obj_id,
            notion_page_type=resolved.notion_info.notion_page_type,
            notion_access_token=token,
        )
        assert extractor._notion_access_token == expected_token

    expected_ids: list[str] = [credential_id] if credential_id is not None else []
    assert [call["credential_id"] for call in stored.calls] == expected_ids


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


@pytest.mark.parametrize("credential_id", [None, 42])
def test_stored_notion_explicit_invalid_credential_id_cannot_use_legacy_fallback(credential_id: object) -> None:
    stored = RecordingStoredCredentials({"integration_secret": "stored-secret"})
    resolver = _notion_resolver(stored=stored, integration_token="environment-secret")

    with pytest.raises(SourceCredentialUnavailableError):
        resolver.resolve(
            _source(
                "notion_import",
                {
                    "credential_id": credential_id,
                    "notion_workspace_id": "notion-workspace-1",
                    "notion_page_id": "notion-page-1",
                    "type": "page",
                },
            )
        )

    assert stored.calls == []


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
