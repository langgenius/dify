"""Typed product and BFF DTOs independent from Dify Dataset/Document models."""

from __future__ import annotations

import math
import re
from datetime import UTC, datetime
from typing import Annotated, ClassVar, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, JsonValue, RootModel, field_validator, model_validator

from fields.base import ResponseModel
from models.knowledge_fs import (
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpaceState,
    KnowledgeFSControlSpaceVisibility,
)
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission

KnowledgeFSIconIdentity = Annotated[
    str,
    Field(max_length=72, pattern=r"^(?:builtin:)?[+a-z0-9_-]{1,64}$"),
]


class KnowledgeFSModelIntent(BaseModel):
    plugin_id: str = Field(
        min_length=1,
        max_length=255,
        validation_alias=AliasChoices("plugin_id", "pluginId"),
        serialization_alias="pluginId",
    )
    provider: str = Field(min_length=1, max_length=255)
    model: str = Field(min_length=1, max_length=255)

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)


class KnowledgeFSRerankIntent(BaseModel):
    enabled: bool
    model: KnowledgeFSModelIntent | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_enabled_model(self) -> KnowledgeFSRerankIntent:
        if not self.enabled or self.model is None:
            raise ValueError("Knowledge-space retrieval requires an enabled rerank model")
        return self


class KnowledgeFSScoreThresholdIntent(BaseModel):
    enabled: bool
    stage: Literal["mode-final", "rerank"] = "mode-final"
    value: float | None = Field(default=None, ge=0, le=1)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_enabled_value(self) -> KnowledgeFSScoreThresholdIntent:
        if self.enabled and self.value is None:
            raise ValueError("Enabled score threshold requires a value")
        return self


class KnowledgeFSRetrievalProfileIntent(BaseModel):
    default_mode: Literal["fast", "research", "deep"] = Field(
        validation_alias=AliasChoices("default_mode", "defaultMode"),
        serialization_alias="defaultMode",
    )
    reasoning_model: KnowledgeFSModelIntent = Field(
        validation_alias=AliasChoices("reasoning_model", "reasoningModel"),
        serialization_alias="reasoningModel",
    )
    rerank: KnowledgeFSRerankIntent
    score_threshold: KnowledgeFSScoreThresholdIntent = Field(
        validation_alias=AliasChoices("score_threshold", "scoreThreshold"),
        serialization_alias="scoreThreshold",
    )
    top_k: int = Field(
        ge=1,
        le=100,
        validation_alias=AliasChoices("top_k", "topK"),
        serialization_alias="topK",
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)

    @model_validator(mode="after")
    def validate_mode_threshold(self) -> KnowledgeFSRetrievalProfileIntent:
        if self.default_mode != "research" and self.score_threshold.enabled and not self.rerank.enabled:
            raise ValueError("Fast/Deep mode-final score threshold requires rerank")
        return self


class KnowledgeFSInitialWebsiteCrawlOptionsPayload(BaseModel):
    include_subpages: bool = True
    limit: int = Field(default=100, ge=1, le=200)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSInitialWebsiteSelectionPayload(BaseModel):
    source_url: str = Field(min_length=1, max_length=4_096)
    title: str | None = Field(default=None, max_length=500)

    model_config = ConfigDict(extra="forbid")

    @field_validator("source_url")
    @classmethod
    def normalize_source_url(cls, source_url: str) -> str:
        return source_url.strip()


class KnowledgeFSOnlineDocumentWorkflowImportItemPayload(BaseModel):
    etag: str | None = Field(default=None, max_length=1_024)
    last_edited_time: str | None = Field(default=None, max_length=128, alias="lastEditedTime")
    name: str | None = Field(default=None, max_length=500)
    page_id: str = Field(min_length=1, max_length=1_024, alias="pageId")
    provider_item_id: str = Field(min_length=1, max_length=1_024, alias="providerItemId")
    type: str = Field(min_length=1, max_length=128)
    workspace_id: str = Field(min_length=1, max_length=1_024, alias="workspaceId")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSOnlineDriveWorkflowImportItemPayload(BaseModel):
    bucket: str | None = Field(default=None, max_length=1_024)
    etag: str | None = Field(default=None, max_length=1_024)
    id: str = Field(min_length=1, max_length=1_024)
    mime_type: str | None = Field(default=None, max_length=255, alias="mimeType")
    name: str = Field(min_length=1, max_length=500)
    provider_item_id: str = Field(min_length=1, max_length=1_024, alias="providerItemId")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSInitialSyncPolicyPayload(BaseModel):
    custom_interval_seconds: int | None = Field(default=None, ge=3_600, le=2_592_000)
    sync_policy: Literal["provider", "daily", "manual", "custom"] = "provider"

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_custom_interval(self) -> KnowledgeFSInitialSyncPolicyPayload:
        if self.sync_policy == "custom" and self.custom_interval_seconds is None:
            raise ValueError("custom_interval_seconds is required for a custom sync policy")
        if self.sync_policy != "custom" and self.custom_interval_seconds is not None:
            raise ValueError("custom_interval_seconds is only valid for a custom sync policy")
        return self


class KnowledgeFSInitialDatasourceBindingPayload(BaseModel):
    credential_id: str = Field(min_length=1, max_length=255, alias="credentialId")
    datasource: str = Field(min_length=1, max_length=255)
    plugin_id: str = Field(min_length=1, max_length=255, alias="pluginId")
    provider: str = Field(min_length=1, max_length=255)
    provider_display_name: str | None = Field(default=None, min_length=1, max_length=255, alias="providerDisplayName")
    parameters: dict[str, JsonValue] = Field(default_factory=dict, max_length=50)

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSInitialDatasourceSourcePayload(
    KnowledgeFSInitialDatasourceBindingPayload, KnowledgeFSInitialSyncPolicyPayload
):
    pass


class KnowledgeFSInitialWebsiteSourcePayload(KnowledgeFSInitialSyncPolicyPayload):
    kind: Literal["website_crawl"]
    name: str = Field(min_length=1, max_length=200)
    provider: str = Field(min_length=1, max_length=255)
    plugin_id: str | None = Field(default=None, min_length=1, max_length=255, alias="pluginId")
    datasource: str = Field(default="crawl", min_length=1, max_length=255)
    credential_id: str | None = Field(default=None, min_length=1, max_length=255, alias="credentialId")
    provider_display_name: str | None = Field(default=None, min_length=1, max_length=255, alias="providerDisplayName")
    parameters: dict[str, JsonValue] = Field(default_factory=dict, max_length=50)
    root_url: str = Field(min_length=1, max_length=4_096)
    crawl_options: KnowledgeFSInitialWebsiteCrawlOptionsPayload
    selection: list[KnowledgeFSInitialWebsiteSelectionPayload] = Field(min_length=1, max_length=200)
    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)

    @model_validator(mode="after")
    def validate_selection(self) -> KnowledgeFSInitialWebsiteSourcePayload:
        source_urls = [item.source_url for item in self.selection]
        if len(set(source_urls)) != len(source_urls):
            raise ValueError("initial website selection URLs must be unique")
        return self


class KnowledgeFSInitialOnlineDocumentSourcePayload(KnowledgeFSInitialDatasourceSourcePayload):
    kind: Literal["online_document"]
    name: str = Field(min_length=1, max_length=200)
    selection: list[KnowledgeFSOnlineDocumentWorkflowImportItemPayload] = Field(min_length=1, max_length=200)


class KnowledgeFSInitialOnlineDriveSourcePayload(KnowledgeFSInitialDatasourceSourcePayload):
    kind: Literal["online_drive"]
    name: str = Field(min_length=1, max_length=200)
    selection: list[KnowledgeFSOnlineDriveWorkflowImportItemPayload] = Field(min_length=1, max_length=200)


class KnowledgeFSInitialSourcePreviewPayload(KnowledgeFSInitialDatasourceBindingPayload):
    kind: Literal["online_document", "online_drive"]


class KnowledgeFSInitialWebsiteSourcePreviewPayload(KnowledgeFSInitialDatasourceBindingPayload):
    kind: Literal["website_crawl"]


class KnowledgeFSInitialSourcePreviewPageResponse(ResponseModel):
    description: str | None = None
    source_url: str = Field(validation_alias=AliasChoices("source_url", "sourceUrl"))
    title: str | None = None


class KnowledgeFSInitialSourcePreviewDocumentResponse(ResponseModel):
    last_edited_time: str | None = Field(
        default=None, validation_alias=AliasChoices("last_edited_time", "lastEditedTime")
    )
    name: str
    page_id: str = Field(validation_alias=AliasChoices("page_id", "pageId"))
    provider_item_id: str = Field(validation_alias=AliasChoices("provider_item_id", "providerItemId"))
    type: str
    workspace_id: str = Field(validation_alias=AliasChoices("workspace_id", "workspaceId"))
    workspace_name: str | None = Field(default=None, validation_alias=AliasChoices("workspace_name", "workspaceName"))


class KnowledgeFSInitialSourcePreviewFileResponse(ResponseModel):
    bucket: str | None = None
    id: str
    mime_type: str | None = Field(default=None, validation_alias=AliasChoices("mime_type", "mimeType"))
    name: str
    provider_item_id: str = Field(validation_alias=AliasChoices("provider_item_id", "providerItemId"))
    size: int = Field(ge=0)
    type: str


class KnowledgeFSInitialSourcePreviewResponse(ResponseModel):
    documents: list[KnowledgeFSInitialSourcePreviewDocumentResponse] = Field(default_factory=list)
    files: list[KnowledgeFSInitialSourcePreviewFileResponse] = Field(default_factory=list)
    kind: Literal["online_document", "online_drive", "website_crawl"]
    next_page_parameters: dict[str, JsonValue] | None = Field(
        default=None,
        validation_alias=AliasChoices("next_page_parameters", "nextPageParameters"),
    )
    pages: list[KnowledgeFSInitialSourcePreviewPageResponse] = Field(default_factory=list)


class KnowledgeFSInitialSourcePreviewJobCreateResponse(ResponseModel):
    job_id: str = Field(validation_alias=AliasChoices("job_id", "jobId"))
    status: Literal["pending"] = "pending"


class KnowledgeFSInitialSourcePreviewJobResponse(ResponseModel):
    job_id: str = Field(validation_alias=AliasChoices("job_id", "jobId"))
    result: KnowledgeFSInitialSourcePreviewResponse | None = None
    status: Literal["pending", "running", "completed", "failed", "canceled"]


KnowledgeFSInitialSourcePayload = Annotated[
    KnowledgeFSInitialWebsiteSourcePayload
    | KnowledgeFSInitialOnlineDocumentSourcePayload
    | KnowledgeFSInitialOnlineDriveSourcePayload,
    Field(discriminator="kind"),
]


class KnowledgeFSSpaceCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    slug: str = Field(min_length=1, max_length=160, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    icon: KnowledgeFSIconIdentity | None = None
    description: str | None = Field(default=None, max_length=2_000)
    visibility: KnowledgeFSControlSpaceVisibility = KnowledgeFSControlSpaceVisibility.ONLY_ME
    embedding: KnowledgeFSModelIntent | None = None
    retrieval: KnowledgeFSRetrievalProfileIntent | None = None
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=255)
    initial_source: KnowledgeFSInitialSourcePayload | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_initial_model_configuration(self) -> KnowledgeFSSpaceCreatePayload:
        if self.retrieval is not None and self.embedding is None:
            raise ValueError("Knowledge-space retrieval requires an embedding model")
        return self


class KnowledgeFSSpaceUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    icon: KnowledgeFSIconIdentity | None = None
    description: str | None = Field(default=None, max_length=2_000)
    visibility: KnowledgeFSControlSpaceVisibility | None = None

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSSpaceListQuery(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)
    query: str | None = Field(default=None, max_length=255)
    creator_ids: list[Annotated[str, Field(min_length=1, max_length=255)]] | None = Field(
        default=None,
        max_length=100,
        description="Filter by creator account IDs",
    )

    model_config = ConfigDict(extra="forbid")

    @field_validator("creator_ids")
    @classmethod
    def normalize_creator_ids(cls, value: list[str] | None) -> list[str] | None:
        return value or None

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str | None) -> str | None:
        normalized = value.strip() if value is not None else ""
        return normalized or None


class KnowledgeFSCursorQuery(BaseModel):
    cursor: str | None = Field(default=None, min_length=1, max_length=1_000)

    model_config = ConfigDict(extra="forbid")


type KnowledgeFSConsistencyClass = Literal[
    "path-consistent",
    "snapshot-consistent",
    "cache-consistent",
    "eventual-preview",
]
type KnowledgeFSResourceType = Literal["source", "document", "node", "artifact", "evidence", "workspace"]

KNOWLEDGE_FS_PATH_PATTERN = r"^/(?:sources|knowledge|evidence|workspaces)(?:/[^/\s]+)*$"


class KnowledgeFSListQuery(BaseModel):
    path: str = Field(min_length=1, max_length=4_096, pattern=KNOWLEDGE_FS_PATH_PATTERN)
    limit: int = Field(default=20, ge=1, le=100)
    cursor: str | None = Field(default=None, min_length=1, max_length=8_192)
    consistency_class: KnowledgeFSConsistencyClass | None = None

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSTreeQuery(KnowledgeFSListQuery):
    depth: int | None = Field(default=None, ge=1, le=8)


class KnowledgeFSGrepQuery(KnowledgeFSListQuery):
    query: str = Field(min_length=1, max_length=4_000)
    timeout_ms: int | None = Field(default=None, ge=1, le=10_000)

    @field_validator("query", mode="before")
    @classmethod
    def normalize_query(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class KnowledgeFSFindQuery(KnowledgeFSListQuery):
    metadata_key: str | None = Field(default=None, min_length=1, max_length=120)
    metadata_value: str | None = Field(default=None, min_length=1, max_length=4_000)
    name_contains: str | None = Field(default=None, min_length=1, max_length=240)
    resource_type: KnowledgeFSResourceType | None = None


class KnowledgeFSCatQuery(BaseModel):
    path: str = Field(min_length=1, max_length=4_096, pattern=KNOWLEDGE_FS_PATH_PATTERN)
    cursor: str | None = Field(default=None, min_length=1, max_length=8_192)
    limit: int | None = Field(default=None, ge=1, le=100)
    consistency_class: KnowledgeFSConsistencyClass | None = None

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSStatQuery(BaseModel):
    path: str = Field(min_length=1, max_length=4_096, pattern=KNOWLEDGE_FS_PATH_PATTERN)
    consistency_class: KnowledgeFSConsistencyClass | None = None

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSDiffQuery(BaseModel):
    old_path: str = Field(min_length=1, max_length=4_096, pattern=KNOWLEDGE_FS_PATH_PATTERN)
    new_path: str = Field(min_length=1, max_length=4_096, pattern=KNOWLEDGE_FS_PATH_PATTERN)
    mode: Literal["line", "word"] | None = None
    semantic: bool | None = None
    consistency_class: KnowledgeFSConsistencyClass | None = None

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSEntryResponse(ResponseModel):
    kind: Literal["directory", "resource"]
    metadata: dict[str, JsonValue]
    name: str
    path: str
    resource_type: KnowledgeFSResourceType | None = Field(
        default=None, validation_alias=AliasChoices("resource_type", "resourceType")
    )
    target_id: str | None = Field(default=None, validation_alias=AliasChoices("target_id", "targetId"))
    version: int | None = Field(default=None, ge=1)


class KnowledgeFSListResponse(ResponseModel):
    consistency_class: KnowledgeFSConsistencyClass | None = Field(
        default=None, validation_alias=AliasChoices("consistency_class", "consistencyClass")
    )
    items: list[KnowledgeFSEntryResponse]
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))
    path: str
    preview: bool | None = None
    truncated: bool


