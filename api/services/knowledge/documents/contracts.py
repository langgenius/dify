"""Shared document-domain values independent of use-case implementations."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, Protocol

from core.rag.retrieval.retrieval_methods import RetrievalMethod
from enums.knowledge import ProcessRuleMode
from services.knowledge.entities.model_configuration import DatasetModelConfiguration, EmbeddingModelConfiguration

DOCUMENT_METADATA_SCHEMA: Mapping[str, Mapping[str, type]] = {
    "book": {
        "title": str,
        "language": str,
        "author": str,
        "publisher": str,
        "publication_date": str,
        "isbn": str,
        "category": str,
    },
    "web_page": {
        "title": str,
        "url": str,
        "language": str,
        "publish_date": str,
        "author/publisher": str,
        "topic/keywords": str,
        "description": str,
    },
    "paper": {
        "title": str,
        "language": str,
        "author": str,
        "publish_date": str,
        "journal/conference_name": str,
        "volume/issue/page_numbers": str,
        "doi": str,
        "topic/keywords": str,
        "abstract": str,
    },
    "social_media_post": {
        "platform": str,
        "author/username": str,
        "publish_date": str,
        "post_url": str,
        "topic/tags": str,
    },
    "wikipedia_entry": {
        "title": str,
        "language": str,
        "web_page_url": str,
        "last_edit_date": str,
        "editor/contributor": str,
        "summary/introduction": str,
    },
    "personal_document": {
        "title": str,
        "author": str,
        "creation_date": str,
        "last_modified_date": str,
        "document_type": str,
        "tags/category": str,
    },
    "business_document": {
        "title": str,
        "author": str,
        "creation_date": str,
        "last_modified_date": str,
        "document_type": str,
        "department/team": str,
    },
    "im_chat_log": {
        "chat_platform": str,
        "chat_participants/group_name": str,
        "start_date": str,
        "end_date": str,
        "summary": str,
    },
    "synced_from_notion": {
        "title": str,
        "language": str,
        "author/creator": str,
        "creation_date": str,
        "last_modified_date": str,
        "notion_page_link": str,
        "category/tags": str,
        "description": str,
    },
    "synced_from_github": {
        "repository_name": str,
        "repository_description": str,
        "repository_owner/organization": str,
        "code_filename": str,
        "code_file_path": str,
        "programming_language": str,
        "github_link": str,
        "open_source_license": str,
        "commit_date": str,
        "commit_author": str,
    },
    "others": {},
}


@dataclass(frozen=True)
class DocumentListFilter:
    page: int = 1
    limit: int = 20
    search: str = ""
    sort: str = "-created_at"
    status: str | None = None
    fetch: bool = False


@dataclass(frozen=True)
class DocumentState:
    id: str
    archived: bool
    indexing_status: str
    is_paused: bool
    data_source_type: str
    doc_form: str
    need_summary: bool
    enabled: bool = True
    indexing_retry_action: Literal["retry", "enable", "disable", "archive"] | None = None


@dataclass(frozen=True)
class DocumentZip:
    path: str
    filename: str


@dataclass(frozen=True)
class DocumentCreationDefaults:
    provider: str
    chunk_structure: str | None
    indexing_technique: str | None


@dataclass(frozen=True)
class DocumentCreationDataset:
    tenant_id: str
    indexing_technique: str | None
    embedding_model: str | None
    embedding_model_provider: str | None


@dataclass(frozen=True)
class DocumentSummaryConfiguration:
    indexing_technique: str | None
    enabled: bool


@dataclass(frozen=True)
class DocumentCreationLimits:
    """Billing and deployment values needed by document-creation policy."""

    enabled: bool
    sandbox: bool
    batch_upload_limit: int
    upload_quota_limit: int
    upload_quota_size: int


@dataclass(frozen=True)
class DocumentCreationEnvironment:
    """Stable external snapshot used for one document-creation request."""

    limits: DocumentCreationLimits
    priority_indexing: bool
    initial_permission: str


DocumentSourceType = Literal["upload_file", "notion_import", "website_crawl"]


@dataclass(frozen=True)
class DocumentWriteNotionPage:
    page_id: str
    page_name: str
    page_icon: dict[str, object] | None
    type: str


@dataclass(frozen=True)
class DocumentWriteNotionSource:
    credential_id: str
    workspace_id: str
    pages: tuple[DocumentWriteNotionPage, ...]


@dataclass(frozen=True)
class DocumentWriteWebsiteSource:
    provider: str
    job_id: str
    urls: tuple[str, ...]
    only_main_content: bool


@dataclass(frozen=True)
class DocumentWriteSource:
    data_source_type: DocumentSourceType
    file_ids: tuple[str, ...] = ()
    notion_sources: tuple[DocumentWriteNotionSource, ...] = ()
    website_source: DocumentWriteWebsiteSource | None = None


@dataclass(frozen=True)
class DocumentWriteProcessRule:
    mode: ProcessRuleMode
    rules_json: str | None


@dataclass(frozen=True)
class DocumentWriteConfig:
    """Validated, persistence-ready document creation command."""

    original_document_id: str | None
    duplicate: bool
    indexing_technique: Literal["high_quality", "economy"]
    data_source: DocumentWriteSource | None
    process_rule: DocumentWriteProcessRule | None
    retrieval_model: dict[str, object] | None
    summary_index_setting: dict[str, object] | None
    doc_form: str
    doc_language: str
    embedding_model: str | None
    embedding_model_provider: str | None
    name: str | None
    is_multimodal: bool


@dataclass(frozen=True)
class DocumentSourceProjection:
    """Persistence-ready values derived from one validated source item."""

    data_source_type: DocumentSourceType
    data_source_info: dict[str, object]
    name: str


@dataclass(frozen=True)
class InitializedDatasetIdentity:
    """Dataset display values derived from its first persisted document."""

    name: str
    description: str


def build_initial_retrieval_model(config: DocumentWriteConfig) -> dict[str, object]:
    """Resolve the first high-quality dataset's retrieval settings."""

    if config.retrieval_model is not None:
        return dict(config.retrieval_model)
    return {
        "search_method": RetrievalMethod.SEMANTIC_SEARCH,
        "reranking_enable": False,
        "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
        "top_k": 4,
        "score_threshold_enabled": False,
    }


