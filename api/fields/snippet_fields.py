from datetime import datetime
from typing import Any

from pydantic import Field, field_validator

from fields.base import ResponseModel
from fields.member_fields import SimpleAccountResponse
from libs.helper import to_timestamp


class SnippetTagResponse(ResponseModel):
    id: str
    name: str
    type: str


class SnippetListItemResponse(ResponseModel):
    id: str
    name: str
    description: str | None = None
    type: str
    version: int
    use_count: int
    is_published: bool
    icon_info: dict[str, Any] | None = None
    tags: list[SnippetTagResponse] = Field(default_factory=list)
    created_by: str | None = None
    author_name: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class SnippetResponse(ResponseModel):
    id: str
    name: str
    description: str | None = None
    type: str
    version: int
    use_count: int
    is_published: bool
    icon_info: dict[str, Any] | None = None
    graph: dict[str, Any] | None = Field(default=None, validation_alias="graph_dict")
    input_fields: list[dict[str, Any]] | None = Field(default=None, validation_alias="input_fields_list")
    tags: list[SnippetTagResponse] = Field(default_factory=list)
    created_by: SimpleAccountResponse | None = Field(default=None, validation_alias="created_by_account")
    created_at: int | None = None
    updated_by: SimpleAccountResponse | None = Field(default=None, validation_alias="updated_by_account")
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class SnippetPaginationResponse(ResponseModel):
    data: list[SnippetListItemResponse]
    page: int
    limit: int
    total: int
    has_more: bool