class KnowledgeFSTreeNodeResponse(KnowledgeFSEntryResponse):
    children: list[KnowledgeFSTreeNodeResponse] | None = None


class KnowledgeFSTreeResponse(ResponseModel):
    consistency_class: KnowledgeFSConsistencyClass | None = Field(
        default=None, validation_alias=AliasChoices("consistency_class", "consistencyClass")
    )
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))
    path: str
    preview: bool | None = None
    root: KnowledgeFSTreeNodeResponse
    truncated: bool


class KnowledgeFSGrepMatchResponse(ResponseModel):
    end_offset: int = Field(ge=0, validation_alias=AliasChoices("end_offset", "endOffset"))
    kind: Literal["node", "segment"]
    metadata: dict[str, JsonValue]
    node_id: str | None = Field(default=None, validation_alias=AliasChoices("node_id", "nodeId"))
    path: str
    segment_id: str | None = Field(default=None, validation_alias=AliasChoices("segment_id", "segmentId"))
    snippet: str
    start_offset: int = Field(ge=0, validation_alias=AliasChoices("start_offset", "startOffset"))


class KnowledgeFSGrepResponse(ResponseModel):
    matches: list[KnowledgeFSGrepMatchResponse]
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))
    path: str
    truncated: bool


class KnowledgeFSDiffOperationResponse(ResponseModel):
    kind: Literal["equal", "insert", "delete"]
    new_end: int | None = Field(default=None, ge=1, validation_alias=AliasChoices("new_end", "newEnd"))
    new_start: int | None = Field(default=None, ge=1, validation_alias=AliasChoices("new_start", "newStart"))
    old_end: int | None = Field(default=None, ge=1, validation_alias=AliasChoices("old_end", "oldEnd"))
    old_start: int | None = Field(default=None, ge=1, validation_alias=AliasChoices("old_start", "oldStart"))
    text: str


class KnowledgeFSSemanticDiffChangeResponse(ResponseModel):
    category: str
    evidence: list[str]
    summary: str


class KnowledgeFSSemanticDiffResponse(ResponseModel):
    changes: list[KnowledgeFSSemanticDiffChangeResponse]
    metadata: dict[str, JsonValue]
    model: str | None = None
    summary: str


class KnowledgeFSDiffStatsResponse(ResponseModel):
    delete: int = Field(ge=0)
    equal: int = Field(ge=0)
    insert: int = Field(ge=0)


class KnowledgeFSDiffResponse(ResponseModel):
    mode: Literal["line", "word"]
    new_path: str = Field(validation_alias=AliasChoices("new_path", "newPath"))
    old_path: str = Field(validation_alias=AliasChoices("old_path", "oldPath"))
    operations: list[KnowledgeFSDiffOperationResponse]
    semantic: KnowledgeFSSemanticDiffResponse | None = None
    stats: KnowledgeFSDiffStatsResponse


class KnowledgeFSCatResponse(ResponseModel):
    content_type: str = Field(validation_alias=AliasChoices("content_type", "contentType"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))
    path: str
    text: str
    truncated: bool


class KnowledgeFSStatResponse(ResponseModel):
    consistency_class: KnowledgeFSConsistencyClass | None = Field(
        default=None, validation_alias=AliasChoices("consistency_class", "consistencyClass")
    )
    content_type: str | None = Field(default=None, validation_alias=AliasChoices("content_type", "contentType"))
    metadata: dict[str, JsonValue]
    parser_status: Literal["pending", "parsed", "failed"] | None = Field(
        default=None, validation_alias=AliasChoices("parser_status", "parserStatus")
    )
    path: str
    resource_type: KnowledgeFSResourceType = Field(validation_alias=AliasChoices("resource_type", "resourceType"))
    sha256: str | None = None
    size_bytes: int | None = Field(default=None, ge=0, validation_alias=AliasChoices("size_bytes", "sizeBytes"))
    target_id: str = Field(validation_alias=AliasChoices("target_id", "targetId"))
    preview: bool | None = None
    version: int | None = Field(default=None, ge=1)


class KnowledgeFSQualityListQuery(KnowledgeFSCursorQuery):
    limit: int = Field(default=50, ge=1, le=100)


class KnowledgeFSSourceListQuery(KnowledgeFSCursorQuery):
    limit: int = Field(default=50, ge=1, le=200)


class KnowledgeFSBackgroundTaskListQuery(BaseModel):
    cursor: str | None = Field(default=None, min_length=1, max_length=8_192)
    limit: int = Field(default=50, ge=1, le=100)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSOverviewWindowQuery(BaseModel):
    window: Literal["24h", "7d", "30d"] = "24h"

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSIdempotencyHeader(BaseModel):
    idempotency_key: str = Field(
        min_length=8,
        max_length=255,
        validation_alias=AliasChoices("Idempotency-Key", "idempotency-key", "idempotency_key"),
    )

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSTechnicalSummary(BaseModel):
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    revision: int = Field(ge=0)
    name: str
    slug: str
    icon: str | None = None
    description: str | None = None
    document_count: int = Field(
        default=0,
        ge=0,
        validation_alias=AliasChoices("document_count", "documentCount"),
    )
    index_state: str | None = Field(default=None, validation_alias=AliasChoices("index_state", "indexState"))
    model_profile: dict[str, object] | None = Field(
        default=None,
        validation_alias=AliasChoices("model_profile", "modelProfile"),
    )
    last_job_state: str | None = Field(
        default=None,
        validation_alias=AliasChoices("last_job_state", "lastJobState"),
    )

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSBatchTechnicalSummaryResponse(BaseModel):
    items: list[KnowledgeFSTechnicalSummary] = Field(max_length=100)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSOverviewStatsWindowResponse(ResponseModel):
    answer_rate: float = Field(ge=0, le=1, validation_alias=AliasChoices("answer_rate", "answerRate"))
    answered_query_count: int = Field(
        ge=0,
        validation_alias=AliasChoices("answered_query_count", "answeredQueryCount"),
    )
    query_count: int = Field(ge=0, validation_alias=AliasChoices("query_count", "queryCount"))
    since: datetime


class KnowledgeFSOverviewStatsCurrentResponse(ResponseModel):
    fresh_source_count: int = Field(
        ge=0,
        validation_alias=AliasChoices("fresh_source_count", "freshSourceCount"),
    )
    knowledge_count: int = Field(
        ge=0,
        validation_alias=AliasChoices("knowledge_count", "knowledgeCount"),
    )
    latest_source_sync_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("latest_source_sync_at", "latestSourceSyncAt"),
    )
    linked_app_count: int = Field(
        ge=0,
        validation_alias=AliasChoices("linked_app_count", "linkedAppCount"),
    )
    source_count: int = Field(ge=0, validation_alias=AliasChoices("source_count", "sourceCount"))
    stale_source_count: int = Field(
        ge=0,
        validation_alias=AliasChoices("stale_source_count", "staleSourceCount"),
    )


class KnowledgeFSOverviewBaseStatsResponse(ResponseModel):
    current: KnowledgeFSOverviewStatsCurrentResponse
    generated_at: datetime = Field(validation_alias=AliasChoices("generated_at", "generatedAt"))
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    windows: dict[Literal["24h", "7d", "30d"], KnowledgeFSOverviewStatsWindowResponse]


class KnowledgeFSOverviewQueryOutcomeCountsResponse(ResponseModel):
    answer_rate: float = Field(ge=0, le=1, validation_alias=AliasChoices("answer_rate", "answerRate"))
    answered: int = Field(ge=0)
    low_confidence: int = Field(
        ge=0,
        validation_alias=AliasChoices("low_confidence", "lowConfidence"),
    )
    no_evidence: int = Field(ge=0, validation_alias=AliasChoices("no_evidence", "noEvidence"))
    query_count: int = Field(ge=0, validation_alias=AliasChoices("query_count", "queryCount"))


class KnowledgeFSOverviewQueryOutcomeBucketResponse(ResponseModel):
    answered: int = Field(ge=0)
    end_at: datetime = Field(validation_alias=AliasChoices("end_at", "endAt"))
    low_confidence: int = Field(
        ge=0,
        validation_alias=AliasChoices("low_confidence", "lowConfidence"),
    )
    no_evidence: int = Field(ge=0, validation_alias=AliasChoices("no_evidence", "noEvidence"))
    query_count: int = Field(ge=0, validation_alias=AliasChoices("query_count", "queryCount"))
    start_at: datetime = Field(validation_alias=AliasChoices("start_at", "startAt"))


class KnowledgeFSOverviewQueryOutcomesResponse(ResponseModel):
    buckets: list[KnowledgeFSOverviewQueryOutcomeBucketResponse]
    current: KnowledgeFSOverviewQueryOutcomeCountsResponse
    generated_at: datetime = Field(validation_alias=AliasChoices("generated_at", "generatedAt"))
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    previous: KnowledgeFSOverviewQueryOutcomeCountsResponse
    previous_since: datetime = Field(validation_alias=AliasChoices("previous_since", "previousSince"))
    since: datetime
    window: Literal["24h", "7d", "30d"]


class KnowledgeFSOverviewSourceCategoriesResponse(ResponseModel):
    crawl: int = Field(ge=0)
    online_documents: int = Field(
        ge=0,
        validation_alias=AliasChoices("online_documents", "onlineDocuments"),
    )
    online_drives: int = Field(
        ge=0,
        validation_alias=AliasChoices("online_drives", "onlineDrives"),
    )
    uploads: int = Field(ge=0)


class KnowledgeFSOverviewInventoryDeltaResponse(ResponseModel):
    added_last_7d: int = Field(
        ge=0,
        validation_alias=AliasChoices("added_last_7d", "addedLast7d"),
    )
    total: int = Field(ge=0)


class KnowledgeFSOverviewIndexCoverageResponse(ResponseModel):
    indexed: int = Field(ge=0)
    percentage: float = Field(ge=0, le=100)
    total: int = Field(ge=0)


class KnowledgeFSOverviewInventoryResponse(ResponseModel):
    generated_at: datetime = Field(validation_alias=AliasChoices("generated_at", "generatedAt"))
    graph_entities: KnowledgeFSOverviewInventoryDeltaResponse = Field(
        validation_alias=AliasChoices("graph_entities", "graphEntities")
    )
    graph_relations: KnowledgeFSOverviewInventoryDeltaResponse = Field(
        validation_alias=AliasChoices("graph_relations", "graphRelations")
    )
    index_coverage: KnowledgeFSOverviewIndexCoverageResponse = Field(
        validation_alias=AliasChoices("index_coverage", "indexCoverage")
    )
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    source_categories: KnowledgeFSOverviewSourceCategoriesResponse = Field(
        validation_alias=AliasChoices("source_categories", "sourceCategories")
    )


class KnowledgeFSOverviewHealthComponentResponse(ResponseModel):
    codes: list[str]
    state: Literal["healthy", "degraded", "unavailable", "unknown"]


class KnowledgeFSOverviewHealthComponentsResponse(ResponseModel):
    index: KnowledgeFSOverviewHealthComponentResponse
    ingestion: KnowledgeFSOverviewHealthComponentResponse
    profile_publication: KnowledgeFSOverviewHealthComponentResponse = Field(
        validation_alias=AliasChoices("profile_publication", "profilePublication")
    )
    query_availability: KnowledgeFSOverviewHealthComponentResponse = Field(
        validation_alias=AliasChoices("query_availability", "queryAvailability")
    )
    source_freshness: KnowledgeFSOverviewHealthComponentResponse = Field(
        validation_alias=AliasChoices("source_freshness", "sourceFreshness")
    )
    worker_readiness: KnowledgeFSOverviewHealthComponentResponse = Field(
        validation_alias=AliasChoices("worker_readiness", "workerReadiness")
    )


class KnowledgeFSOverviewHealthResponse(ResponseModel):
    components: KnowledgeFSOverviewHealthComponentsResponse
    generated_at: datetime = Field(validation_alias=AliasChoices("generated_at", "generatedAt"))
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    state: Literal["healthy", "degraded", "unavailable", "unknown"]


class KnowledgeFSOverviewAttentionListQuery(BaseModel):
    include_dismissed: bool = False
    limit: int = Field(default=50, ge=1, le=100)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSOverviewAttentionActionResponse(ResponseModel):
    kind: Literal["open-resource", "review-permissions", "review-models"]
    resource_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("resource_id", "resourceId"),
    )
    resource_type: Literal["knowledge-space", "document", "source", "failed-query"] = Field(
        validation_alias=AliasChoices("resource_type", "resourceType")
    )


class KnowledgeFSOverviewAttentionEvidenceResponse(ResponseModel):
    code: str
    observed_at: datetime = Field(validation_alias=AliasChoices("observed_at", "observedAt"))
    value: float | str | None = None


class KnowledgeFSOverviewAttentionResourceResponse(ResponseModel):
    id: str
    type: Literal["knowledge-space", "document", "source", "failed-query"]


class KnowledgeFSOverviewAttentionResponse(ResponseModel):
    action: KnowledgeFSOverviewAttentionActionResponse
    dismissed_until: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("dismissed_until", "dismissedUntil"),
    )
    evidence: list[KnowledgeFSOverviewAttentionEvidenceResponse]
    issue_key: str = Field(validation_alias=AliasChoices("issue_key", "issueKey"))
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    resource: KnowledgeFSOverviewAttentionResourceResponse
    revision: int = Field(ge=1)
    rule_id: Literal[
        "stale-source",
        "failed-document",
        "low-quality-query",
        "permission-readiness",
        "model-readiness",
    ] = Field(validation_alias=AliasChoices("rule_id", "ruleId"))
    severity: Literal["critical", "warning", "info"]
    status: Literal["active", "dismissed", "resolved"]
    title: str
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


class KnowledgeFSOverviewAttentionListResponse(ResponseModel):
    data: list[KnowledgeFSOverviewAttentionResponse] = Field(validation_alias=AliasChoices("data", "items"))


class KnowledgeFSOverviewActivityListQuery(BaseModel):
    action: (
        Literal[
            "query.requested",
            "query.completed",
            "query.failed",
            "document.published",
            "document.failed",
            "source.synced",
            "source.failed",
            "settings.updated",
            "permission.updated",
            "profile.published",
            "worker.failed",
        ]
        | None
    ) = None
    actor_id: str | None = Field(default=None, min_length=1, max_length=255)
    actor_type: Literal["member", "system"] | None = None
    cursor: str | None = Field(default=None, min_length=1, max_length=512)
    from_at: datetime | None = Field(default=None, validation_alias=AliasChoices("from_at", "from"))
    limit: int = Field(default=50, ge=1, le=100)
    resource_type: (
        Literal[
            "knowledge-space",
            "query",
            "document",
            "source",
            "permission",
            "profile",
            "publication",
            "worker",
        ]
        | None
    ) = None
    result: Literal["pending", "success", "failure", "canceled"] | None = None
    to_at: datetime | None = Field(default=None, validation_alias=AliasChoices("to_at", "to"))

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def validate_time_range(self) -> KnowledgeFSOverviewActivityListQuery:
        if self.actor_type == "system" and self.actor_id is not None:
            raise ValueError("actor_id cannot be combined with the system actor type")
        if self.from_at is not None and self.to_at is not None and self.from_at > self.to_at:
            raise ValueError("from must not be after to")
        return self


class KnowledgeFSOverviewActivityActorResponse(ResponseModel):
    id: str | None = None
    type: Literal["member", "system"]


class KnowledgeFSOverviewActivityResourceResponse(ResponseModel):
    id: str | None = None
    type: Literal[
        "knowledge-space",
        "query",
        "document",
        "source",
        "permission",
        "profile",
        "publication",
        "worker",
    ]


