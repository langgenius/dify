"""Shared document-domain values independent of use-case implementations."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from core.rag.retrieval.retrieval_methods import RetrievalMethod
from enums.knowledge import ProcessRuleMode
from services.knowledge.entities.model_configuration import DatasetModelConfiguration, EmbeddingModelConfiguration
from services.knowledge.entities.resource_scope import DatasetRef

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


@dataclass(frozen=True, slots=True)
class DocumentSourceFileProjection:
    id: str
    name: str
    size: int
    extension: str
    mime_type: str | None
    created_by: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class DocumentMetadataProjection:
    id: str
    name: str
    type: str


@dataclass(frozen=True, slots=True)
class DocumentProcessRuleProjection:
    id: str
    dataset_id: str
    mode: str
    rules: Mapping[str, object] | None


@dataclass(frozen=True, slots=True)
class DocumentReadProjection:
    id: str
    tenant_id: str
    dataset_id: str
    position: int
    data_source_type: str
    data_source_info: Mapping[str, object]
    dataset_process_rule_id: str | None
    name: str
    created_from: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    tokens: int | None
    indexing_status: str
    error: str | None
    enabled: bool
    disabled_at: datetime | None
    disabled_by: str | None
    archived: bool
    display_status: str
    word_count: int | None
    doc_form: str
    need_summary: bool
    completed_segments: int | None
    total_segments: int | None
    summary_index_status: str | None
    hit_count: int
    source_file: DocumentSourceFileProjection | None
    metadata: tuple[DocumentMetadataProjection, ...]
    doc_metadata: Mapping[str, object]
    built_in_enabled: bool
    uploader_name: str | None
    process_rule: DocumentProcessRuleProjection | None


@dataclass(frozen=True, slots=True)
class DocumentPageProjection:
    documents: tuple[DocumentReadProjection, ...]
    has_more: bool
    limit: int
    total: int
    page: int


@dataclass(frozen=True, slots=True)
class DocumentDatasetProjection:
    id: str
    name: str
    description: str | None
    permission: str
    data_source_type: str | None
    indexing_technique: str | None
    created_by: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class DocumentCreationProjection:
    dataset: DocumentDatasetProjection
    documents: tuple[DocumentReadProjection, ...]
    batch: str


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
    data_source_info: Mapping[str, object] | None = None


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
class DocumentCleanupJob:
    document_id: str
    dataset_id: str
    doc_form: str
    file_id: str | None = None


@dataclass(frozen=True)
class DocumentBatchCleanupJob:
    document_ids: tuple[str, ...]
    dataset_id: str
    doc_form: str
    file_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class DocumentRetryBatch:
    """Documents admitted by one locked retry state transition."""

    document_ids: tuple[str, ...]
    started_at: datetime


@dataclass(frozen=True)
class DocumentIndexingJobs:
    """Post-commit work produced while persisting one document command."""

    dataset: DatasetRef
    created: tuple[str, ...] = ()
    duplicated: tuple[str, ...] = ()
    removed_notion_cleanup: DocumentBatchCleanupJob | None = None
    updated: str | None = None


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
    provider_instance_id: str
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
            "provider_instance_id": website.provider_instance_id,
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


DocumentStatusAction = Literal["enable", "disable", "archive", "un_archive"]
UnchangedNotionSyncOutcome = Literal["completed", "requires_indexing", "stale"]


@dataclass(frozen=True)
class DocumentStatusRollback:
    """Previous state used to conditionally compensate one failed task dispatch."""

    document_id: str
    applied_updated_at: datetime
    applied_enabled: bool
    applied_disabled_at: datetime | None
    applied_disabled_by: str | None
    applied_archived: bool
    applied_archived_at: datetime | None
    applied_archived_by: str | None
    enabled: bool
    disabled_at: datetime | None
    disabled_by: str | None
    archived: bool
    archived_at: datetime | None
    archived_by: str | None
    updated_at: datetime


@dataclass(frozen=True)
class DocumentStatusMutation:
    """Committed status changes whose compatibility cache can be refreshed."""

    indexing_document_ids: tuple[str, ...] = ()
    rollbacks: tuple[DocumentStatusRollback, ...] = ()
