"""Response schemas for dataset document endpoints."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import Field, field_validator
from sqlalchemy.orm import Session

from fields.base import ResponseModel
from libs.helper import to_timestamp
from models.dataset import DocMetadataDetailItem, Document


def normalize_enum(value: Any) -> Any:
    if isinstance(value, str) or value is None:
        return value
    return getattr(value, "value", value)


class DocumentMetadataResponse(ResponseModel):
    id: str
    name: str
    type: str
    value: str | int | float | bool | None = None


class DocumentResponse(ResponseModel):
    id: str
    position: int | None = None
    data_source_type: str | None = None
    data_source_info: Any = Field(default=None, validation_alias="data_source_info_dict")
    data_source_detail_dict: Any = None
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


@dataclass(frozen=True)
class DocumentWithSession:
    """Expose session-backed document fields during response validation."""

    document: Document
    session: Session

    @property
    def data_source_detail_dict(self) -> dict[str, Any]:
        return self.document.get_data_source_detail_dict(session=self.session)

    @property
    def hit_count(self) -> int:
        return self.document.get_hit_count(session=self.session)

    @property
    def doc_metadata_details(self) -> list[DocMetadataDetailItem] | None:
        return self.document.get_doc_metadata_details(session=self.session)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.document, name)


def document_response(document: Document, *, session: Session) -> DocumentResponse:
    return DocumentResponse.model_validate(
        DocumentWithSession(document=document, session=session), from_attributes=True
    )


def document_responses(documents: Iterable[Document], *, session: Session) -> list[DocumentResponse]:
    return [document_response(document, session=session) for document in documents]


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