class KnowledgeFSOverviewActivityResponse(ResponseModel):
    action: Literal[
        "query.requested",
        "query.completed",
        "query.failed",
        "document.published",
        "document.failed",
        "source.synced",
        "source.failed",
        "settings.updated",
        "permission.updated",
        "profile.published",
        "worker.failed",
    ]
    actor: KnowledgeFSOverviewActivityActorResponse
    details: dict[str, bool | float | str]
    id: str
    occurred_at: datetime = Field(validation_alias=AliasChoices("occurred_at", "occurredAt"))
    resource: KnowledgeFSOverviewActivityResourceResponse
    result: Literal["pending", "success", "failure", "canceled"]


class KnowledgeFSOverviewActivityListResponse(ResponseModel):
    data: list[KnowledgeFSOverviewActivityResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(
        default=None,
        validation_alias=AliasChoices("next_cursor", "nextCursor"),
    )


class KnowledgeFSOverviewCountComparisonResponse(ResponseModel):
    change_rate: float | None
    previous_value: int = Field(ge=0)
    value: int = Field(ge=0)


class KnowledgeFSOverviewRateComparisonResponse(ResponseModel):
    change_percentage_points: float
    previous_value: float = Field(ge=0, le=1)
    value: float = Field(ge=0, le=1)


class KnowledgeFSOverviewStatsResponse(ResponseModel):
    answer_rate: KnowledgeFSOverviewRateComparisonResponse
    documents: int = Field(ge=0)
    fresh_source_count: int = Field(ge=0)
    freshness_seconds: int | None = Field(default=None, ge=0)
    generated_at: datetime
    knowledge_space_id: str
    latest_source_sync_at: datetime | None = None
    linked_apps: int = Field(ge=0)
    queries: KnowledgeFSOverviewCountComparisonResponse
    source_count: int = Field(ge=0)
    stale_source_count: int = Field(ge=0)
    window: Literal["24h", "7d", "30d"]


class KnowledgeFSSpaceResponse(ResponseModel):
    control_space_id: str
    created_at: datetime
    state: KnowledgeFSControlSpaceState
    visibility: KnowledgeFSControlSpaceVisibility
    owner_account_id: str
    knowledge_space_id: str | None
    resource_version: int
    permission_keys: list[KnowledgeFSProductPermission]
    technical_status: Literal["available", "not_ready", "unavailable"]
    technical_summary: KnowledgeFSTechnicalSummary | None = None
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def normalize_control_space_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class KnowledgeFSSpaceListItemResponse(KnowledgeFSSpaceResponse):
    linked_apps: int = Field(ge=0)


class KnowledgeFSSpaceListResponse(ResponseModel):
    data: list[KnowledgeFSSpaceListItemResponse]
    page: int
    limit: int
    has_more: bool


class KnowledgeFSSpaceDetailResponse(KnowledgeFSSpaceResponse):
    pass


class KnowledgeFSSpaceCreateResponse(ResponseModel):
    control_space_id: str
    state: KnowledgeFSControlSpaceState
    operation_id: str
    model_setup_required: bool


class KnowledgeFSPermissionResponse(ResponseModel):
    account_id: str
    role: KnowledgeFSControlSpacePermissionRole
    status: str
    revision: int


class KnowledgeFSPermissionListResponse(ResponseModel):
    data: list[KnowledgeFSPermissionResponse]


class KnowledgeFSMemberBindingPayload(BaseModel):
    account_id: str = Field(min_length=1)
    role: KnowledgeFSControlSpacePermissionRole

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSMembersReplacePayload(BaseModel):
    members: list[KnowledgeFSMemberBindingPayload] = Field(max_length=1_000)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSExternalAccessPayload(BaseModel):
    service_api_enabled: bool
    agent_enabled: bool
    workflow_enabled: bool
    mcp_enabled: bool = False

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSExternalAccessResponse(ResponseModel):
    service_api_enabled: bool
    agent_enabled: bool
    workflow_enabled: bool
    mcp_enabled: bool
    revision: int


class KnowledgeFSAppBindingPayload(BaseModel):
    app_id: str = Field(min_length=1)
    caller_kind: KnowledgeFSAppSpaceJoinType

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSAppBindingResponse(ResponseModel):
    id: str
    app_id: str
    caller_kind: KnowledgeFSAppSpaceJoinType
    status: KnowledgeFSAppSpaceJoinStatus
    revision: int


class KnowledgeFSAppBindingListResponse(ResponseModel):
    data: list[KnowledgeFSAppBindingResponse]


class KnowledgeFSCredentialCreatePayload(BaseModel):
    allowed_actions: list[str] = Field(min_length=1, max_length=100)
    expires_at: datetime | None = None

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSCredentialCreateResponse(ResponseModel):
    id: str
    credential: str
    credential_prefix: str
    credential_last4: str
    principal: str
    allowed_actions: list[str]
    expires_at: datetime | None


class KnowledgeFSCredentialItemResponse(ResponseModel):
    id: str
    credential_prefix: str
    credential_last4: str
    principal: str
    allowed_actions: list[str]
    status: str
    revision: int
    expires_at: datetime | None
    last_used_at: datetime | None


class KnowledgeFSCredentialListResponse(ResponseModel):
    data: list[KnowledgeFSCredentialItemResponse]


class KnowledgeFSProfileModelSelection(BaseModel):
    model: str = Field(min_length=1, max_length=256)
    plugin_id: str = Field(min_length=1, max_length=256, alias="pluginId")
    provider: str = Field(min_length=1, max_length=256)

    model_config = ConfigDict(
        extra="forbid",
        validate_by_alias=True,
        validate_by_name=True,
        serialize_by_alias=True,
    )


class KnowledgeFSProductRerankProfile(BaseModel):
    enabled: bool
    model: KnowledgeFSProfileModelSelection | None = None

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSProductScoreThreshold(BaseModel):
    enabled: bool
    stage: Literal["mode-final", "rerank"] = "mode-final"
    value: float | None = Field(default=None, ge=0, le=1)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSProductRetrievalProfile(BaseModel):
    default_mode: Literal["deep", "fast", "research"] = Field(alias="defaultMode")
    reasoning_model: KnowledgeFSProfileModelSelection = Field(alias="reasoningModel")
    rerank: KnowledgeFSProductRerankProfile
    score_threshold: KnowledgeFSProductScoreThreshold = Field(alias="scoreThreshold")
    top_k: int = Field(ge=1, le=100, alias="topK")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)

    @model_validator(mode="after")
    def validate_mode_threshold(self) -> KnowledgeFSProductRetrievalProfile:
        if self.default_mode != "research" and self.score_threshold.enabled and not self.rerank.enabled:
            raise ValueError("Fast/Deep mode-final score threshold requires rerank")
        return self


class KnowledgeFSRetrievalProfileUpdatePayload(BaseModel):
    expected_revision: int = Field(ge=0, alias="expectedRevision")
    profile: KnowledgeFSProductRetrievalProfile

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSSettingsPayload(BaseModel):
    embedding: KnowledgeFSProfileModelSelection | None = None
    retrieval: KnowledgeFSProductRetrievalProfile | None = None
    expected_revision: int = Field(ge=1, alias="expectedRevision")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)

    @model_validator(mode="after")
    def validate_setting_present(self) -> KnowledgeFSSettingsPayload:
        if self.embedding is None and self.retrieval is None:
            raise ValueError("At least one KnowledgeFS setting must be supplied")
        if self.retrieval is not None and (not self.retrieval.rerank.enabled or self.retrieval.rerank.model is None):
            raise ValueError("Knowledge-space retrieval requires an enabled rerank model")
        return self


class KnowledgeFSEmbeddingSettingsResponse(ResponseModel):
    model: str
    plugin_id: str = Field(validation_alias=AliasChoices("plugin_id", "pluginId"))
    provider: str
    dimension: int | None = Field(default=None, ge=1)
    revision: int | None = Field(default=None, ge=1)
    vector_space_id: str | None = Field(default=None, validation_alias=AliasChoices("vector_space_id", "vectorSpaceId"))


class KnowledgeFSRetrievalSettingsResponse(ResponseModel):
    default_mode: Literal["deep", "fast", "research"] = Field(
        validation_alias=AliasChoices("default_mode", "defaultMode")
    )
    reasoning_model: KnowledgeFSEmbeddingSettingsResponse = Field(
        validation_alias=AliasChoices("reasoning_model", "reasoningModel")
    )
    rerank: KnowledgeFSProductRerankProfile
    score_threshold: KnowledgeFSProductScoreThreshold = Field(
        validation_alias=AliasChoices("score_threshold", "scoreThreshold")
    )
    top_k: int = Field(ge=1, le=100, validation_alias=AliasChoices("top_k", "topK"))
    revision: int | None = Field(default=None, ge=1)


class KnowledgeFSSettingsResponse(ResponseModel):
    revision: int = Field(ge=1)
    configuration_state: Literal["active", "pending-validation", "setup-required", "validation-failed"] = Field(
        validation_alias=AliasChoices("configuration_state", "configurationState")
    )
    embedding: KnowledgeFSEmbeddingSettingsResponse | None
    retrieval: KnowledgeFSRetrievalSettingsResponse | None


class KnowledgeFSProfileMigrationResponse(ResponseModel):
    candidate_publication_fingerprint: str | None = Field(
        default=None,
        validation_alias=AliasChoices("candidate_publication_fingerprint", "candidatePublicationFingerprint"),
    )
    changed_kind: Literal["embedding", "retrieval"] = Field(
        validation_alias=AliasChoices("changed_kind", "changedKind")
    )
    checkpoint: Literal["queued", "candidate-built", "evaluated", "activated"]
    completed_at: datetime | None = Field(default=None, validation_alias=AliasChoices("completed_at", "completedAt"))
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    error_code: str | None = Field(default=None, validation_alias=AliasChoices("error_code", "errorCode"))
    evaluation_summary: dict[str, bool | float | int | str] | None = Field(
        default=None, validation_alias=AliasChoices("evaluation_summary", "evaluationSummary")
    )
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    rebuild_scope: Literal[
        "clone-publication",
        "full-page-index-summary-outline",
        "full-vector-space",
    ] = Field(validation_alias=AliasChoices("rebuild_scope", "rebuildScope"))
    run_state: Literal["queued", "running", "succeeded", "failed", "canceled"] = Field(
        validation_alias=AliasChoices("run_state", "runState")
    )
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


class KnowledgeFSSettingsUpdateResponse(ResponseModel):
    migration: KnowledgeFSProfileMigrationResponse | None = None
    settings: KnowledgeFSSettingsResponse


class KnowledgeFSDocumentCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    text: str = Field(min_length=1, max_length=1_000_000)
    idempotency_key: str = Field(min_length=1, max_length=255)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSDocumentResponse(ResponseModel):
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    filename: str
    metadata: dict[str, object]
    mime_type: str = Field(validation_alias=AliasChoices("mime_type", "mimeType"))
    object_key: str = Field(validation_alias=AliasChoices("object_key", "objectKey"))
    parser_status: Literal["pending", "parsed", "failed"] = Field(
        validation_alias=AliasChoices("parser_status", "parserStatus")
    )
    sha256: str
    size_bytes: int = Field(ge=0, validation_alias=AliasChoices("size_bytes", "sizeBytes"))
    source_id: str | None = Field(default=None, validation_alias=AliasChoices("source_id", "sourceId"))
    version: int = Field(ge=1)
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    updated_at: datetime | None = Field(default=None, validation_alias=AliasChoices("updated_at", "updatedAt"))


class KnowledgeFSDocumentUploadCompilationJobResponse(ResponseModel):
    id: str
    stage: Literal["queued"]


class KnowledgeFSDocumentUploadLogicalDocumentResponse(ResponseModel):
    id: str
    revision: int = Field(ge=1)


class KnowledgeFSDocumentUploadAcceptedResponse(ResponseModel):
    asset: KnowledgeFSDocumentResponse
    asset_status_url: str | None = Field(
        default=None, validation_alias=AliasChoices("asset_status_url", "assetStatusUrl")
    )
    compilation_job: KnowledgeFSDocumentUploadCompilationJobResponse = Field(
        validation_alias=AliasChoices("compilation_job", "compilationJob")
    )
    document_revision: int = Field(ge=1, validation_alias=AliasChoices("document_revision", "documentRevision"))
    logical_document: KnowledgeFSDocumentUploadLogicalDocumentResponse = Field(
        validation_alias=AliasChoices("logical_document", "logicalDocument")
    )
    logical_document_id: str = Field(validation_alias=AliasChoices("logical_document_id", "logicalDocumentId"))
    status: Literal["accepted"] | None = None
    status_url: str = Field(validation_alias=AliasChoices("status_url", "statusUrl"))


class KnowledgeFSStagedUploadResponse(ResponseModel):
    id: str
    file_name: str = Field(validation_alias=AliasChoices("file_name", "fileName"))
    content_type: str = Field(validation_alias=AliasChoices("content_type", "contentType"))
    size_bytes: int = Field(gt=0, validation_alias=AliasChoices("size_bytes", "sizeBytes"))
    status: Literal["uploaded", "claiming", "claimed", "failed", "aborted", "expired"]
    expires_at: datetime = Field(validation_alias=AliasChoices("expires_at", "expiresAt"))


class KnowledgeFSDocumentStagedUploadPayload(BaseModel):
    upload_id: str = Field(min_length=1, max_length=255)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSDocumentStagedUploadAcceptedResponse(ResponseModel):
    status: Literal["accepted"] = "accepted"
    upload_id: str
    document_asset_id: str
    compilation_job_id: str


