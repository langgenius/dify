from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import field_serializer
from sqlalchemy.orm import Session

from fields.base import ResponseModel
from libs.helper import to_timestamp


class SegmentAttachmentResponse(ResponseModel):
    id: str
    name: str
    size: int
    extension: str
    mime_type: str | None
    source_url: str


class ChildChunkResponse(ResponseModel):
    id: str
    segment_id: str
    content: str
    position: int
    word_count: int
    type: str
    created_at: datetime | int
    updated_at: datetime | int

    @field_serializer("created_at", "updated_at")
    def serialize_timestamp(self, value: datetime | int) -> int:
        return to_timestamp(value)


class SegmentResponse(ResponseModel):
    id: str
    position: int
    document_id: str
    content: str
    sign_content: str
    answer: str | None
    word_count: int
    tokens: int
    keywords: list[str] | None
    index_node_id: str | None
    index_node_hash: str | None
    hit_count: int
    enabled: bool
    disabled_at: datetime | int | None
    disabled_by: str | None
    status: str
    created_by: str
    created_at: datetime | int
    updated_at: datetime | int
    updated_by: str | None
    indexing_at: datetime | int | None
    completed_at: datetime | int | None
    error: str | None
    stopped_at: datetime | int | None
    child_chunks: list[ChildChunkResponse]
    attachments: list[SegmentAttachmentResponse]
    summary: str | None

    @field_serializer("created_at", "updated_at")
    def serialize_required_timestamp(self, value: datetime | int) -> int:
        return to_timestamp(value)

    @field_serializer("disabled_at", "indexing_at", "completed_at", "stopped_at")
    def serialize_optional_timestamp(self, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


@dataclass(frozen=True)
class SegmentWithSummary:
    """Expose session-backed segment relations during response validation."""

    segment: Any
    summary: str | None
    session: Session

    @property
    def child_chunks(self) -> Any:
        return self.segment.get_child_chunks(session=self.session)

    @property
    def attachments(self) -> Any:
        return self.segment.get_attachments(session=self.session)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.segment, name)


def segment_response_with_summary(segment: Any, summary: str | None, *, session: Session) -> SegmentResponse:
    response_source = SegmentWithSummary(segment=segment, summary=summary, session=session)
    return SegmentResponse.model_validate(response_source, from_attributes=True)


def segment_responses_with_summaries(
    segments: Iterable[Any],
    summaries: Mapping[str, str | None],
    *,
    session: Session,
) -> list[SegmentResponse]:
    return [segment_response_with_summary(segment, summaries.get(segment.id), session=session) for segment in segments]


class SegmentDetailResponse(ResponseModel):
    data: SegmentResponse
    doc_form: str


class ChildChunkDetailResponse(ResponseModel):
    data: ChildChunkResponse


class ChildChunkListResponse(ResponseModel):
    data: list[ChildChunkResponse]
    total: int
    total_pages: int
    page: int
    limit: int
