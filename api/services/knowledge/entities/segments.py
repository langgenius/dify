"""Detached knowledge segment values shared by application ports."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ChildChunkUpdateArgs(BaseModel):
    id: str | None = Field(default=None, description="Existing child chunk ID. Omit to create a new child chunk.")
    content: str = Field(description="Child chunk text content.")


class SegmentAttachmentRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True, frozen=True)

    id: str
    name: str
    size: int
    extension: str
    mime_type: str | None
    source_url: str


class ChildChunkRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True, frozen=True)

    id: str
    segment_id: str
    content: str
    position: int
    word_count: int
    type: str
    created_at: datetime
    updated_at: datetime


class SegmentRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True, frozen=True)

    id: str
    position: int
    document_id: str
    content: str
    sign_content: str
    answer: str | None
    word_count: int
    tokens: int
    keywords: tuple[str, ...] | None
    index_node_id: str | None
    index_node_hash: str | None
    hit_count: int
    enabled: bool
    disabled_at: datetime | None
    disabled_by: str | None
    status: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    updated_by: str | None
    indexing_at: datetime | None
    completed_at: datetime | None
    error: str | None
    stopped_at: datetime | None
    child_chunks: tuple[ChildChunkRecord, ...]
    attachments: tuple[SegmentAttachmentRecord, ...]
    summary: str | None


class SegmentUpdateArgs(BaseModel):
    content: str | None = Field(default=None, description="Updated chunk text content.")
    answer: str | None = Field(default=None, description="Updated answer content for QA mode.")
    keywords: list[str] | None = Field(default=None, description="Updated keywords for the chunk.")
    regenerate_child_chunks: bool = Field(
        default=False,
        description="Whether to regenerate child chunks after updating a parent chunk.",
    )
    enabled: bool | None = Field(default=None, description="Whether the chunk is enabled.")
    attachment_ids: list[str] | None = Field(default=None, description="Attachment file IDs.")
    summary: str | None = Field(default=None, description="Summary content for summary index.")