class KnowledgeFSDocumentListResponse(ResponseModel):
    data: list[KnowledgeFSDocumentResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSDocumentDownloadDescriptor(ResponseModel):
    """Trusted, internal description of the active object behind a logical document."""

    document_id: str
    filename: str
    mime_type: str
    object_key: str
    sha256: str
    size_bytes: int = Field(ge=0)


class KnowledgeFSDocumentBatchDownloadPayload(BaseModel):
    document_ids: list[str] = Field(min_length=1, max_length=100)

    model_config = ConfigDict(extra="forbid")

    @field_validator("document_ids")
    @classmethod
    def validate_document_ids(cls, value: list[str]) -> list[str]:
        normalized = [document_id.strip() for document_id in value]
        if any(not document_id for document_id in normalized):
            raise ValueError("document_ids must not contain empty identifiers")
        if len(set(normalized)) != len(normalized):
            raise ValueError("document_ids must be unique")
        return normalized


class KnowledgeFSDocumentOutlineNodeResponse(ResponseModel):
    child_node_ids: list[str] = Field(
        default_factory=list, validation_alias=AliasChoices("child_node_ids", "childNodeIds")
    )
    children: list[KnowledgeFSDocumentOutlineNodeResponse] = Field(default_factory=list)
    end_offset: int | None = Field(default=None, ge=0, validation_alias=AliasChoices("end_offset", "endOffset"))
    end_page: int | None = Field(default=None, ge=1, validation_alias=AliasChoices("end_page", "endPage"))
    id: str
    level: int = Field(ge=1)
    metadata: dict[str, object]
    section_path: list[str] = Field(default_factory=list, validation_alias=AliasChoices("section_path", "sectionPath"))
    source_element_ids: list[str] = Field(
        default_factory=list, validation_alias=AliasChoices("source_element_ids", "sourceElementIds")
    )
    source_node_ids: list[str] = Field(
        default_factory=list, validation_alias=AliasChoices("source_node_ids", "sourceNodeIds")
    )
    start_offset: int | None = Field(default=None, ge=0, validation_alias=AliasChoices("start_offset", "startOffset"))
    start_page: int | None = Field(default=None, ge=1, validation_alias=AliasChoices("start_page", "startPage"))
    summary: str | None = None
    title: str
    title_location: dict[str, object] | None = Field(
        default=None, validation_alias=AliasChoices("title_location", "titleLocation")
    )
    toc_source: str = Field(validation_alias=AliasChoices("toc_source", "tocSource"))


class KnowledgeFSDocumentOutlineResponse(ResponseModel):
    artifact_hash: str = Field(validation_alias=AliasChoices("artifact_hash", "artifactHash"))
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    document_asset_id: str = Field(validation_alias=AliasChoices("document_asset_id", "documentAssetId"))
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    metadata: dict[str, object]
    nodes: list[KnowledgeFSDocumentOutlineNodeResponse]
    outline_version: str = Field(validation_alias=AliasChoices("outline_version", "outlineVersion"))
    parse_artifact_id: str = Field(validation_alias=AliasChoices("parse_artifact_id", "parseArtifactId"))
    updated_at: datetime | None = Field(default=None, validation_alias=AliasChoices("updated_at", "updatedAt"))
    version: int = Field(ge=1)


class KnowledgeFSDocumentRevisionResponse(ResponseModel):
    activated_at: datetime | None = Field(default=None, validation_alias=AliasChoices("activated_at", "activatedAt"))
    content_hash: str = Field(validation_alias=AliasChoices("content_hash", "contentHash"))
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    document_asset_id: str = Field(validation_alias=AliasChoices("document_asset_id", "documentAssetId"))
    document_asset_version: int = Field(
        ge=1, validation_alias=AliasChoices("document_asset_version", "documentAssetVersion")
    )
    document_id: str = Field(validation_alias=AliasChoices("document_id", "documentId"))
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    mime_type: str = Field(validation_alias=AliasChoices("mime_type", "mimeType"))
    revision: int = Field(ge=1)
    size_bytes: int = Field(ge=0, validation_alias=AliasChoices("size_bytes", "sizeBytes"))
    state: Literal["active", "candidate", "failed", "superseded"]


class KnowledgeFSLogicalDocumentResponse(ResponseModel):
    active: KnowledgeFSDocumentRevisionResponse | None
    active_revision: int | None = Field(
        default=None, ge=1, validation_alias=AliasChoices("active_revision", "activeRevision")
    )
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    disabled_at: datetime | None = Field(default=None, validation_alias=AliasChoices("disabled_at", "disabledAt"))
    disabled_by_subject_id: str | None = Field(
        default=None, validation_alias=AliasChoices("disabled_by_subject_id", "disabledBySubjectId")
    )
    enabled: bool = True
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    provider_item_id: str | None = Field(
        default=None, validation_alias=AliasChoices("provider_item_id", "providerItemId")
    )
    row_version: int = Field(ge=0, validation_alias=AliasChoices("row_version", "rowVersion"))
    source_id: str | None = Field(default=None, validation_alias=AliasChoices("source_id", "sourceId"))
    status: Literal["deleting", "failed", "pending", "ready"]
    title: str
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))
    user_metadata: dict[str, object] = Field(validation_alias=AliasChoices("user_metadata", "userMetadata"))


class KnowledgeFSLogicalDocumentListResponse(ResponseModel):
    data: list[KnowledgeFSLogicalDocumentResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSDocumentAvailabilityPayload(BaseModel):
    enabled: bool
    expected_row_version: int = Field(ge=0, alias="expectedRowVersion")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSBulkDocumentAvailabilityItem(BaseModel):
    document_id: str = Field(alias="documentId")
    expected_row_version: int = Field(ge=0, alias="expectedRowVersion")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSBulkDocumentAvailabilityPayload(BaseModel):
    documents: list[KnowledgeFSBulkDocumentAvailabilityItem] = Field(min_length=1, max_length=100)
    enabled: bool

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSBulkDocumentAvailabilityFailureResponse(ResponseModel):
    document_id: str = Field(validation_alias=AliasChoices("document_id", "documentId"))
    status: Literal["conflict", "not_found"]


class KnowledgeFSBulkDocumentAvailabilityResponse(ResponseModel):
    items: list[KnowledgeFSLogicalDocumentResponse | KnowledgeFSBulkDocumentAvailabilityFailureResponse]
    total: int = Field(ge=0)


class KnowledgeFSDocumentRevisionListResponse(ResponseModel):
    data: list[KnowledgeFSDocumentRevisionResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSDocumentMetadataPayload(BaseModel):
    expected_row_version: int = Field(ge=0, alias="expectedRowVersion")
    patch: dict[str, object]

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSMetadataFieldListQuery(BaseModel):
    cursor: str | None = Field(default=None, min_length=1, max_length=1_000)
    limit: int = Field(default=100, ge=1, le=100)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSMetadataFieldCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: Literal["string", "number", "time"]

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSMetadataFieldUpdatePayload(BaseModel):
    expected_row_version: int = Field(ge=0, alias="expectedRowVersion")
    name: str = Field(min_length=1, max_length=255)

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSMetadataFieldDeleteQuery(BaseModel):
    expected_row_version: int = Field(ge=0, alias="expectedRowVersion")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSMetadataFieldResponse(ResponseModel):
    count: int = Field(ge=0)
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    id: str
    name: str
    row_version: int = Field(ge=0, validation_alias=AliasChoices("row_version", "rowVersion"))
    type: Literal["string", "number", "time"]
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


class KnowledgeFSMetadataFieldListResponse(ResponseModel):
    data: list[KnowledgeFSMetadataFieldResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSMetadataFieldDeleteResponse(ResponseModel):
    deleted: Literal[True]


class KnowledgeFSDocumentChunkResponse(ResponseModel):
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    document_id: str = Field(validation_alias=AliasChoices("document_id", "documentId"))
    document_revision: int = Field(ge=1, validation_alias=AliasChoices("document_revision", "documentRevision"))
    enabled: bool
    id: str
    kind: Literal["chunk", "section", "table", "image", "summary"] = "chunk"
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    ordinal: int = Field(ge=0)
    parent_chunk_id: str | None = Field(default=None, validation_alias=AliasChoices("parent_chunk_id", "parentChunkId"))
    section_path: list[str] = Field(default_factory=list, validation_alias=AliasChoices("section_path", "sectionPath"))
    text: str
    token_count: int = Field(ge=0, validation_alias=AliasChoices("token_count", "tokenCount"))
    user_metadata: dict[str, object] = Field(validation_alias=AliasChoices("user_metadata", "userMetadata"))


class KnowledgeFSDocumentChunkListQuery(KnowledgeFSCursorQuery):
    query: str | None = Field(default=None, min_length=1, max_length=512)


class KnowledgeFSDocumentChunkListResponse(ResponseModel):
    data: list[KnowledgeFSDocumentChunkResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSDocumentDeletePayload(BaseModel):
    expected_revision: int = Field(ge=1, alias="expectedRevision")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSLogicalDocumentDeletePayload(BaseModel):
    expected_revision: int = Field(ge=0, alias="expectedRevision")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSBulkLogicalDocumentDeleteItemPayload(KnowledgeFSLogicalDocumentDeletePayload):
    document_id: str = Field(min_length=1, alias="documentId")


class KnowledgeFSBulkLogicalDocumentDeletePayload(BaseModel):
    documents: list[KnowledgeFSBulkLogicalDocumentDeleteItemPayload] = Field(min_length=1, max_length=100)

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSBulkDocumentDeleteItemPayload(KnowledgeFSDocumentDeletePayload):
    document_id: str = Field(min_length=1, alias="documentId")


class KnowledgeFSBulkDocumentDeletePayload(BaseModel):
    documents: list[KnowledgeFSBulkDocumentDeleteItemPayload] = Field(min_length=1, max_length=1_000)

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSDocumentReindexPayload(BaseModel):
    all: bool | None = None
    document_ids: list[str] | None = Field(default=None, min_length=1, max_length=1_000, alias="documentIds")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)

    @model_validator(mode="after")
    def validate_target(self) -> KnowledgeFSDocumentReindexPayload:
        if bool(self.all) == bool(self.document_ids):
            raise ValueError("Exactly one of all=true or document_ids is required")
        return self


class KnowledgeFSDurableDeletionErrorResponse(ResponseModel):
    code: str
    message: str
    retryable: bool


class KnowledgeFSDurableDeletionProgressResponse(ResponseModel):
    completed_items: int = Field(ge=0, validation_alias=AliasChoices("completed_items", "completedItems"))
    current_item_kind: str | None = Field(
        default=None, validation_alias=AliasChoices("current_item_kind", "currentItemKind")
    )
    total_items: int | None = Field(default=None, ge=0, validation_alias=AliasChoices("total_items", "totalItems"))


class KnowledgeFSDurableDeletionJobResponse(ResponseModel):
    checkpoint: Literal[
        "completed", "deleting_derived_data", "deleting_objects", "deleting_primary_data", "quiescing", "requested"
    ]
    completed_at: datetime | None = Field(default=None, validation_alias=AliasChoices("completed_at", "completedAt"))
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    error: KnowledgeFSDurableDeletionErrorResponse | None = None
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    mode: Literal["cascade", "keep"] | None = None
    progress: KnowledgeFSDurableDeletionProgressResponse | None = None
    retry_at: datetime | None = Field(default=None, validation_alias=AliasChoices("retry_at", "retryAt"))
    run_state: Literal["canceled", "completed", "dispatch_pending", "failed", "queued", "retry_wait", "running"] = (
        Field(validation_alias=AliasChoices("run_state", "runState"))
    )
    target_id: str = Field(validation_alias=AliasChoices("target_id", "targetId"))
    target_type: Literal["document", "knowledge_space", "logical_document", "source"] = Field(
        validation_alias=AliasChoices("target_type", "targetType")
    )
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


class KnowledgeFSDurableDeletionAcceptedResponse(ResponseModel):
    job: KnowledgeFSDurableDeletionJobResponse
    status_url: str = Field(validation_alias=AliasChoices("status_url", "statusUrl"))


class KnowledgeFSBulkDeletionAcceptedItemResponse(ResponseModel):
    document_id: str = Field(validation_alias=AliasChoices("document_id", "documentId"))
    document_title: str | None = Field(default=None, validation_alias=AliasChoices("document_title", "documentTitle"))
    job: KnowledgeFSDurableDeletionJobResponse
    status_url: str = Field(validation_alias=AliasChoices("status_url", "statusUrl"))


class KnowledgeFSBulkDeletionAcceptedResponse(ResponseModel):
    items: list[KnowledgeFSBulkDeletionAcceptedItemResponse]
    total: int = Field(ge=1)


class KnowledgeFSDocumentCompilationJobResponse(ResponseModel):
    base_head_revision: int | None = Field(
        default=None, ge=0, validation_alias=AliasChoices("base_head_revision", "baseHeadRevision")
    )
    candidate_fingerprint: str | None = Field(
        default=None, validation_alias=AliasChoices("candidate_fingerprint", "candidateFingerprint")
    )
    candidate_publication_id: str | None = Field(
        default=None, validation_alias=AliasChoices("candidate_publication_id", "candidatePublicationId")
    )
    completed_at: float | None = Field(default=None, validation_alias=AliasChoices("completed_at", "completedAt"))
    created_at: float = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    document_asset_id: str = Field(validation_alias=AliasChoices("document_asset_id", "documentAssetId"))
    error: str | None = None
    execution_attempts: int | None = Field(
        default=None, ge=0, validation_alias=AliasChoices("execution_attempts", "executionAttempts")
    )
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    max_execution_attempts: int | None = Field(
        default=None, ge=1, validation_alias=AliasChoices("max_execution_attempts", "maxExecutionAttempts")
    )
    run_state: str | None = Field(default=None, validation_alias=AliasChoices("run_state", "runState"))
    stage: Literal[
        "canceled",
        "failed",
        "nodes_generated",
        "outline_built",
        "parsed",
        "projection_built",
        "published",
        "queued",
        "smoke_eval_passed",
    ]
    updated_at: float = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))
    version: int = Field(ge=1)


class KnowledgeFSBulkJobResponse(ResponseModel):
    canceled_items: int = Field(ge=0, validation_alias=AliasChoices("canceled_items", "canceledItems"))
    completed_items: int = Field(ge=0, validation_alias=AliasChoices("completed_items", "completedItems"))
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    failed_item_ids: list[str] = Field(validation_alias=AliasChoices("failed_item_ids", "failedItemIds"))
    failed_items: int = Field(ge=0, validation_alias=AliasChoices("failed_items", "failedItems"))
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    status: Literal["canceled", "completed", "failed", "running"]
    total_items: int = Field(ge=0, validation_alias=AliasChoices("total_items", "totalItems"))
    type: Literal["document_delete", "document_reindex", "document_upload"]
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


KnowledgeFSPublicErrorCode = Literal[
    "DOCUMENT_COMPILATION_FAILED",
    "DOCUMENT_COMPILATION_RETRYABLE",
    "DOCUMENT_DISABLED",
    "DOCUMENT_PARSER_INPUT_INVALID",
    "DOCUMENT_PARSER_NOT_CONFIGURED",
    "DOCUMENT_PARSER_RATE_LIMITED",
    "DOCUMENT_PARSER_RESPONSE_INVALID",
    "DOCUMENT_PARSER_UNAVAILABLE",
    "EMBEDDING_DIMENSION_INVALID",
    "EMBEDDING_DIMENSION_UNSUPPORTED",
    "EXECUTION_ATTEMPTS_EXHAUSTED",
    "KNOWLEDGE_FS_ACCESS_DENIED",
    "KNOWLEDGE_FS_CONFLICT",
    "KNOWLEDGE_FS_INTERNAL_ERROR",
    "KNOWLEDGE_FS_INVALID_REQUEST",
    "KNOWLEDGE_FS_NOT_FOUND",
    "KNOWLEDGE_FS_RATE_LIMITED",
    "KNOWLEDGE_FS_TIMEOUT",
    "KNOWLEDGE_FS_UNAVAILABLE",
    "KNOWLEDGE_SPACE_MANIFEST_NOT_FOUND",
    "KNOWLEDGE_SPACE_MODEL_CONFIGURATION_REQUIRED",
    "MODEL_CAPABILITY_MISMATCH",
    "MODEL_CONFIGURATION_STALE",
    "MODEL_CREDENTIAL_INVALID",
    "MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE",
    "MODEL_IDENTITY_MISMATCH",
    "MODEL_PREFLIGHT_CANCELED",
    "MODEL_PREFLIGHT_FAILED",
    "MODEL_PREFLIGHT_TIMEOUT",
    "MODEL_PREFLIGHT_UNAVAILABLE",
    "MODEL_PROFILE_ACTIVATION_INCOMPLETE",
    "MODEL_PROFILE_ACTIVATION_PERMISSION_REQUIRED",
    "MODEL_RUNTIME_FAILED",
    "MODEL_RUNTIME_TIMEOUT",
    "MODEL_RUNTIME_UNAVAILABLE",
    "MODEL_SELECTION_NOT_FOUND",
    "RESEARCH_TASK_CAPABILITY_REVOKED",
    "RESEARCH_TASK_DISPATCH_DEAD",
    "RESEARCH_TASK_EXECUTION_ATTEMPTS_EXHAUSTED",
    "RESEARCH_TASK_FAILED",
    "RESEARCH_TASK_PERMISSION_SNAPSHOT_INVALID",
    "RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID",
    "SOURCE_BULK_ACTION_FAILED",
    "SOURCE_CREDENTIAL_CONFIG_INVALID",
    "SOURCE_CREDENTIAL_MUTATION_FAILED",
    "SOURCE_CREDENTIAL_TEST_FAILED",
    "SOURCE_CREDENTIAL_UNAVAILABLE",
    "SOURCE_DOCUMENT_MATERIALIZATION_FAILED",
    "SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED",
    "SOURCE_ONLINE_DOCUMENT_CONFIG_INVALID",
    "SOURCE_ONLINE_DOCUMENT_IMPORT_FAILED",
    "SOURCE_ONLINE_DOCUMENT_PAGE_FETCH_FAILED",
    "SOURCE_ONLINE_DOCUMENT_REQUEST_FAILED",
    "SOURCE_ONLINE_DRIVE_CONFIG_INVALID",
    "SOURCE_ONLINE_DRIVE_FILE_DOWNLOAD_FAILED",
    "SOURCE_ONLINE_DRIVE_IMPORT_FAILED",
    "SOURCE_ONLINE_DRIVE_REQUEST_FAILED",
    "SOURCE_OPERATION_FAILED",
    "SOURCE_SECRET_INTEGRITY_FAILED",
    "SOURCE_SECRET_REF_CONFLICT",
    "SOURCE_SYNC_FAILED",
    "SOURCE_WEBSITE_CRAWL_CONFIG_INVALID",
    "SOURCE_WEBSITE_CRAWL_FAILED",
    "SOURCE_WORKFLOW_FAILED",
    "UPLOAD_INITIALIZATION_FAILED",
    "UPLOAD_INTEGRITY_MISMATCH",
]


class KnowledgeFSPublicFailureResponse(ResponseModel):
    _SAFE_MESSAGE_BY_CATEGORY: ClassVar[dict[str, str]] = {
        "authorization": "You do not have permission to perform this KnowledgeFS operation.",
        "canceled": "The KnowledgeFS operation was canceled.",
        "configuration": "The KnowledgeFS operation requires a configuration change before it can continue.",
        "conflict": "The KnowledgeFS operation conflicts with the current resource state.",
        "dependency": "A service required by KnowledgeFS is temporarily unavailable.",
        "internal": (
            "KnowledgeFS could not complete the operation. Try again, or contact an administrator "
            "with the error reference."
        ),
        "not_found": "The requested KnowledgeFS resource was not found.",
        "rate_limit": "Too many KnowledgeFS operations were requested. Try again later.",
        "timeout": "The KnowledgeFS operation timed out. Try again later.",
        "validation": "The KnowledgeFS request is invalid.",
    }
    _SAFE_PARAMETER_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "attempt",
            "documentCount",
            "fileSizeBytes",
            "limit",
            "maxFileSizeBytes",
            "maxItems",
            "modelType",
            "providerKind",
            "retryAfterSeconds",
            "status",
        }
    )
    action: (
        Literal[
            "configure_model",
            "configure_parser",
            "configure_source",
            "contact_admin",
            "reupload",
            "retry",
        ]
        | None
    ) = None
    category: Literal[
        "authorization",
        "canceled",
        "configuration",
        "conflict",
        "dependency",
        "internal",
        "not_found",
        "rate_limit",
        "timeout",
        "validation",
    ]
    code: KnowledgeFSPublicErrorCode
    message: str = Field(min_length=1, max_length=1_024)
    parameters: dict[str, str | int | float | bool] | None = Field(default=None, max_length=8)
    retry_policy: Literal["automatic", "manual", "after_configuration", "never"] = Field(
        validation_alias=AliasChoices("retry_policy", "retryPolicy"),
        serialization_alias="retryPolicy",
    )
    stage: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[a-z][a-z0-9_.-]{0,127}$")
    trace_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9._:-]{1,128}$",
        validation_alias=AliasChoices("trace_id", "traceId"),
        serialization_alias="traceId",
    )

    model_config = ConfigDict(extra="forbid")

    @field_validator("parameters")
    @classmethod
    def validate_public_parameters(
        cls, parameters: dict[str, str | int | float | bool] | None
    ) -> dict[str, str | int | float | bool] | None:
        if parameters is None:
            return None
        for key, value in parameters.items():
            if key not in cls._SAFE_PARAMETER_KEYS or re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", key) is None:
                raise ValueError("KnowledgeFS public failure parameter key is invalid")
            if isinstance(value, str) and len(value) > 256:
                raise ValueError("KnowledgeFS public failure parameter value is too long")
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError("KnowledgeFS public failure parameter must be finite")
        return parameters

    @model_validator(mode="after")
    def replace_untrusted_message_with_bff_fallback(self) -> KnowledgeFSPublicFailureResponse:
        self.message = self._SAFE_MESSAGE_BY_CATEGORY[self.category]
        return self


