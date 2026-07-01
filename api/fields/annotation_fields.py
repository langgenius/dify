from __future__ import annotations

from datetime import datetime

from pydantic import Field, field_validator

from fields.base import ResponseModel
from libs.helper import to_timestamp


class Annotation(ResponseModel):
    id: str
    question: str | None = None
    answer: str | None = Field(default=None, validation_alias="content")
    hit_count: int | None = None
    created_at: int | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AnnotationList(ResponseModel):
    data: list[Annotation]
    has_more: bool
    limit: int
    total: int
    page: int


class AnnotationExportList(ResponseModel):
    data: list[Annotation]


class AnnotationHitHistory(ResponseModel):
    id: str
    source: str | None = None
    score: float | None = None
    question: str | None = None
    created_at: int | None = None
    match: str | None = Field(default=None, validation_alias="annotation_question")
    response: str | None = Field(default=None, validation_alias="annotation_content")

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AnnotationHitHistoryList(ResponseModel):
    data: list[AnnotationHitHistory]
    has_more: bool
    limit: int
    total: int
    page: int
