"""Response schemas for dataset document endpoints."""

from datetime import datetime
from typing import Any, Literal

from pydantic import AliasChoices, ConfigDict, Field, JsonValue, field_validator

from fields.base import ResponseModel
from libs.helper import to_timestamp


def normalize_enum(value: Any) -> Any:
    if isinstance(value, str) or value is None:
        return value
    return getattr(value, "value", value)


class DocumentPreProcessingRuleResponse(ResponseModel):
    id: str
    enabled: bool


class DocumentSegmentationResponse(ResponseModel):
    # Older rules store the separator as `delimiter`.
    separator: str = Field(default="\n", validation_alias=AliasChoices("separator", "delimiter"))
    max_tokens: int
    chunk_overlap: int = 0


class DocumentProcessRulesResponse(ResponseModel):
    pre_processing_rules: list[DocumentPreProcessingRuleResponse] | None = None
    segmentation: DocumentSegmentationResponse | None = None
    parent_mode: Literal["full-doc", "paragraph"] | None = None
    subchunk_segmentation: DocumentSegmentationResponse | None = None


class DocumentProcessRuleResponse(ResponseModel):
    mode: str
    rules: DocumentProcessRulesResponse | None = None


class DocumentUploadFileDetailResponse(ResponseModel):
    id: str
    name: str
    size: int
    extension: str
    mime_type: str | None = None
    created_by: str
    created_at: float


class DocumentSourceDetailResponse(ResponseModel):
    """The uploaded file for file documents; Notion and website documents repeat their source info."""

    model_config = ConfigDict(extra="allow")

    upload_file: DocumentUploadFileDetailResponse | None = Field(default=None, exclude_if=lambda value: value is None)


class DocumentMetadataResponse(ResponseModel):
    id: str
    name: str
    type: str
    value: str | int | float | bool | None = None


class DocumentResponse(ResponseModel):
    id: str
    position: int | None = None
    data_source_type: str | None = None
    # Source-specific settings, written by the data source that imported the document.
    data_source_info: dict[str, JsonValue] | None = Field(default=None, validation_alias="data_source_info_dict")
    data_source_detail_dict: DocumentSourceDetailResponse
    dataset_process_rule_id: str | None = None
    name: str
    created_from: str | None = None
    created_by: str | None = None
    created_at: int | None = None
    tokens: int | None = None
    indexing_status: str | None = None
    error: str | None = None
    enabled: bool | None = None
    disabled_at: int | None = None
    disabled_by: str | None = None
    archived: bool | None = None
    display_status: str | None = None
    word_count: int | None = None
    hit_count: int | None = None
    doc_form: str | None = None
    doc_metadata: list[DocumentMetadataResponse] = Field(default_factory=list, validation_alias="doc_metadata_details")
    summary_index_status: str | None = None
    need_summary: bool | None = None

    @field_validator("data_source_type", "indexing_status", "display_status", "doc_form", mode="before")
    @classmethod
    def _normalize_enum_fields(cls, value: Any) -> Any:
        return normalize_enum(value)

    @field_validator("doc_metadata", mode="before")
    @classmethod
    def _normalize_doc_metadata(cls, value: Any) -> list[Any]:
        if value is None:
            return []
        return value

    @field_validator("created_at", "disabled_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class DocumentListResponse(ResponseModel):
    data: list[DocumentResponse]
    has_more: bool
    limit: int
    total: int
    page: int


class DocumentStatusResponse(ResponseModel):
    id: str
    indexing_status: str
    processing_started_at: int | None
    parsing_completed_at: int | None
    cleaning_completed_at: int | None
    splitting_completed_at: int | None
    completed_at: int | None
    paused_at: int | None
    error: str | None
    error_code: str | None = None
    estimated_vector_space_mb: int | None = None
    vector_space_limit_mb: int | None = None
    stopped_at: int | None
    completed_segments: int | None = None
    total_segments: int | None = None

    @field_validator("indexing_status", mode="before")
    @classmethod
    def _normalize_indexing_status(cls, value: Any) -> Any:
        return normalize_enum(value)

    @field_validator(
        "processing_started_at",
        "parsing_completed_at",
        "cleaning_completed_at",
        "splitting_completed_at",
        "completed_at",
        "paused_at",
        "stopped_at",
        mode="before",
    )
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class DocumentStatusListResponse(ResponseModel):
    data: list[DocumentStatusResponse]