class KnowledgeFSBackgroundTaskFailureResponse(ResponseModel):
    document_id: str = Field(validation_alias=AliasChoices("document_id", "documentId"))
    document_title: str | None = Field(default=None, validation_alias=AliasChoices("document_title", "documentTitle"))
    error_code: str = Field(validation_alias=AliasChoices("error_code", "errorCode"))
    error_message: str = Field(validation_alias=AliasChoices("error_message", "errorMessage"))
    failure: KnowledgeFSPublicFailureResponse
    job_id: str | None = Field(default=None, validation_alias=AliasChoices("job_id", "jobId"))


class KnowledgeFSBackgroundTaskResponse(ResponseModel):
    can_cancel: bool = Field(validation_alias=AliasChoices("can_cancel", "canCancel"))
    can_retry: bool = Field(validation_alias=AliasChoices("can_retry", "canRetry"))
    completed_at: datetime | None = Field(default=None, validation_alias=AliasChoices("completed_at", "completedAt"))
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    document_id: str | None = Field(default=None, validation_alias=AliasChoices("document_id", "documentId"))
    document_revision: int | None = Field(
        default=None, ge=1, validation_alias=AliasChoices("document_revision", "documentRevision")
    )
    error_code: str | None = Field(default=None, validation_alias=AliasChoices("error_code", "errorCode"))
    error_message: str | None = Field(default=None, validation_alias=AliasChoices("error_message", "errorMessage"))
    failure: KnowledgeFSPublicFailureResponse | None = None
    failures: list[KnowledgeFSBackgroundTaskFailureResponse] | None = None
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    operation: Literal[
        "document_delete",
        "document_processing",
        "document_reindex",
        "document_upload",
        "source_bulk",
        "source_crawl_import",
        "source_crawl_preview",
        "source_online_document_import",
        "source_online_drive_import",
        "source_sync",
    ]
    progress_completed: int = Field(ge=0, validation_alias=AliasChoices("progress_completed", "progressCompleted"))
    progress_failed: int = Field(ge=0, validation_alias=AliasChoices("progress_failed", "progressFailed"))
    progress_percent: int = Field(ge=0, le=100, validation_alias=AliasChoices("progress_percent", "progressPercent"))
    progress_total: int = Field(ge=0, validation_alias=AliasChoices("progress_total", "progressTotal"))
    source_id: str | None = Field(default=None, validation_alias=AliasChoices("source_id", "sourceId"))
    state: Literal["canceled", "completed", "failed", "queued", "running"]
    task_kind: Literal["document", "document_bulk", "source"] = Field(
        validation_alias=AliasChoices("task_kind", "taskKind")
    )
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


class KnowledgeFSBackgroundTaskListResponse(ResponseModel):
    data: list[KnowledgeFSBackgroundTaskResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSDocumentReindexItemResponse(ResponseModel):
    asset: KnowledgeFSDocumentResponse | None = None
    compilation_job: dict[str, object] | None = Field(
        default=None, validation_alias=AliasChoices("compilation_job", "compilationJob")
    )
    document_id: str | None = Field(default=None, validation_alias=AliasChoices("document_id", "documentId"))
    status: Literal["disabled", "not_found", "queued"]
    status_url: str | None = Field(default=None, validation_alias=AliasChoices("status_url", "statusUrl"))


class KnowledgeFSDocumentReindexResponse(ResponseModel):
    bulk_job_id: str = Field(validation_alias=AliasChoices("bulk_job_id", "bulkJobId"))
    items: list[KnowledgeFSDocumentReindexItemResponse]
    total: int = Field(ge=0)


class KnowledgeFSSourceCreatePayload(BaseModel):
    connection_id: str | None = Field(default=None, alias="connectionId")
    credentials: dict[str, object] | None = None
    metadata: dict[str, object] = Field(default_factory=dict)
    name: str = Field(min_length=1, max_length=200)
    permission_scope: list[str] = Field(default_factory=list, max_length=1_000, alias="permissionScope")
    status: Literal["active", "disabled", "error", "syncing"] | None = None
    type: Literal["connector", "object-storage", "upload", "web"]
    uri: str = Field(min_length=1, max_length=4_096)

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)

    @model_validator(mode="after")
    def validate_credential_binding(self) -> KnowledgeFSSourceCreatePayload:
        if self.connection_id is not None and self.credentials is not None:
            raise ValueError("connection_id and credentials are mutually exclusive")
        return self


class KnowledgeFSSourceSyncPolicyResponse(ResponseModel):
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    custom_interval_seconds: int | None = Field(
        default=None, validation_alias=AliasChoices("custom_interval_seconds", "customIntervalSeconds")
    )
    enabled: bool
    expected_source_version: int = Field(
        ge=1, validation_alias=AliasChoices("expected_source_version", "expectedSourceVersion")
    )
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    mode: Literal["provider", "manual", "interval", "custom"]
    next_run_at: datetime | None = Field(default=None, validation_alias=AliasChoices("next_run_at", "nextRunAt"))
    revision: int = Field(ge=1)
    source_id: str = Field(validation_alias=AliasChoices("source_id", "sourceId"))
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


class KnowledgeFSSourceResponse(ResponseModel):
    sync_workflow: KnowledgeFSSourceWorkflowResponse | None = Field(
        default=None, validation_alias=AliasChoices("sync_workflow", "syncWorkflow")
    )
    id: str
    connection_id: str | None = Field(default=None, validation_alias=AliasChoices("connection_id", "connectionId"))
    credential_configured: bool | None = Field(
        default=None, validation_alias=AliasChoices("credential_configured", "credentialConfigured")
    )
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    last_synced_at: datetime | None = Field(
        default=None, validation_alias=AliasChoices("last_synced_at", "lastSyncedAt")
    )
    metadata: dict[str, object]
    name: str
    permission_scope: list[str] = Field(validation_alias=AliasChoices("permission_scope", "permissionScope"))
    status: Literal["active", "disabled", "error", "syncing"]
    sync_policy: KnowledgeFSSourceSyncPolicyResponse | None = Field(
        default=None, validation_alias=AliasChoices("sync_policy", "syncPolicy")
    )
    type: Literal["connector", "object-storage", "upload", "web"]
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))
    uri: str
    version: int = Field(ge=1)


class KnowledgeFSSourceListResponse(ResponseModel):
    data: list[KnowledgeFSSourceResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSSourceUpdatePayload(BaseModel):
    expected_version: int | None = Field(default=None, ge=1, alias="expectedVersion")
    metadata: dict[str, object] | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    status: Literal["active", "disabled", "error", "syncing"] | None = None

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)

    @model_validator(mode="after")
    def validate_update_present(self) -> KnowledgeFSSourceUpdatePayload:
        if self.metadata is None and self.name is None and self.status is None:
            raise ValueError("At least one source update is required")
        return self


class KnowledgeFSSourceDeletePayload(BaseModel):
    expected_revision: int = Field(ge=1, alias="expectedRevision")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSSourceDeleteQuery(BaseModel):
    documents: Literal["cascade", "keep"] = "cascade"

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSSourceCredentialTestResponse(ResponseModel):
    code: KnowledgeFSPublicErrorCode | None = None
    error: str | None = None
    failure: KnowledgeFSPublicFailureResponse | None = None
    valid: bool

    @model_validator(mode="after")
    def normalize_public_failure(self) -> KnowledgeFSSourceCredentialTestResponse:
        if not self.valid and self.failure is not None:
            self.code = self.failure.code
            self.error = self.failure.message
        else:
            self.code = None
            self.error = None
            self.failure = None
        return self


class KnowledgeFSSourceWorkflowResponse(ResponseModel):
    canceled_at: datetime | None = Field(default=None, validation_alias=AliasChoices("canceled_at", "canceledAt"))
    checkpoint: str
    completed_at: datetime | None = Field(default=None, validation_alias=AliasChoices("completed_at", "completedAt"))
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    cursor: str | None = None
    execution_attempts: int = Field(ge=0, validation_alias=AliasChoices("execution_attempts", "executionAttempts"))
    failure: KnowledgeFSPublicFailureResponse | None = None
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    kind: str
    last_error_code: KnowledgeFSPublicErrorCode | None = Field(
        default=None, validation_alias=AliasChoices("last_error_code", "lastErrorCode")
    )
    max_execution_attempts: int = Field(
        ge=1, validation_alias=AliasChoices("max_execution_attempts", "maxExecutionAttempts")
    )
    progress_completed: int = Field(ge=0, validation_alias=AliasChoices("progress_completed", "progressCompleted"))
    progress_failed: int = Field(ge=0, validation_alias=AliasChoices("progress_failed", "progressFailed"))
    progress_skipped: int = Field(ge=0, validation_alias=AliasChoices("progress_skipped", "progressSkipped"))
    progress_total: int | None = Field(
        default=None, ge=0, validation_alias=AliasChoices("progress_total", "progressTotal")
    )
    source_id: str | None = Field(default=None, validation_alias=AliasChoices("source_id", "sourceId"))
    state: str
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))

    @model_validator(mode="after")
    def normalize_public_failure(self) -> KnowledgeFSSourceWorkflowResponse:
        if self.state == "failed" and self.failure is not None:
            self.last_error_code = self.failure.code
        else:
            self.failure = None
            self.last_error_code = None
        return self


class KnowledgeFSOnlineDocumentWorkflowImportPayload(BaseModel):
    items: list[KnowledgeFSOnlineDocumentWorkflowImportItemPayload] = Field(min_length=1, max_length=200)
    kind: Literal["online-document-import"]

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSOnlineDriveWorkflowImportPayload(BaseModel):
    items: list[KnowledgeFSOnlineDriveWorkflowImportItemPayload] = Field(min_length=1, max_length=200)
    kind: Literal["online-drive-import"]

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSSourceWorkflowImportPayload(
    RootModel[
        Annotated[
            KnowledgeFSOnlineDocumentWorkflowImportPayload | KnowledgeFSOnlineDriveWorkflowImportPayload,
            Field(discriminator="kind"),
        ]
    ]
):
    pass


class KnowledgeFSSourceProviderFieldResponse(ResponseModel):
    description: str | None = None
    format: Literal["password", "uri"] | None = None
    name: str
    required: bool
    secret: bool
    type: Literal["boolean", "integer", "string"]


class KnowledgeFSSourceProviderResponse(ResponseModel):
    auth_kinds: list[Literal["api-key", "endpoint", "oauth2"]] = Field(
        validation_alias=AliasChoices("auth_kinds", "authKinds")
    )
    available: bool
    capabilities: list[Literal["website-crawl", "online-document", "online-drive"]]
    configuration: list[KnowledgeFSSourceProviderFieldResponse]
    display_name: str = Field(validation_alias=AliasChoices("display_name", "displayName"))
    id: str
    unavailable_reason: str | None = Field(
        default=None, validation_alias=AliasChoices("unavailable_reason", "unavailableReason")
    )


class KnowledgeFSSourceProviderListResponse(ResponseModel):
    data: list[KnowledgeFSSourceProviderResponse] = Field(validation_alias=AliasChoices("data", "items"))


class KnowledgeFSSourceConnectionCreatePayload(BaseModel):
    auth_kind: Literal["api-key", "endpoint"] = Field(alias="authKind")
    configuration: dict[str, bool | int | str] = Field(default_factory=dict)
    credentials: dict[str, object]
    name: str = Field(min_length=1, max_length=160)
    provider_id: str = Field(min_length=1, max_length=128, alias="providerId")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSSourceConnectionResponse(ResponseModel):
    auth_kind: Literal["api-key", "endpoint", "oauth2"] = Field(validation_alias=AliasChoices("auth_kind", "authKind"))
    configuration: dict[str, bool | int | str]
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    error_code: str | None = Field(default=None, validation_alias=AliasChoices("error_code", "errorCode"))
    expires_at: datetime | None = Field(default=None, validation_alias=AliasChoices("expires_at", "expiresAt"))
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    name: str
    provider_id: str = Field(validation_alias=AliasChoices("provider_id", "providerId"))
    scopes: list[str]
    status: Literal["provisioning", "active", "expired", "error", "revoked"]
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))
    version: int = Field(ge=1)


