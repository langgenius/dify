from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import field_validator

from fields.base import ResponseModel
from graphon.variables.types import SegmentType
from libs.helper import to_timestamp

from ._value_type_serializer import serialize_value_type


class ConversationVariableResponse(ResponseModel):
    id: str
    name: str
    value_type: str
    value: str | None = None
    description: str | None = None
    created_at: int | None = None
    updated_at: int | None = None

    @field_validator("value_type", mode="before")
    @classmethod
    def _normalize_value_type(cls, value: Any) -> str:
        exposed_type = getattr(value, "exposed_type", None)
        if callable(exposed_type):
            return str(exposed_type())
        if isinstance(value, str):
            try:
                return str(SegmentType(value).exposed_type())
            except ValueError:
                return value
        try:
            return serialize_value_type(value)
        except (AttributeError, TypeError, ValueError):
            pass

        try:
            return serialize_value_type({"value_type": value})
        except (AttributeError, TypeError, ValueError):
            value_attr = getattr(value, "value", None)
            if value_attr is not None:
                return str(value_attr)
            return str(value)

    @field_validator("value", mode="before")
    @classmethod
    def _normalize_value(cls, value: Any | None) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(value)

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowConversationVariableResponse(ResponseModel):
    id: str
    name: str
    value_type: str
    value: Any
    description: str

    @field_validator("value_type", mode="before")
    @classmethod
    def _serialize_value_type(cls, value: Any) -> str:
        if hasattr(value, "exposed_type"):
            return str(value.exposed_type())
        return str(value)


class PaginatedConversationVariableResponse(ResponseModel):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[ConversationVariableResponse]


class ConversationVariableInfiniteScrollPaginationResponse(ResponseModel):
    limit: int
    has_more: bool
    data: list[ConversationVariableResponse]