def build_upload_document_source(*, file_id: str, filename: str) -> DocumentSourceProjection:
    return DocumentSourceProjection(
        data_source_type="upload_file",
        data_source_info={"upload_file_id": file_id},
        name=filename,
    )


def build_notion_document_source(
    notion: DocumentWriteNotionSource, page: DocumentWriteNotionPage
) -> DocumentSourceProjection:
    return DocumentSourceProjection(
        data_source_type="notion_import",
        data_source_info={
            "credential_id": notion.credential_id,
            "notion_workspace_id": notion.workspace_id,
            "notion_page_id": page.page_id,
            "notion_page_icon": page.page_icon,
            "type": page.type,
        },
        name=page.page_name[:255] if page.page_name else "nopagename",
    )


def build_website_document_source(website: DocumentWriteWebsiteSource, url: str) -> DocumentSourceProjection:
    return DocumentSourceProjection(
        data_source_type="website_crawl",
        data_source_info={
            "url": url,
            "provider": website.provider,
            "job_id": website.job_id,
            "only_main_content": website.only_main_content,
            "mode": "crawl",
        },
        name=url[:200] + "..." if len(url) > 255 else url,
    )


def build_initialized_dataset_identity(document_name: str) -> InitializedDatasetIdentity:
    return InitializedDatasetIdentity(
        name=document_name[:18] + "...",
        description="useful for when you want to answer queries about the " + document_name,
    )


class DocumentCreationGateway(Protocol):
    """External values and model checks required by document creation."""

    def load_environment(self, tenant_id: str) -> DocumentCreationEnvironment: ...

    def resolve_default_embedding_model(self, tenant_id: str) -> EmbeddingModelConfiguration: ...

    def validate_dataset_model(self, dataset: DocumentCreationDataset) -> None: ...


class DocumentCreationModelGateway(Protocol):
    """Subset of model configuration required by the creation adapter."""

    def resolve_default_embedding_model(self, *, tenant_id: str) -> EmbeddingModelConfiguration: ...

    def validate_dataset_model(
        self, *, configuration: DatasetModelConfiguration, dataset_unavailable: bool = True
    ) -> None: ...


class DocumentPersistenceError(Exception):
    """Base error raised by the document persistence adapter."""


class DocumentPersistenceDatasetNotFoundError(DocumentPersistenceError):
    pass


class DocumentPersistenceNotFoundError(DocumentPersistenceError):
    pass


class DocumentSourceFileNotFoundError(DocumentPersistenceError):
    pass


class DocumentPersistenceInvalidStateError(DocumentPersistenceError):
    pass


class DocumentPersistenceArchivedError(DocumentPersistenceInvalidStateError):
    """The document became archived while a write command was acquiring its lock."""


class DocumentIndexingExecutionClaimLostError(DocumentPersistenceError):
    """A pipeline worker no longer owns the durable document execution claim."""


DocumentStatusAction = Literal["enable", "disable", "archive", "un_archive"]


@dataclass(frozen=True)
class DocumentStatusMutation:
    """Committed status changes whose compatibility cache can be refreshed."""

    indexing_document_ids: tuple[str, ...] = ()