class KnowledgeFSSourceConnectionListQuery(BaseModel):
    cursor: str | None = Field(default=None, min_length=1, max_length=4_096)
    limit: int = Field(default=50, ge=1, le=200)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSSourceConnectionListResponse(ResponseModel):
    data: list[KnowledgeFSSourceConnectionResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSSourceConnectionRefreshPayload(BaseModel):
    expected_version: int = Field(ge=1, alias="expectedVersion")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSSourceSyncPolicyPayload(BaseModel):
    custom_interval_seconds: int | None = Field(default=None, ge=3_600, le=2_592_000, alias="customIntervalSeconds")
    enabled: bool
    expected_revision: int = Field(ge=0, alias="expectedRevision")
    expected_source_version: int = Field(ge=1, alias="expectedSourceVersion")
    mode: Literal["provider", "manual", "interval", "custom"]

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSSourceWorkflowCancelPayload(BaseModel):
    reason: str | None = Field(default=None, max_length=1_000)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSCrawlPreviewPageResponse(ResponseModel):
    description: str | None = None
    etag: str | None = None
    page_id: str = Field(validation_alias=AliasChoices("page_id", "pageId"))
    source_url: str = Field(validation_alias=AliasChoices("source_url", "sourceUrl"))
    title: str | None = None


class KnowledgeFSCrawlPreviewPageListQuery(BaseModel):
    cursor: str | None = Field(default=None, min_length=1, max_length=4_096)
    limit: int = Field(default=50, ge=1, le=200)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSCrawlPreviewPageListResponse(ResponseModel):
    data: list[KnowledgeFSCrawlPreviewPageResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSCrawlPreviewSelectionPayload(BaseModel):
    page_ids: list[str] = Field(min_length=1, max_length=200, alias="pageIds")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSCrawlImportPayload(BaseModel):
    source_urls: list[str] = Field(min_length=1, max_length=200, alias="sourceUrls")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)

    @field_validator("source_urls")
    @classmethod
    def validate_source_urls(cls, source_urls: list[str]) -> list[str]:
        normalized = [source_url.strip() for source_url in source_urls]
        if any(not source_url or len(source_url) > 4_096 for source_url in normalized):
            raise ValueError("source URLs must be non-empty and at most 4096 characters")
        if len(set(normalized)) != len(normalized):
            raise ValueError("source URLs must be unique")
        return normalized


class KnowledgeFSCrawledPageResponse(ResponseModel):
    content: str
    description: str | None = None
    source_url: str = Field(validation_alias=AliasChoices("source_url", "sourceUrl"))
    title: str | None = None


class KnowledgeFSSourceCrawlResponse(ResponseModel):
    completed: int | None = Field(default=None, ge=0)
    failed: int | None = Field(default=None, ge=0)
    imported: int | None = Field(default=None, ge=0)
    pages: list[KnowledgeFSCrawledPageResponse]
    replaced: int | None = Field(default=None, ge=0)
    skipped: int | None = Field(default=None, ge=0)
    status: str | None = None
    total: int | None = Field(default=None, ge=0)


class KnowledgeFSSourcePagesQuery(BaseModel):
    cursor: str | None = Field(default=None, min_length=1, max_length=4_096)
    limit: int = Field(default=50, ge=1, le=200)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSSourcePageResponse(ResponseModel):
    last_edited_time: str | None = Field(
        default=None, validation_alias=AliasChoices("last_edited_time", "lastEditedTime")
    )
    page_id: str = Field(validation_alias=AliasChoices("page_id", "pageId"))
    page_name: str = Field(validation_alias=AliasChoices("page_name", "pageName"))
    parent_id: str | None = Field(default=None, validation_alias=AliasChoices("parent_id", "parentId"))
    type: str


class KnowledgeFSSourceWorkspacePagesResponse(ResponseModel):
    pages: list[KnowledgeFSSourcePageResponse]
    total: int | None = Field(default=None, ge=0)
    workspace_id: str | None = Field(default=None, validation_alias=AliasChoices("workspace_id", "workspaceId"))
    workspace_name: str | None = Field(default=None, validation_alias=AliasChoices("workspace_name", "workspaceName"))


class KnowledgeFSSourcePagesResponse(ResponseModel):
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))
    workspaces: list[KnowledgeFSSourceWorkspacePagesResponse]


class KnowledgeFSSourceImportPagePayload(BaseModel):
    last_edited_time: str | None = Field(default=None, alias="lastEditedTime")
    name: str | None = Field(default=None, min_length=1, max_length=200)
    page_id: str = Field(min_length=1, alias="pageId")
    type: str = Field(min_length=1)
    workspace_id: str = Field(min_length=1, alias="workspaceId")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSSourceImportPagesPayload(BaseModel):
    pages: list[KnowledgeFSSourceImportPagePayload] = Field(min_length=1, max_length=200)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSSourceFilesQuery(BaseModel):
    bucket: str | None = None
    continuation_token: str | None = Field(default=None, min_length=1, max_length=4_096, alias="continuationToken")
    max_keys: int | None = Field(default=None, ge=1, le=1_000, alias="maxKeys")
    prefix: str | None = None

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSSourceFileResponse(ResponseModel):
    id: str
    name: str
    size: float | None = Field(default=None, ge=0)
    type: str


class KnowledgeFSSourceFileBucketResponse(ResponseModel):
    bucket: str | None = None
    continuation_token: str | None = Field(
        default=None, validation_alias=AliasChoices("continuation_token", "continuationToken")
    )
    files: list[KnowledgeFSSourceFileResponse]
    is_truncated: bool | None = Field(default=None, validation_alias=AliasChoices("is_truncated", "isTruncated"))


class KnowledgeFSSourceFilesResponse(ResponseModel):
    buckets: list[KnowledgeFSSourceFileBucketResponse]


class KnowledgeFSSourceImportFilePayload(BaseModel):
    bucket: str | None = None
    id: str = Field(min_length=1)
    mime_type: str | None = Field(default=None, alias="mimeType")
    name: str = Field(min_length=1, max_length=255)

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSSourceImportFilesPayload(BaseModel):
    files: list[KnowledgeFSSourceImportFilePayload] = Field(min_length=1, max_length=200)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSSourceImportedDocumentResponse(ResponseModel):
    document_asset_id: str = Field(validation_alias=AliasChoices("document_asset_id", "documentAssetId"))
    filename: str


class KnowledgeFSSourceImportFailureResponse(ResponseModel):
    code: KnowledgeFSPublicErrorCode
    error: str
    failure: KnowledgeFSPublicFailureResponse | None = None
    filename: str

    @model_validator(mode="after")
    def normalize_public_failure(self) -> KnowledgeFSSourceImportFailureResponse:
        self.error = (
            self.failure.message if self.failure is not None else "KnowledgeFS could not import this source document."
        )
        if self.failure is not None:
            self.code = self.failure.code
        return self


class KnowledgeFSSourceImportResponse(ResponseModel):
    documents: list[KnowledgeFSSourceImportedDocumentResponse]
    failed: list[KnowledgeFSSourceImportFailureResponse]
    skipped: list[str]


class KnowledgeFSQueryImageReference(BaseModel):
    upload_file_id: str = Field(min_length=1, alias="uploadFileId")

    model_config = ConfigDict(extra="forbid", serialize_by_alias=True, validate_by_alias=True, validate_by_name=True)

    @field_validator("upload_file_id")
    @classmethod
    def validate_upload_file_id(cls, value: str) -> str:
        try:
            UUID(value)
        except ValueError as exc:
            raise ValueError("uploadFileId must be a UUID") from exc
        return value


class _KnowledgeFSQueryModalities(BaseModel):
    query: str | None = Field(default=None, max_length=16_000)
    query_images: list[KnowledgeFSQueryImageReference] = Field(
        default_factory=list,
        max_length=4,
        alias="queryImages",
        exclude_if=lambda value: not value,
    )

    @model_validator(mode="after")
    def validate_query_modality(self) -> _KnowledgeFSQueryModalities:
        if not (self.query and self.query.strip()) and not self.query_images:
            raise ValueError("At least one of query or queryImages is required")
        if len({image.upload_file_id for image in self.query_images}) != len(self.query_images):
            raise ValueError("queryImages must not contain duplicate uploadFileId values")
        return self


class KnowledgeFSQueryCreatePayload(_KnowledgeFSQueryModalities):
    mode: Literal["auto", "deep", "fast", "research"] | None = None
    active_document_ids: list[str] = Field(
        default_factory=list,
        max_length=100,
        alias="activeDocumentIds",
    )
    active_entity_ids: list[str] = Field(
        default_factory=list,
        max_length=100,
        alias="activeEntityIds",
    )
    session_id: str | None = Field(
        default=None,
        alias="sessionId",
        exclude_if=lambda value: value is None,
    )

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSQueryResponse(ResponseModel):
    id: str
    status: str
    answer: str | None = None
    trace_id: str | None = None


KnowledgeFSRetrievalFilterValue = Annotated[str, Field(min_length=1, max_length=512)]


class KnowledgeFSRetrievalMetadataFilters(BaseModel):
    created_after: str | None = Field(
        default=None,
        max_length=64,
        validation_alias=AliasChoices("created_after", "createdAfter"),
        serialization_alias="createdAfter",
    )
    created_before: str | None = Field(
        default=None,
        max_length=64,
        validation_alias=AliasChoices("created_before", "createdBefore"),
        serialization_alias="createdBefore",
    )
    document_types: list[KnowledgeFSRetrievalFilterValue] | None = Field(
        default=None,
        max_length=100,
        validation_alias=AliasChoices("document_types", "documentTypes"),
        serialization_alias="documentTypes",
    )
    entities: list[KnowledgeFSRetrievalFilterValue] | None = Field(default=None, max_length=100)
    freshness_statuses: list[KnowledgeFSRetrievalFilterValue] | None = Field(
        default=None,
        max_length=100,
        validation_alias=AliasChoices("freshness_statuses", "freshnessStatuses"),
        serialization_alias="freshnessStatuses",
    )
    languages: list[KnowledgeFSRetrievalFilterValue] | None = Field(default=None, max_length=100)
    node_kinds: list[Literal["chunk", "section", "table", "image", "summary"]] | None = Field(
        default=None,
        max_length=100,
        validation_alias=AliasChoices("node_kinds", "nodeKinds"),
        serialization_alias="nodeKinds",
    )
    source_ids: list[KnowledgeFSRetrievalFilterValue] | None = Field(
        default=None,
        max_length=100,
        validation_alias=AliasChoices("source_ids", "sourceIds"),
        serialization_alias="sourceIds",
    )
    tags: list[KnowledgeFSRetrievalFilterValue] | None = Field(default=None, max_length=100)

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)

    @field_validator("created_after", "created_before")
    @classmethod
    def validate_date_filter(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        try:
            datetime.fromisoformat(normalized)
        except ValueError as exc:
            raise ValueError("Retrieval date filters must be valid ISO date strings") from exc
        return normalized

    @field_validator(
        "document_types",
        "entities",
        "freshness_statuses",
        "languages",
        "source_ids",
        "tags",
    )
    @classmethod
    def normalize_string_filters(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("Retrieval filter values must be non-empty")
        return list(dict.fromkeys(normalized))

    @field_validator("node_kinds")
    @classmethod
    def deduplicate_node_kinds(
        cls,
        values: list[Literal["chunk", "section", "table", "image", "summary"]] | None,
    ) -> list[Literal["chunk", "section", "table", "image", "summary"]] | None:
        return None if values is None else list(dict.fromkeys(values))


class KnowledgeFSRetrievalTestPayload(BaseModel):
    query: str = Field(min_length=1, max_length=16_000)
    mode: Literal["deep", "fast", "research"] | None = None
    include_text: bool = Field(
        default=False,
        validation_alias=AliasChoices("include_text", "includeText"),
        serialization_alias="includeText",
    )
    filters: KnowledgeFSRetrievalMetadataFilters | None = None

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Retrieval query is required")
        return normalized


class KnowledgeFSRetrievalCitationResponse(ResponseModel):
    artifact_hash: str = Field(
        min_length=1,
        max_length=128,
        validation_alias=AliasChoices("artifact_hash", "artifactHash"),
    )
    document_asset_id: str = Field(
        min_length=1,
        max_length=512,
        validation_alias=AliasChoices("document_asset_id", "documentAssetId"),
    )
    document_version: int = Field(
        gt=0,
        validation_alias=AliasChoices("document_version", "documentVersion"),
    )
    section_path: list[str] = Field(
        max_length=64,
        validation_alias=AliasChoices("section_path", "sectionPath"),
    )
    page_number: int | None = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("page_number", "pageNumber"),
    )
    start_offset: int | None = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("start_offset", "startOffset"),
    )
    end_offset: int | None = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("end_offset", "endOffset"),
    )


class KnowledgeFSRetrievalTestItemResponse(ResponseModel):
    citation: KnowledgeFSRetrievalCitationResponse
    node_id: str = Field(min_length=1, max_length=512, validation_alias=AliasChoices("node_id", "nodeId"))
    projection_ids: list[str] = Field(
        max_length=128,
        validation_alias=AliasChoices("projection_ids", "projectionIds"),
    )
    # The final score is profile-defined (for example rerank relevance or RRF fusion), so the
    # KnowledgeFS contract intentionally guarantees only a finite number rather than [0, 1].
    score: float = Field(allow_inf_nan=False)
    sources: list[Literal["dense", "fts", "pageindex", "visual"]] = Field(max_length=4)
    text: str | None = Field(default=None, max_length=8_192)


class KnowledgeFSRetrievalTestMetricsResponse(ResponseModel):
    total_ms: float = Field(ge=0, validation_alias=AliasChoices("total_ms", "totalMs"))
    degradation_flags: list[str] = Field(
        default_factory=list,
        max_length=32,
        validation_alias=AliasChoices("degradation_flags", "degradationFlags"),
    )


class KnowledgeFSRetrievalTestResponse(ResponseModel):
    items: list[KnowledgeFSRetrievalTestItemResponse] = Field(max_length=100)
    metrics: KnowledgeFSRetrievalTestMetricsResponse
    mode: Literal["deep", "fast", "research"]
    trace_id: str = Field(min_length=1, max_length=512, validation_alias=AliasChoices("trace_id", "traceId"))


class KnowledgeFSResearchTaskLimits(BaseModel):
    max_retrieval_steps: int | None = Field(default=None, ge=1, alias="maxRetrievalSteps")
    max_scanned_resources: int | None = Field(default=None, ge=1, alias="maxScannedResources")
    max_tool_calls: int | None = Field(default=None, ge=1, alias="maxToolCalls")
    timeout_ms: int | None = Field(default=None, ge=1, alias="timeoutMs")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSResearchTaskCreatePayload(_KnowledgeFSQueryModalities):
    mode: Literal["auto", "deep", "fast", "research"] | None = None
    top_k: int | None = Field(default=None, ge=1, le=50, alias="topK")
    budget_usd: float | None = Field(default=None, ge=0, alias="budgetUsd")
    limits: KnowledgeFSResearchTaskLimits | None = None
    metadata: dict[str, object] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSResearchTaskResponse(ResponseModel):
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    query: str
    query_images: list[KnowledgeFSQueryImageReference] = Field(
        default_factory=list,
        validation_alias=AliasChoices("query_images", "queryImages"),
        exclude_if=lambda value: not value,
    )
    budget_usd: float | None = Field(default=None, ge=0, validation_alias=AliasChoices("budget_usd", "budgetUsd"))
    completed_at: float | None = Field(default=None, validation_alias=AliasChoices("completed_at", "completedAt"))
    cost: dict[str, object]
    limits: KnowledgeFSResearchTaskLimits | None = None
    stage: Literal[
        "queued",
        "planning",
        "retrieving",
        "analyzing",
        "generating",
        "paused",
        "completed",
        "failed",
        "canceled",
    ]
    mode: Literal["auto", "deep", "fast", "research"] | None = None
    top_k: int | None = Field(default=None, validation_alias=AliasChoices("top_k", "topK"))
    metadata: dict[str, object]
    error: str | None = None
    failure: KnowledgeFSPublicFailureResponse | None = None
    created_at: float = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    updated_at: float = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


