"""Typed product and BFF DTOs independent from Dify Dataset/Document models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

from fields.base import ResponseModel
from models.knowledge_fs import (
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpaceState,
    KnowledgeFSControlSpaceVisibility,
)
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission


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
        if self.enabled and self.model is None:
            raise ValueError("Enabled rerank requires a model selection")
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


class KnowledgeFSSpaceCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=160, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    icon: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=2_000)
    visibility: KnowledgeFSControlSpaceVisibility = KnowledgeFSControlSpaceVisibility.ONLY_ME
    embedding: KnowledgeFSModelIntent
    retrieval: KnowledgeFSRetrievalProfileIntent
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=255)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSSpaceUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    icon: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=2_000)
    visibility: KnowledgeFSControlSpaceVisibility | None = None

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSSpaceListQuery(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSCursorQuery(BaseModel):
    cursor: str | None = Field(default=None, min_length=1, max_length=1_000)

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


class KnowledgeFSSpaceListItemResponse(ResponseModel):
    control_space_id: str
    state: KnowledgeFSControlSpaceState
    visibility: KnowledgeFSControlSpaceVisibility
    owner_account_id: str
    knowledge_space_id: str | None
    resource_version: int
    permission_keys: list[KnowledgeFSProductPermission]
    technical_status: Literal["available", "not_ready", "unavailable"]
    technical_summary: KnowledgeFSTechnicalSummary | None = None


class KnowledgeFSSpaceListResponse(ResponseModel):
    data: list[KnowledgeFSSpaceListItemResponse]
    page: int
    limit: int
    has_more: bool


class KnowledgeFSSpaceDetailResponse(KnowledgeFSSpaceListItemResponse):
    created_at: datetime
    updated_at: datetime


class KnowledgeFSSpaceCreateResponse(ResponseModel):
    control_space_id: str
    state: KnowledgeFSControlSpaceState
    operation_id: str


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

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


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


class KnowledgeFSSettingsPayload(BaseModel):
    embedding: KnowledgeFSProfileModelSelection | None = None
    retrieval: KnowledgeFSProductRetrievalProfile | None = None
    expected_revision: int = Field(ge=1, alias="expectedRevision")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)

    @model_validator(mode="after")
    def validate_setting_present(self) -> KnowledgeFSSettingsPayload:
        if self.embedding is None and self.retrieval is None:
            raise ValueError("At least one KnowledgeFS setting must be supplied")
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


class KnowledgeFSDocumentListResponse(ResponseModel):
    data: list[KnowledgeFSDocumentResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSDocumentOutlineNodeResponse(ResponseModel):
    child_node_ids: list[str] = Field(
        default_factory=list, validation_alias=AliasChoices("child_node_ids", "childNodeIds")
    )
    children: list[dict[str, object]] = Field(default_factory=list)
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


class KnowledgeFSDocumentRevisionListResponse(ResponseModel):
    data: list[KnowledgeFSDocumentRevisionResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSDocumentMetadataPayload(BaseModel):
    expected_row_version: int = Field(ge=0, alias="expectedRowVersion")
    patch: dict[str, object]

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSDocumentChunkResponse(ResponseModel):
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    document_id: str = Field(validation_alias=AliasChoices("document_id", "documentId"))
    document_revision: int = Field(ge=1, validation_alias=AliasChoices("document_revision", "documentRevision"))
    enabled: bool
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    ordinal: int = Field(ge=0)
    parent_chunk_id: str | None = Field(default=None, validation_alias=AliasChoices("parent_chunk_id", "parentChunkId"))
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
    completed_items: int = Field(ge=0, validation_alias=AliasChoices("completed_items", "completedItems"))
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    failed_item_ids: list[str] = Field(validation_alias=AliasChoices("failed_item_ids", "failedItemIds"))
    failed_items: int = Field(ge=0, validation_alias=AliasChoices("failed_items", "failedItems"))
    id: str
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    status: Literal["completed", "failed", "running"]
    total_items: int = Field(ge=0, validation_alias=AliasChoices("total_items", "totalItems"))
    type: Literal["document_delete", "document_reindex", "document_upload"]
    updated_at: datetime = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


class KnowledgeFSDocumentReindexItemResponse(ResponseModel):
    asset: KnowledgeFSDocumentResponse | None = None
    compilation_job: dict[str, object] | None = Field(
        default=None, validation_alias=AliasChoices("compilation_job", "compilationJob")
    )
    document_id: str | None = Field(default=None, validation_alias=AliasChoices("document_id", "documentId"))
    status: Literal["not_found", "queued"]
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


class KnowledgeFSSourceResponse(ResponseModel):
    id: str
    connection_id: str | None = Field(default=None, validation_alias=AliasChoices("connection_id", "connectionId"))
    credential_configured: bool | None = Field(
        default=None, validation_alias=AliasChoices("credential_configured", "credentialConfigured")
    )
    created_at: datetime = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    knowledge_space_id: str = Field(validation_alias=AliasChoices("knowledge_space_id", "knowledgeSpaceId"))
    metadata: dict[str, object]
    name: str
    permission_scope: list[str] = Field(validation_alias=AliasChoices("permission_scope", "permissionScope"))
    status: Literal["active", "disabled", "error", "syncing"]
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
    code: str | None = None
    error: str | None = None
    valid: bool


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
    code: str
    error: str
    filename: str


class KnowledgeFSSourceImportResponse(ResponseModel):
    documents: list[KnowledgeFSSourceImportedDocumentResponse]
    failed: list[KnowledgeFSSourceImportFailureResponse]
    skipped: list[str]


class KnowledgeFSQueryCreatePayload(BaseModel):
    query: str = Field(min_length=1, max_length=16_000)
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
    session_id: str | None = Field(default=None, alias="sessionId")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSQueryResponse(ResponseModel):
    id: str
    status: str
    answer: str | None = None
    trace_id: str | None = None


class KnowledgeFSResearchTaskLimits(BaseModel):
    max_retrieval_steps: int | None = Field(default=None, ge=1, alias="maxRetrievalSteps")
    max_scanned_resources: int | None = Field(default=None, ge=1, alias="maxScannedResources")
    max_tool_calls: int | None = Field(default=None, ge=1, alias="maxToolCalls")
    timeout_ms: int | None = Field(default=None, ge=1, alias="timeoutMs")

    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=True)


class KnowledgeFSResearchTaskCreatePayload(BaseModel):
    query: str = Field(min_length=1, max_length=16_000)
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
    created_at: float = Field(validation_alias=AliasChoices("created_at", "createdAt"))
    updated_at: float = Field(validation_alias=AliasChoices("updated_at", "updatedAt"))


class KnowledgeFSResearchTaskListResponse(ResponseModel):
    data: list[KnowledgeFSResearchTaskResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


class KnowledgeFSResearchTaskPlanPayload(BaseModel):
    budget_usd: float | None = Field(default=None, ge=0, alias="budgetUsd")
    mode: Literal["auto", "deep", "fast", "research"] | None = None
    query: str = Field(min_length=1, max_length=16_000)
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
    retrieval_plan: KnowledgeFSResearchTaskRetrievalPlanResponse = Field(
        validation_alias=AliasChoices("retrieval_plan", "retrievalPlan")
    )
    steps: list[dict[str, object]]
    strategy_version: Literal["research-dry-run-planner-v1"] = Field(
        validation_alias=AliasChoices("strategy_version", "strategyVersion")
    )


class KnowledgeFSResearchTaskPartialsQuery(KnowledgeFSCursorQuery):
    limit: int = Field(default=25, ge=1, le=100)


class KnowledgeFSResearchTaskPartialResponse(ResponseModel):
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
    scores: KnowledgeFSTraceScoresResponse
    stages: list[KnowledgeFSTraceStageResponse]


class KnowledgeFSTraceListResponse(ResponseModel):
    data: list[KnowledgeFSTraceResponse] = Field(validation_alias=AliasChoices("data", "items"))
    next_cursor: str | None = Field(default=None, validation_alias=AliasChoices("next_cursor", "nextCursor"))


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


class KnowledgeFSSmallFileUploadResponse(ResponseModel):
    session: KnowledgeFSUploadSessionResponse


class KnowledgeFSCapabilityResponse(ResponseModel):
    token: str
    expires_at: datetime
    direct_origin: str
    operation_id: Literal[
        "createUploadSession",
        "presignUploadSessionPart",
        "completeUploadSession",
        "abortUploadSession",
    ]


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


class KnowledgeFSUploadCapabilityPayload(BaseModel):
    operation_id: Literal[
        "createUploadSession",
        "presignUploadSessionPart",
        "completeUploadSession",
        "abortUploadSession",
    ]
    upload_session_id: str | None = Field(default=None, min_length=1, max_length=255)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_resource_binding(self) -> KnowledgeFSUploadCapabilityPayload:
        if self.operation_id == "createUploadSession" and self.upload_session_id is not None:
            raise ValueError("createUploadSession must not include upload_session_id")
        if self.operation_id != "createUploadSession" and self.upload_session_id is None:
            raise ValueError("upload_session_id is required for this operation")
        return self


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
    "KnowledgeFSBulkDeletionAcceptedResponse",
    "KnowledgeFSBulkDocumentDeletePayload",
    "KnowledgeFSBulkJobResponse",
    "KnowledgeFSCapabilityResponse",
    "KnowledgeFSCredentialCreatePayload",
    "KnowledgeFSCredentialCreateResponse",
    "KnowledgeFSCredentialItemResponse",
    "KnowledgeFSCredentialListResponse",
    "KnowledgeFSCursorQuery",
    "KnowledgeFSDocumentChunkListQuery",
    "KnowledgeFSDocumentChunkListResponse",
    "KnowledgeFSDocumentChunkResponse",
    "KnowledgeFSDocumentCompilationJobResponse",
    "KnowledgeFSDocumentCreatePayload",
    "KnowledgeFSDocumentDeletePayload",
    "KnowledgeFSDocumentListResponse",
    "KnowledgeFSDocumentMetadataPayload",
    "KnowledgeFSDocumentOutlineResponse",
    "KnowledgeFSDocumentReindexPayload",
    "KnowledgeFSDocumentReindexResponse",
    "KnowledgeFSDocumentResponse",
    "KnowledgeFSDocumentRevisionListResponse",
    "KnowledgeFSDurableDeletionAcceptedResponse",
    "KnowledgeFSExternalAccessPayload",
    "KnowledgeFSExternalAccessResponse",
    "KnowledgeFSIdempotencyHeader",
    "KnowledgeFSJWKResponse",
    "KnowledgeFSJWKSResponse",
    "KnowledgeFSMemberBindingPayload",
    "KnowledgeFSMembersReplacePayload",
    "KnowledgeFSModelIntent",
    "KnowledgeFSPermissionListResponse",
    "KnowledgeFSPermissionResponse",
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
    "KnowledgeFSSourceListResponse",
    "KnowledgeFSSourcePagesQuery",
    "KnowledgeFSSourcePagesResponse",
    "KnowledgeFSSourceResponse",
    "KnowledgeFSSourceUpdatePayload",
    "KnowledgeFSSpaceCreatePayload",
    "KnowledgeFSSpaceCreateResponse",
    "KnowledgeFSSpaceDetailResponse",
    "KnowledgeFSSpaceListItemResponse",
    "KnowledgeFSSpaceListQuery",
    "KnowledgeFSSpaceListResponse",
    "KnowledgeFSSpaceUpdatePayload",
    "KnowledgeFSStreamCapabilityPayload",
    "KnowledgeFSStreamCapabilityResponse",
    "KnowledgeFSTechnicalSummary",
    "KnowledgeFSTraceEntriesQuery",
    "KnowledgeFSTraceEntryListResponse",
    "KnowledgeFSTraceListResponse",
    "KnowledgeFSTraceResponse",
    "KnowledgeFSUploadCapabilityPayload",
    "KnowledgeFSUploadSessionResponse",
]
