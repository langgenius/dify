"""Shared KnowledgeFS contracts consumed by workflow nodes and application services."""

from __future__ import annotations

import math
import re
from datetime import UTC, datetime
from typing import Annotated, ClassVar, Literal
from uuid import UUID

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from fields.base import ResponseModel
from models.knowledge_fs import (
    KnowledgeFSAppSpaceJoinType,
)


class KnowledgeFSAppBindingPayload(BaseModel):
    app_id: str = Field(min_length=1)
    caller_kind: KnowledgeFSAppSpaceJoinType

    model_config = ConfigDict(extra="forbid")


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


KnowledgeFSPublicErrorCode = Literal[
    "DOCUMENT_COMPILATION_FAILED",
    "DOCUMENT_COMPILATION_RETRYABLE",
    "DOCUMENT_COMPILATION_LEASE_LOST",
    "DOCUMENT_DISABLED",
    "DOCUMENT_PARSER_INPUT_INVALID",
    "DOCUMENT_PARSER_NOT_CONFIGURED",
    "DOCUMENT_PARSER_RATE_LIMITED",
    "DOCUMENT_PARSER_RESPONSE_INVALID",
    "DOCUMENT_PARSER_TIMEOUT",
    "DOCUMENT_PARSER_UNAVAILABLE",
    "DOCUMENT_PARSER_UNSUPPORTED_TYPE",
    "DOCUMENT_PDF_RENDER_FAILED",
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
    "MODEL_RUNTIME_RESPONSE_INVALID",
    "MODEL_RUNTIME_TIMEOUT",
    "MODEL_RUNTIME_UNAVAILABLE",
    "MODEL_SELECTION_NOT_FOUND",
    "RESEARCH_TASK_CAPABILITY_REVOKED",
    "RESEARCH_TASK_DISPATCH_DEAD",
    "RESEARCH_TASK_EXECUTION_ATTEMPTS_EXHAUSTED",
    "RESEARCH_TASK_FAILED",
    "RESEARCH_TASK_PERMISSION_SNAPSHOT_INVALID",
    "RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID",
    "RETRIEVAL_DELETION_IN_PROGRESS",
    "RETRIEVAL_EXECUTION_LEASE_LOST",
    "SOURCE_BULK_ACTION_FAILED",
    "SOURCE_CONNECTION_UNAVAILABLE",
    "SOURCE_CRAWL_PAGE_NOT_FOUND",
    "SOURCE_CRAWL_PROVIDER_UNAVAILABLE",
    "SOURCE_CRAWL_RESULT_LIMIT_EXCEEDED",
    "SOURCE_CREDENTIAL_CONFIG_INVALID",
    "SOURCE_CREDENTIAL_MUTATION_FAILED",
    "SOURCE_CREDENTIAL_TEST_FAILED",
    "SOURCE_CREDENTIAL_UNAVAILABLE",
    "SOURCE_DOCUMENT_COMPILATION_FAILED",
    "SOURCE_DOCUMENT_MATERIALIZATION_FAILED",
    "SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED",
    "SOURCE_IMPORT_PARTIAL_FAILURE",
    "SOURCE_ONLINE_DOCUMENT_CONFIG_INVALID",
    "SOURCE_ONLINE_DOCUMENT_IMPORT_FAILED",
    "SOURCE_ONLINE_DOCUMENT_PAGE_FETCH_FAILED",
    "SOURCE_ONLINE_DOCUMENT_REQUEST_FAILED",
    "SOURCE_ONLINE_DOCUMENT_UNAVAILABLE",
    "SOURCE_ONLINE_DRIVE_CONFIG_INVALID",
    "SOURCE_ONLINE_DRIVE_FILE_DOWNLOAD_FAILED",
    "SOURCE_ONLINE_DRIVE_IMPORT_FAILED",
    "SOURCE_ONLINE_DRIVE_REQUEST_FAILED",
    "SOURCE_ONLINE_DRIVE_UNAVAILABLE",
    "SOURCE_OPERATION_FAILED",
    "SOURCE_SECRET_INTEGRITY_FAILED",
    "SOURCE_SECRET_REF_CONFLICT",
    "SOURCE_SYNC_FAILED",
    "SOURCE_PROVIDER_REJECTED",
    "SOURCE_PROVIDER_TIMEOUT",
    "SOURCE_PROVIDER_UNAVAILABLE",
    "SOURCE_SYNC_SELECTION_MISMATCH",
    "SOURCE_WEBSITE_CRAWL_CONFIG_INVALID",
    "SOURCE_WEBSITE_CRAWL_FAILED",
    "SOURCE_WORKFLOW_FAILED",
    "SOURCE_WORKFLOW_CONTENT_MISSING",
    "SOURCE_WORKFLOW_CONTENT_TOO_LARGE",
    "SOURCE_WORKFLOW_EXTERNAL_TIMEOUT",
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
    _SAFE_MESSAGE_BY_CODE: ClassVar[dict[str, str]] = {
        "RETRIEVAL_DELETION_IN_PROGRESS": "This knowledge space is being deleted and cannot be searched.",
        "RETRIEVAL_EXECUTION_LEASE_LOST": (
            "The retrieval execution expired before it could finish. Run the query again."
        ),
        "SOURCE_SYNC_SELECTION_MISMATCH": ("The source document inventory does not match the configured selection."),
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
        self.message = self._SAFE_MESSAGE_BY_CODE.get(self.code, self._SAFE_MESSAGE_BY_CATEGORY[self.category])
        return self


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


class KnowledgeFSRetrievalQueryImageReference(KnowledgeFSQueryImageReference):
    """Transient workflow file authorization forwarded only by retrieval-test requests."""

    access_grant: str | None = Field(
        default=None,
        min_length=1,
        max_length=2_048,
        alias="accessGrant",
        exclude_if=lambda value: value is None,
        repr=False,
    )


KnowledgeFSRetrievalFilterValue = Annotated[str, Field(min_length=1, max_length=512)]


KnowledgeFSRetrievalCustomMetadataOperator = Literal[
    "contains",
    "not contains",
    "start with",
    "end with",
    "is",
    "is not",
    "empty",
    "not empty",
    "in",
    "not in",
    "=",
    "≠",
    ">",
    "<",
    "≥",
    "≤",
    "before",
    "after",
]


KnowledgeFSRetrievalReservedMetadataNames = frozenset(
    {"displayName", "provenance", "retrievalCount", "sourceName", "system"}
)


class KnowledgeFSRetrievalCustomMetadataCondition(BaseModel):
    name: str = Field(min_length=1, max_length=255, pattern=r"^[a-z][a-z0-9_]*$")
    field_type: Literal["string", "number", "time"] = Field(
        validation_alias=AliasChoices("field_type", "fieldType"),
        serialization_alias="fieldType",
    )
    comparison_operator: KnowledgeFSRetrievalCustomMetadataOperator = Field(
        validation_alias=AliasChoices("comparison_operator", "comparisonOperator"),
        serialization_alias="comparisonOperator",
    )
    value: str | int | float | None = Field(default=None, exclude_if=lambda value: value is None)

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if value in KnowledgeFSRetrievalReservedMetadataNames:
            raise ValueError("Retrieval custom metadata field name must be non-reserved")
        return value

    @field_validator("value")
    @classmethod
    def validate_value(cls, value: str | int | float | None) -> str | int | float | None:
        if isinstance(value, bool):
            raise ValueError("Retrieval custom metadata values must not be booleans")
        if isinstance(value, str) and len(value) > 512:
            raise ValueError("Retrieval custom metadata string values must contain at most 512 characters")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("Retrieval custom metadata numeric values must be finite")
        return value

    @model_validator(mode="after")
    def validate_operator_and_value(self) -> KnowledgeFSRetrievalCustomMetadataCondition:
        operators = {
            "number": {"=", "≠", ">", "<", "≥", "≤", "empty", "not empty"},
            "string": {
                "contains",
                "not contains",
                "start with",
                "end with",
                "is",
                "is not",
                "empty",
                "not empty",
                "in",
                "not in",
            },
            "time": {"is", "before", "after", "empty", "not empty"},
        }
        if self.comparison_operator not in operators[self.field_type]:
            raise ValueError(f"Retrieval custom metadata operator is invalid for {self.field_type}")
        if self.comparison_operator in {"empty", "not empty"}:
            return self
        if self.value is None:
            raise ValueError("Retrieval custom metadata condition value is required")
        if self.field_type == "number" and (isinstance(self.value, bool) or not isinstance(self.value, int | float)):
            raise ValueError("Retrieval custom metadata number conditions require a numeric value")
        if self.field_type == "string" and not isinstance(self.value, str):
            raise ValueError("Retrieval custom metadata string conditions require a string value")
        if self.field_type == "time":
            if isinstance(self.value, bool) or not isinstance(self.value, str | int | float):
                raise ValueError("Retrieval custom metadata time conditions require a timestamp value")
            if isinstance(self.value, str):
                try:
                    datetime.fromisoformat(self.value)
                except ValueError as exc:
                    raise ValueError("Retrieval custom metadata time conditions require a valid timestamp") from exc
            else:
                try:
                    datetime.fromtimestamp(self.value, tz=UTC)
                except (OverflowError, OSError, ValueError) as exc:
                    raise ValueError("Retrieval custom metadata time conditions require a valid timestamp") from exc
        return self


class KnowledgeFSRetrievalCustomMetadataFilter(BaseModel):
    logical_operator: Literal["and", "or"] = Field(
        default="and",
        validation_alias=AliasChoices("logical_operator", "logicalOperator"),
        serialization_alias="logicalOperator",
    )
    conditions: list[KnowledgeFSRetrievalCustomMetadataCondition] = Field(default_factory=list, max_length=50)

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)


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
    custom_metadata: KnowledgeFSRetrievalCustomMetadataFilter | None = Field(
        default=None,
        validation_alias=AliasChoices("custom_metadata", "customMetadata"),
        serialization_alias="customMetadata",
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
    query: str = Field(default="", max_length=16_000)
    query_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("query_id", "queryId"),
        serialization_alias="queryId",
    )
    query_images: list[KnowledgeFSRetrievalQueryImageReference] = Field(
        default_factory=list,
        max_length=4,
        alias="queryImages",
        exclude_if=lambda value: not value,
    )
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
        return value.strip()

    @model_validator(mode="after")
    def validate_query_modality(self) -> KnowledgeFSRetrievalTestPayload:
        if not self.query and not self.query_images:
            raise ValueError("At least one of query or queryImages is required")
        if len({image.upload_file_id for image in self.query_images}) != len(self.query_images):
            raise ValueError("queryImages must not contain duplicate uploadFileId values")
        return self


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
    document_title: str | None = Field(
        default=None,
        max_length=512,
        validation_alias=AliasChoices("document_title", "documentTitle"),
    )
    document_version: int = Field(
        gt=0,
        validation_alias=AliasChoices("document_version", "documentVersion"),
    )
    knowledge_space_name: str | None = Field(
        default=None,
        max_length=160,
        validation_alias=AliasChoices("knowledge_space_name", "knowledgeSpaceName"),
    )
    logical_document_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=512,
        validation_alias=AliasChoices("logical_document_id", "logicalDocumentId"),
    )
    logical_document_revision: int | None = Field(
        default=None,
        gt=0,
        validation_alias=AliasChoices("logical_document_revision", "logicalDocumentRevision"),
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
    # AnswerTrace recorded for this run in the space's retrieval history; a failed-retrieval capture
    # attaches to it so one record stays per retrieval.
    answer_trace_id: str | None = Field(default=None, validation_alias=AliasChoices("answer_trace_id", "answerTraceId"))
    items: list[KnowledgeFSRetrievalTestItemResponse] = Field(max_length=100)
    metrics: KnowledgeFSRetrievalTestMetricsResponse
    mode: Literal["deep", "fast", "research"]
    trace_id: str = Field(min_length=1, max_length=512, validation_alias=AliasChoices("trace_id", "traceId"))