class KnowledgeFSResearchTaskListResponse(ResponseModel):
    data: list[KnowledgeFSResearchTaskResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSResearchTaskPlanPayload(_KnowledgeFSQueryModalities):
    budget_usd: float | None = Field(default=None, ge=0, alias="budgetUsd")
    mode: Literal["auto", "deep", "fast", "research"] | None = None
    top_k: int | None = Field(default=None, ge=1, le=50, alias="topK")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSResearchTaskPlanBudgetResponse(ResponseModel):
    budget_usd: float | None = Field(default=None, ge=0, validation_alias=AliasChoices("budget_usd", "budgetUsd"))
    exceeds_budget: bool = Field(validation_alias=AliasChoices("exceeds_budget", "exceedsBudget"))
    remaining_budget_usd: float | None = Field(
        default=None, validation_alias=AliasChoices("remaining_budget_usd", "remainingBudgetUsd")
    )


class KnowledgeFSResearchTaskRetrievalPlanResponse(ResponseModel):
    dense_top_k: int = Field(ge=0, validation_alias=AliasChoices("dense_top_k", "denseTopK"))
    fts_top_k: int = Field(ge=0, validation_alias=AliasChoices("fts_top_k", "ftsTopK"))
    fusion_limit: int = Field(ge=0, validation_alias=AliasChoices("fusion_limit", "fusionLimit"))
    query_language: Literal["cjk", "latin", "mixed-cjk-latin", "other"] = Field(
        validation_alias=AliasChoices("query_language", "queryLanguage")
    )
    requested_mode: Literal["auto", "deep", "fast", "research"] = Field(
        validation_alias=AliasChoices("requested_mode", "requestedMode")
    )
    rerank_candidate_limit: int = Field(
        ge=0, validation_alias=AliasChoices("rerank_candidate_limit", "rerankCandidateLimit")
    )
    resolved_mode: Literal["deep", "fast", "research"] = Field(
        validation_alias=AliasChoices("resolved_mode", "resolvedMode")
    )
    strategy_version: str = Field(validation_alias=AliasChoices("strategy_version", "strategyVersion"))
    top_k: int = Field(ge=1, validation_alias=AliasChoices("top_k", "topK"))


class KnowledgeFSResearchTaskPlanResponse(ResponseModel):
    budget: KnowledgeFSResearchTaskPlanBudgetResponse
    estimates: dict[str, object]
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    query: str
    query_images: list[KnowledgeFSQueryImageReference] = Field(
        default_factory=list,
        validation_alias=AliasChoices("query_images", "queryImages"),
        exclude_if=lambda value: not value,
    )
    retrieval_plan: KnowledgeFSResearchTaskRetrievalPlanResponse = Field(
        validation_alias=AliasChoices("retrieval_plan", "retrievalPlan")
    )
    steps: list[dict[str, object]]
    strategy_version: Literal["research-dry-run-planner-v1"] = Field(
        validation_alias=AliasChoices("strategy_version", "strategyVersion")
    )


class KnowledgeFSResearchTaskPartialsQuery(KnowledgeFSCursorQuery):
    limit: int = Field(default=25, ge=1, le=100)


class KnowledgeFSResearchTaskStreamQuery(BaseModel):
    knowledge_space_id: str = Field(min_length=1, max_length=255, alias="knowledgeSpaceId")
    cursor: str | None = Field(default=None, min_length=1, max_length=1_000)
    limit: int = Field(default=25, ge=1, le=100)

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSResearchTaskPartialResponse(ResponseModel):
    answer: str | None = Field(default=None, min_length=1, max_length=20_000)
    evidence_bundle: dict[str, object] = Field(validation_alias=AliasChoices("evidence_bundle", "evidenceBundle"))
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    research_task_job_id: str = Field(validation_alias=AliasChoices("research_task_job_id", "researchTaskJobId"))
    sequence: int = Field(ge=1)


class KnowledgeFSResearchTaskPartialListResponse(ResponseModel):
    data: list[KnowledgeFSResearchTaskPartialResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSAnswerTraceStepResponse(ResponseModel):
    ended_at: datetime | None = Field(default=None, validation_alias=AliasChoices("ended_at", "endedAt"))
    metadata: dict[str, object]
    name: str
    started_at: datetime = Field(validation_alias=AliasChoices("started_at", "startedAt"))
    status: Literal["error", "ok", "skipped"]


class KnowledgeFSAnswerTraceResponse(ResponseModel):
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    evidence_bundle_id: str | None = Field(
        default=None, validation_alias=AliasChoices("evidence_bundle_id", "evidenceBundleId")
    )
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    mode: Literal["auto", "deep", "fast", "research"]
    query: str
    steps: list[KnowledgeFSAnswerTraceStepResponse]


class KnowledgeFSTraceEntriesQuery(KnowledgeFSCursorQuery):
    limit: int = Field(default=100, ge=1, le=200)


class KnowledgeFSTraceEntryResponse(ResponseModel):
    kind: Literal["directory", "resource"]
    metadata: dict[str, object]
    name: str
    path: str
    resource_type: str | None = Field(default=None, validation_alias=AliasChoices("resource_type", "resourceType"))
    target_id: str | None = Field(default=None, validation_alias=AliasChoices("target_id", "targetId"))
    version: int | None = Field(default=None, ge=1)


class KnowledgeFSTraceEntryListResponse(ResponseModel):
    consistency_class: str | None = Field(
        default=None, validation_alias=AliasChoices("consistency_class", "consistencyClass")
    )
    data: list[KnowledgeFSTraceEntryResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))
    path: str
    preview: bool | None = None
    truncated: bool


class KnowledgeFSTraceProfileResponse(ResponseModel):
    embedding_model: str | None = Field(
        default=None, validation_alias=AliasChoices("embedding_model", "embeddingModel")
    )
    embedding_vector_space_id: str | None = Field(
        default=None, validation_alias=AliasChoices("embedding_vector_space_id", "embeddingVectorSpaceId")
    )
    projection_publication_id: str | None = Field(
        default=None, validation_alias=AliasChoices("projection_publication_id", "projectionPublicationId")
    )
    projection_version: int | None = Field(
        default=None, ge=1, validation_alias=AliasChoices("projection_version", "projectionVersion")
    )
    reasoning_model: str | None = Field(
        default=None, validation_alias=AliasChoices("reasoning_model", "reasoningModel")
    )
    rerank_model: str | None = Field(default=None, validation_alias=AliasChoices("rerank_model", "rerankModel"))
    retrieval_profile_revision: int | None = Field(
        default=None, ge=1, validation_alias=AliasChoices("retrieval_profile_revision", "retrievalProfileRevision")
    )


class KnowledgeFSTraceScoresResponse(ResponseModel):
    final: float | None = Field(default=None, ge=0, le=1)
    rerank: float | None = Field(default=None, ge=0, le=1)
    retrieval: float | None = Field(default=None, ge=0, le=1)


class KnowledgeFSTraceStageResponse(ResponseModel):
    candidate_count: int | None = Field(
        default=None, ge=0, validation_alias=AliasChoices("candidate_count", "candidateCount")
    )
    name: str
    status: Literal["error", "ok", "skipped"]


class KnowledgeFSTraceResponse(ResponseModel):
    id: str
    completed: bool
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    duration_ms: int | None = Field(default=None, ge=0, validation_alias=AliasChoices("duration_ms", "durationMs"))
    evidence_bundle_id: str | None = Field(
        default=None, validation_alias=AliasChoices("evidence_bundle_id", "evidenceBundleId")
    )
    evidence_state: str | None = Field(default=None, validation_alias=AliasChoices("evidence_state", "evidenceState"))
    final_score: float | None = Field(
        default=None, ge=0, le=1, validation_alias=AliasChoices("final_score", "finalScore")
    )
    mode: Literal["auto", "deep", "fast", "research"]
    profile: KnowledgeFSTraceProfileResponse
    query: str
    result_count: int = Field(ge=0, validation_alias=AliasChoices("result_count", "resultCount"))
    scores: KnowledgeFSTraceScoresResponse
    stages: list[KnowledgeFSTraceStageResponse]


class KnowledgeFSTraceListResponse(ResponseModel):
    data: list[KnowledgeFSTraceResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSGoldenQuestionPayload(BaseModel):
    annotation: str = Field(min_length=1, max_length=2_000)
    evidence_text: str = Field(default="", max_length=8_000)
    expected_evidence_ids: list[str] = Field(default_factory=list, max_length=50)
    match_policy: Literal["all", "any"] = "all"
    question: str = Field(min_length=1, max_length=4_000)
    source_bad_case_id: str | None = Field(default=None, max_length=255)
    tags: list[str] = Field(default_factory=list, max_length=50)

    model_config = ConfigDict(extra="forbid")

    @field_validator("annotation", "evidence_text", "question", mode="before")
    @classmethod
    def strip_required_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("expected_evidence_ids", "tags")
    @classmethod
    def normalize_string_list(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(item.strip() for item in value if item.strip()))


class KnowledgeFSGoldenQuestionRemotePayload(BaseModel):
    expected_evidence_ids: list[str] = Field(
        default_factory=list,
        serialization_alias="expectedEvidenceIds",
    )
    metadata: dict[str, object]
    question: str
    tags: list[str]

    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)


class KnowledgeFSGoldenQuestionUpdateRemotePayload(BaseModel):
    expected_evidence_ids: list[str] | None = Field(default=None, serialization_alias="expectedEvidenceIds")
    metadata: dict[str, object]
    question: str
    tags: list[str]

    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)


class KnowledgeFSGoldenQuestionResponse(ResponseModel):
    id: str
    question: str
    annotation: str
    evidence_text: str = ""
    expected_evidence_ids: list[str] = Field(
        default_factory=list, validation_alias=AliasChoices("expected_evidence_ids", "expectedEvidenceIds")
    )
    match_policy: Literal["all", "any"] = "all"
    status: Literal["active", "draft", "stale"]
    tags: list[str]
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))

    @model_validator(mode="before")
    @classmethod
    def read_annotation_metadata(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        metadata = value.get("metadata")
        annotation = metadata.get("annotation") if isinstance(metadata, dict) else None
        evidence_text = metadata.get("evidenceText") if isinstance(metadata, dict) else None
        match_policy = metadata.get("matchPolicy") if isinstance(metadata, dict) else None
        status = metadata.get("lifecycleStatus") if isinstance(metadata, dict) else None
        expected_evidence_ids = value.get("expectedEvidenceIds", value.get("expected_evidence_ids", []))
        if status not in {"active", "draft", "stale"}:
            status = "active" if isinstance(expected_evidence_ids, list) and expected_evidence_ids else "draft"
        return {
            **value,
            "annotation": annotation if isinstance(annotation, str) else "",
            "evidence_text": evidence_text if isinstance(evidence_text, str) else "",
            "match_policy": match_policy if match_policy in {"all", "any"} else "all",
            "status": status,
        }


class KnowledgeFSGoldenQuestionListResponse(ResponseModel):
    data: list[KnowledgeFSGoldenQuestionResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSGoldenQuestionEvidenceMatchPayload(BaseModel):
    evidence: str = Field(min_length=1, max_length=8_000)
    minimum_similarity: float = Field(default=0.7, ge=0, le=1)
    top_k: int = Field(default=5, ge=1, le=10)

    model_config = ConfigDict(extra="forbid")

    @field_validator("evidence", mode="before")
    @classmethod
    def strip_evidence(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class KnowledgeFSGoldenQuestionEvidenceMatchRemotePayload(BaseModel):
    evidence_texts: list[str] = Field(serialization_alias="evidenceTexts")
    minimum_similarity: float = Field(serialization_alias="minimumSimilarity")
    top_k: int = Field(serialization_alias="topK")

    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)


class KnowledgeFSGoldenQuestionEvidenceCandidateResponse(ResponseModel):
    document_asset_id: str = Field(validation_alias=AliasChoices("document_asset_id", "documentAssetId"))
    node_id: str = Field(validation_alias=AliasChoices("node_id", "nodeId"))
    page_number: int | None = Field(default=None, validation_alias=AliasChoices("page_number", "pageNumber"))
    projection_id: str = Field(validation_alias=AliasChoices("projection_id", "projectionId"))
    score: float = Field(ge=0, le=1)
    section_path: list[str] = Field(validation_alias=AliasChoices("section_path", "sectionPath"))
    text: str


class KnowledgeFSGoldenQuestionEvidenceMatchResponse(ResponseModel):
    candidates: list[KnowledgeFSGoldenQuestionEvidenceCandidateResponse]
    evidence: str
    matched: bool


class KnowledgeFSGoldenQuestionBulkImportRowPayload(BaseModel):
    evidence: str = Field(min_length=1, max_length=8_000)
    question: str = Field(min_length=1, max_length=4_000)
    tags: list[str] = Field(default_factory=list, max_length=50)

    model_config = ConfigDict(extra="forbid")

    @field_validator("evidence", "question", mode="before")
    @classmethod
    def strip_required_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(tag.strip() for tag in value if tag.strip()))


class KnowledgeFSGoldenQuestionBulkImportPayload(BaseModel):
    match_policy: Literal["all", "any"] = "all"
    minimum_similarity: float = Field(default=0.7, ge=0, le=1)
    rows: list[KnowledgeFSGoldenQuestionBulkImportRowPayload] = Field(min_length=1, max_length=500)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSGoldenQuestionBulkImportRemoteRowPayload(BaseModel):
    evidence: str
    metadata: dict[str, object]
    question: str
    tags: list[str]

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSGoldenQuestionBulkImportRemotePayload(BaseModel):
    match_policy: Literal["all", "any"] = Field(serialization_alias="matchPolicy")
    minimum_similarity: float = Field(serialization_alias="minimumSimilarity")
    rows: list[KnowledgeFSGoldenQuestionBulkImportRemoteRowPayload]

    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)


class KnowledgeFSGoldenQuestionBulkImportItemResponse(ResponseModel):
    expected_evidence_id: str | None = Field(
        default=None, validation_alias=AliasChoices("expected_evidence_id", "expectedEvidenceId")
    )
    question_id: str = Field(validation_alias=AliasChoices("question_id", "questionId"))
    row_index: int = Field(ge=0, validation_alias=AliasChoices("row_index", "rowIndex"))
    similarity: float | None = Field(default=None, ge=0, le=1)
    status: Literal["active", "draft"]


class KnowledgeFSGoldenQuestionBulkImportResponse(ResponseModel):
    active_count: int = Field(ge=0, validation_alias=AliasChoices("active_count", "activeCount"))
    draft_count: int = Field(ge=0, validation_alias=AliasChoices("draft_count", "draftCount"))
    items: list[KnowledgeFSGoldenQuestionBulkImportItemResponse]


class KnowledgeFSBadCaseUpdatePayload(BaseModel):
    expected_revision: int = Field(ge=1, serialization_alias="expectedRevision")
    reason: str | None = Field(default=None, min_length=1, max_length=4_000)
    replay_run_id: str | None = Field(default=None, serialization_alias="replayRunId")
    status: Literal["open", "replaying", "fixed", "dismissed"]
    tags: list[str] | None = Field(default=None, max_length=50)

    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)

    @field_validator("reason", mode="before")
    @classmethod
    def strip_optional_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class KnowledgeFSBadCaseCreatePayload(BaseModel):
    reason: str = Field(min_length=1, max_length=4_000)
    tags: list[str] = Field(default_factory=list, max_length=50)
    trace_id: str = Field(min_length=1, serialization_alias="traceId")

    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)

    @field_validator("reason", mode="before")
    @classmethod
    def strip_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(tag.strip() for tag in value if tag.strip()))


