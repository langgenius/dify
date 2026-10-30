"""Request and response schemas for Service API chunk endpoints."""

from typing import Self

from pydantic import BaseModel, Field, field_validator, model_validator

from fields.base import ResponseModel
from fields.segment_fields import SegmentResponse
from services.knowledge.entities.segments import SegmentUpdateArgs


class SegmentCreateItemPayload(BaseModel):
    content: str = Field(min_length=1, description="Chunk text content.")
    answer: str | None = Field(default=None, description="Answer content for QA mode.")
    keywords: list[str] | None = Field(default=None, description="Keywords for the chunk.")
    attachment_ids: list[str] | None = Field(default=None, description="Attachment file IDs.")

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Content is empty")
        return value


class SegmentCreatePayload(BaseModel):
    segments: list[SegmentCreateItemPayload] = Field(min_length=1, description="Array of chunk objects to create.")


class SegmentListQuery(BaseModel):
    limit: int = Field(default=20, ge=1, description="Number of items per page. Server caps at `100`.")
    page: int = Field(default=1, ge=1, description="Page number to retrieve.")
    status: list[str] = Field(
        default_factory=list,
        description="Filter chunks by indexing status, such as `completed`, `indexing`, or `error`.",
    )
    keyword: str | None = Field(default=None, description="Search keyword.")


class SegmentUpdatePayload(BaseModel):
    segment: SegmentUpdateArgs = Field(description="Chunk data to update.")

    @model_validator(mode="after")
    def validate_status_update(self) -> Self:
        if self.segment.enabled is not None and self.segment.model_fields_set.difference({"enabled"}):
            raise ValueError("Enabled cannot be updated together with segment content")
        return self


class ChildChunkListQuery(BaseModel):
    limit: int = Field(default=20, ge=1, description="Number of items per page. Server caps at `100`.")
    keyword: str | None = Field(default=None, description="Search keyword.")
    page: int = Field(default=1, ge=1, description="Page number to retrieve.")


class SegmentCreateListResponse(ResponseModel):
    data: list[SegmentResponse]
    doc_form: str


class SegmentListResponse(ResponseModel):
    data: list[SegmentResponse]
    doc_form: str
    total: int
    has_more: bool
    limit: int
    page: int
