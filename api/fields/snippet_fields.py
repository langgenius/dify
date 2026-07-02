from datetime import datetime
from typing import Any

from pydantic import Field, field_validator

from fields.base import ResponseModel
from fields.member_fields import SimpleAccountResponse
from libs.helper import to_timestamp
from models.snippet import SnippetType


class SnippetTagResponse(ResponseModel):
    id: str
    name: str
    type: str


class SnippetListItemResponse(ResponseModel):
    id: str
    name: str
    description: str | None
    type: SnippetType
    version: int
    use_count: int
    is_published: bool
    icon_info: dict[str, Any] | None
    tags: list[SnippetTagResponse]
    created_by: str | None
    author_name: str | None
    created_at: int
    updated_by: str | None
    updated_at: int

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int:
        timestamp = to_timestamp(value)
        if timestamp is None:
            raise ValueError("timestamp is required")
        return timestamp


class SnippetResponse(ResponseModel):
    id: str
    name: str
    description: str | None
    type: SnippetType
    version: int
    use_count: int
    is_published: bool
    icon_info: dict[str, Any] | None
    graph: dict[str, Any] = Field(validation_alias="graph_dict")
    input_fields: list[dict[str, Any]] = Field(validation_alias="input_fields_list")
    tags: list[SnippetTagResponse]
    created_by: SimpleAccountResponse | None = Field(default=None, validation_alias="created_by_account")
    created_at: int
    updated_by: SimpleAccountResponse | None = Field(default=None, validation_alias="updated_by_account")
    updated_at: int

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int:
        timestamp = to_timestamp(value)
        if timestamp is None:
            raise ValueError("timestamp is required")
        return timestamp


class SnippetPaginationResponse(ResponseModel):
    data: list[SnippetListItemResponse]
    page: int
    limit: int
    total: int
    has_more: bool