class KnowledgeFSBadCaseResponse(ResponseModel):
    id: str
    question: str = Field(default="", validation_alias=AliasChoices("question", "query"))
    reason: str
    replay_run_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("replay_run_id", "replayRunId"),
    )
    revision: int = Field(ge=1)
    status: Literal["open", "replaying", "fixed", "dismissed"]
    tags: list[str]
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


class KnowledgeFSBadCaseListResponse(ResponseModel):
    data: list[KnowledgeFSBadCaseResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSBadCaseTraceReferenceResponse(ResponseModel):
    trace_id: str = Field(validation_alias=AliasChoices("trace_id", "traceId"))


class KnowledgeFSQualityReplayPayload(BaseModel):
    golden_question_ids: list[str] = Field(
        min_length=1,
        max_length=100,
        serialization_alias="goldenQuestionIds",
    )
    mode: Literal["deep", "fast", "research"] | None = None

    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)


class KnowledgeFSQualityReplayResponse(ResponseModel):
    id: str
    revision: int = Field(ge=1)
    state: Literal["queued", "running", "passed", "failed", "canceled"]


class KnowledgeFSUploadSessionResponse(ResponseModel):
    compilation_job_id: str | None = Field(
        default=None, validation_alias=AliasChoices("compilation_job_id", "compilationJobId")
    )
    completed_at: int | None = Field(default=None, validation_alias=AliasChoices("completed_at", "completedAt"))
    document_asset_id: str | None = Field(
        default=None, validation_alias=AliasChoices("document_asset_id", "documentAssetId")
    )
    expected_size_bytes: int = Field(gt=0, validation_alias=AliasChoices("expected_size_bytes", "expectedSizeBytes"))
    expires_at: int = Field(ge=0, validation_alias=AliasChoices("expires_at", "expiresAt"))
    id: str = Field(min_length=1, max_length=255)
    mode: Literal["multipart", "single", "small_fallback"]
    multipart_part_count: int | None = Field(
        default=None, ge=1, validation_alias=AliasChoices("multipart_part_count", "multipartPartCount")
    )
    multipart_part_size_bytes: int | None = Field(
        default=None,
        gt=0,
        validation_alias=AliasChoices("multipart_part_size_bytes", "multipartPartSizeBytes"),
    )
    status: Literal[
        "creating",
        "ready",
        "completing",
        "completed",
        "aborting",
        "aborted",
        "expired",
        "failed",
    ]


class KnowledgeFSUploadSessionCreatePayload(BaseModel):
    checksum_sha256_base64: str = Field(
        min_length=1,
        max_length=255,
        alias="checksumSha256Base64",
    )
    content_type: str = Field(min_length=1, max_length=255, alias="contentType")
    expected_size_bytes: int = Field(gt=0, alias="expectedSizeBytes")
    file_name: str = Field(min_length=1, max_length=512, alias="fileName")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSUploadSessionCreateRemotePayload(KnowledgeFSUploadSessionCreatePayload):
    idempotency_key: str = Field(min_length=8, max_length=255, alias="idempotencyKey")


class KnowledgeFSPresignedUploadResponse(ResponseModel):
    expires_at: int = Field(ge=0, validation_alias=AliasChoices("expires_at", "expiresAt"))
    headers: dict[str, str]
    method: Literal["PUT"]
    url: str = Field(min_length=1, max_length=8_192)


class KnowledgeFSUploadSessionCreateResponse(ResponseModel):
    session: KnowledgeFSUploadSessionResponse
    upload: KnowledgeFSPresignedUploadResponse | None = None


class KnowledgeFSUploadPartPresignPayload(BaseModel):
    checksum_sha256_base64: str = Field(
        min_length=1,
        max_length=255,
        alias="checksumSha256Base64",
    )
    content_length: int = Field(gt=0, alias="contentLength")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSUploadSessionPartPayload(BaseModel):
    checksum_sha256_base64: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
        alias="checksumSha256Base64",
    )
    etag: str = Field(min_length=1, max_length=255)
    part_number: int = Field(ge=1, le=10_000, alias="partNumber")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSUploadSessionCompletePayload(BaseModel):
    parts: list[KnowledgeFSUploadSessionPartPayload] | None = Field(default=None, max_length=10_000)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSUploadSessionAbortPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class KnowledgeFSUploadSessionMutationResponse(ResponseModel):
    session: KnowledgeFSUploadSessionResponse


class KnowledgeFSSmallFileUploadResponse(ResponseModel):
    session: KnowledgeFSUploadSessionResponse


class KnowledgeFSStreamCapabilityPayload(BaseModel):
    control_space_id: str = Field(min_length=1, max_length=255)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSStreamCapabilityResponse(ResponseModel):
    token: str
    expires_at: datetime
    operation_id: Literal["streamResearchTask"]
    url: str


class KnowledgeFSQueryStreamCapabilityResponse(ResponseModel):
    token: str
    expires_at: datetime
    operation_id: Literal["createQuery"]
    url: str


class KnowledgeFSAdmittedQueryRequest(KnowledgeFSQueryCreatePayload):
    knowledge_space_id: str = Field(min_length=1, alias="knowledgeSpaceId")

    model_config = ConfigDict(
        extra="forbid",
        serialize_by_alias=True,
        validate_by_alias=True,
        validate_by_name=True,
    )


class KnowledgeFSQueryAdmissionResponse(ResponseModel):
    expires_at: datetime
    operation_id: Literal["createQuery"]
    request: KnowledgeFSAdmittedQueryRequest
    token: str
    url: str


class KnowledgeFSJWKResponse(ResponseModel):
    alg: Literal["RS256"]
    e: str
    kid: str
    kty: Literal["RSA"]
    n: str
    use: Literal["sig"]


class KnowledgeFSJWKSResponse(ResponseModel):
    keys: list[KnowledgeFSJWKResponse]


__all__ = [
    "KnowledgeFSAdmittedQueryRequest",
    "KnowledgeFSAnswerTraceResponse",
    "KnowledgeFSAppBindingListResponse",
    "KnowledgeFSAppBindingPayload",
    "KnowledgeFSAppBindingResponse",
    "KnowledgeFSBackgroundTaskFailureResponse",
    "KnowledgeFSBackgroundTaskListQuery",
    "KnowledgeFSBackgroundTaskListResponse",
    "KnowledgeFSBackgroundTaskResponse",
    "KnowledgeFSBulkDeletionAcceptedResponse",
    "KnowledgeFSBulkDocumentAvailabilityFailureResponse",
    "KnowledgeFSBulkDocumentAvailabilityItem",
    "KnowledgeFSBulkDocumentAvailabilityPayload",
    "KnowledgeFSBulkDocumentAvailabilityResponse",
    "KnowledgeFSBulkDocumentDeletePayload",
    "KnowledgeFSBulkJobResponse",
    "KnowledgeFSBulkLogicalDocumentDeletePayload",
    "KnowledgeFSCrawlImportPayload",
    "KnowledgeFSCrawlPreviewPageListQuery",
    "KnowledgeFSCrawlPreviewPageListResponse",
    "KnowledgeFSCrawlPreviewSelectionPayload",
    "KnowledgeFSCredentialCreatePayload",
    "KnowledgeFSCredentialCreateResponse",
    "KnowledgeFSCredentialItemResponse",
    "KnowledgeFSCredentialListResponse",
    "KnowledgeFSCursorQuery",
    "KnowledgeFSDocumentAvailabilityPayload",
    "KnowledgeFSDocumentBatchDownloadPayload",
    "KnowledgeFSDocumentChunkListQuery",
    "KnowledgeFSDocumentChunkListResponse",
    "KnowledgeFSDocumentChunkResponse",
    "KnowledgeFSDocumentCompilationJobResponse",
    "KnowledgeFSDocumentCreatePayload",
    "KnowledgeFSDocumentDeletePayload",
    "KnowledgeFSDocumentDownloadDescriptor",
    "KnowledgeFSDocumentListResponse",
    "KnowledgeFSDocumentMetadataPayload",
    "KnowledgeFSDocumentOutlineResponse",
    "KnowledgeFSDocumentReindexPayload",
    "KnowledgeFSDocumentReindexResponse",
    "KnowledgeFSDocumentResponse",
    "KnowledgeFSDocumentRevisionListResponse",
    "KnowledgeFSDocumentStagedUploadAcceptedResponse",
    "KnowledgeFSDocumentStagedUploadPayload",
    "KnowledgeFSDocumentUploadAcceptedResponse",
    "KnowledgeFSDocumentUploadCompilationJobResponse",
    "KnowledgeFSDocumentUploadLogicalDocumentResponse",
    "KnowledgeFSDurableDeletionAcceptedResponse",
    "KnowledgeFSExternalAccessPayload",
    "KnowledgeFSExternalAccessResponse",
    "KnowledgeFSIdempotencyHeader",
    "KnowledgeFSInitialDatasourceBindingPayload",
    "KnowledgeFSInitialOnlineDocumentSourcePayload",
    "KnowledgeFSInitialOnlineDriveSourcePayload",
    "KnowledgeFSInitialSourcePayload",
    "KnowledgeFSInitialSourcePreviewDocumentResponse",
    "KnowledgeFSInitialSourcePreviewFileResponse",
    "KnowledgeFSInitialSourcePreviewJobCreateResponse",
    "KnowledgeFSInitialSourcePreviewJobResponse",
    "KnowledgeFSInitialSourcePreviewPageResponse",
    "KnowledgeFSInitialSourcePreviewPayload",
    "KnowledgeFSInitialSourcePreviewResponse",
    "KnowledgeFSInitialWebsiteCrawlOptionsPayload",
    "KnowledgeFSInitialWebsiteSelectionPayload",
    "KnowledgeFSInitialWebsiteSourcePayload",
    "KnowledgeFSInitialWebsiteSourcePreviewPayload",
    "KnowledgeFSJWKResponse",
    "KnowledgeFSJWKSResponse",
    "KnowledgeFSLogicalDocumentDeletePayload",
    "KnowledgeFSLogicalDocumentListResponse",
    "KnowledgeFSLogicalDocumentResponse",
    "KnowledgeFSMemberBindingPayload",
    "KnowledgeFSMembersReplacePayload",
    "KnowledgeFSModelIntent",
    "KnowledgeFSOnlineDocumentWorkflowImportItemPayload",
    "KnowledgeFSOnlineDriveWorkflowImportItemPayload",
    "KnowledgeFSOverviewBaseStatsResponse",
    "KnowledgeFSOverviewCountComparisonResponse",
    "KnowledgeFSOverviewHealthComponentResponse",
    "KnowledgeFSOverviewHealthComponentsResponse",
    "KnowledgeFSOverviewHealthResponse",
    "KnowledgeFSOverviewIndexCoverageResponse",
    "KnowledgeFSOverviewInventoryDeltaResponse",
    "KnowledgeFSOverviewInventoryResponse",
    "KnowledgeFSOverviewQueryOutcomeBucketResponse",
    "KnowledgeFSOverviewQueryOutcomeCountsResponse",
    "KnowledgeFSOverviewQueryOutcomesResponse",
    "KnowledgeFSOverviewRateComparisonResponse",
    "KnowledgeFSOverviewSourceCategoriesResponse",
    "KnowledgeFSOverviewStatsCurrentResponse",
    "KnowledgeFSOverviewStatsResponse",
    "KnowledgeFSOverviewStatsWindowResponse",
    "KnowledgeFSOverviewWindowQuery",
    "KnowledgeFSPermissionListResponse",
    "KnowledgeFSPermissionResponse",
    "KnowledgeFSPresignedUploadResponse",
    "KnowledgeFSPublicFailureResponse",
    "KnowledgeFSQualityListQuery",
    "KnowledgeFSQueryAdmissionResponse",
    "KnowledgeFSQueryCreatePayload",
    "KnowledgeFSQueryResponse",
    "KnowledgeFSQueryStreamCapabilityResponse",
    "KnowledgeFSRerankIntent",
    "KnowledgeFSResearchTaskCreatePayload",
    "KnowledgeFSResearchTaskLimits",
    "KnowledgeFSResearchTaskListResponse",
    "KnowledgeFSResearchTaskPartialListResponse",
    "KnowledgeFSResearchTaskPartialsQuery",
    "KnowledgeFSResearchTaskPlanPayload",
    "KnowledgeFSResearchTaskPlanResponse",
    "KnowledgeFSResearchTaskResponse",
    "KnowledgeFSRetrievalProfileIntent",
    "KnowledgeFSScoreThresholdIntent",
    "KnowledgeFSSettingsPayload",
    "KnowledgeFSSettingsResponse",
    "KnowledgeFSSmallFileUploadResponse",
    "KnowledgeFSSourceConnectionCreatePayload",
    "KnowledgeFSSourceConnectionListQuery",
    "KnowledgeFSSourceConnectionListResponse",
    "KnowledgeFSSourceConnectionRefreshPayload",
    "KnowledgeFSSourceConnectionResponse",
    "KnowledgeFSSourceCrawlResponse",
    "KnowledgeFSSourceCreatePayload",
    "KnowledgeFSSourceCredentialTestResponse",
    "KnowledgeFSSourceDeletePayload",
    "KnowledgeFSSourceDeleteQuery",
    "KnowledgeFSSourceFilesQuery",
    "KnowledgeFSSourceFilesResponse",
    "KnowledgeFSSourceImportFilesPayload",
    "KnowledgeFSSourceImportPagesPayload",
    "KnowledgeFSSourceImportResponse",
    "KnowledgeFSSourceListQuery",
    "KnowledgeFSSourceListResponse",
    "KnowledgeFSSourcePagesQuery",
    "KnowledgeFSSourcePagesResponse",
    "KnowledgeFSSourceProviderListResponse",
    "KnowledgeFSSourceResponse",
    "KnowledgeFSSourceSyncPolicyPayload",
    "KnowledgeFSSourceSyncPolicyResponse",
    "KnowledgeFSSourceUpdatePayload",
    "KnowledgeFSSourceWorkflowCancelPayload",
    "KnowledgeFSSourceWorkflowImportPayload",
    "KnowledgeFSSourceWorkflowResponse",
    "KnowledgeFSSpaceCreatePayload",
    "KnowledgeFSSpaceCreateResponse",
    "KnowledgeFSSpaceDetailResponse",
    "KnowledgeFSSpaceListItemResponse",
    "KnowledgeFSSpaceListQuery",
    "KnowledgeFSSpaceListResponse",
    "KnowledgeFSSpaceUpdatePayload",
    "KnowledgeFSStagedUploadResponse",
    "KnowledgeFSStreamCapabilityPayload",
    "KnowledgeFSStreamCapabilityResponse",
    "KnowledgeFSTechnicalSummary",
    "KnowledgeFSTraceEntriesQuery",
    "KnowledgeFSTraceEntryListResponse",
    "KnowledgeFSTraceListResponse",
    "KnowledgeFSTraceResponse",
    "KnowledgeFSUploadPartPresignPayload",
    "KnowledgeFSUploadSessionAbortPayload",
    "KnowledgeFSUploadSessionCompletePayload",
    "KnowledgeFSUploadSessionCreatePayload",
    "KnowledgeFSUploadSessionCreateRemotePayload",
    "KnowledgeFSUploadSessionCreateResponse",
    "KnowledgeFSUploadSessionMutationResponse",
    "KnowledgeFSUploadSessionPartPayload",
    "KnowledgeFSUploadSessionResponse",
]
