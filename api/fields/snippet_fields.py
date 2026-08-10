from collections.abc import Iterable
from datetime import datetime
from typing import Any

from pydantic import Field, field_validator
from sqlalchemy.orm import Session

from fields.base import ResponseModel
from fields.member_fields import SimpleAccountResponse
from libs.helper import to_timestamp
from models.snippet import CustomizedSnippet, SnippetType


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
    created_by: SimpleAccountResponse | None = Field(validation_alias="created_by_account")
    created_at: int
    updated_by: SimpleAccountResponse | None = Field(validation_alias="updated_by_account")
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


def snippet_response(snippet: CustomizedSnippet, *, session: Session) -> SnippetResponse:
    """Build the snippet detail response, resolving session-backed lookups at the request boundary."""
    return SnippetResponse.model_validate(
        {
            "id": snippet.id,
            "name": snippet.name,
            "description": snippet.description,
            "type": snippet.type,
            "version": snippet.version,
            "use_count": snippet.use_count,
            "is_published": snippet.is_published,
            "icon_info": snippet.icon_info,
            "graph": snippet.get_graph_dict(session=session),
            "input_fields": snippet.input_fields_list,
            "tags": snippet.get_tags(session=session),
            "created_by": snippet.get_created_by_account(session=session),
            "created_at": snippet.created_at,
            "updated_by": snippet.get_updated_by_account(session=session),
            "updated_at": snippet.updated_at,
        }
    )


def snippet_list_item_response(snippet: CustomizedSnippet, *, session: Session) -> SnippetListItemResponse:
    """Build one snippet list row, resolving session-backed lookups at the request boundary."""
    return SnippetListItemResponse.model_validate(
        {
            "id": snippet.id,
            "name": snippet.name,
            "description": snippet.description,
            "type": snippet.type,
            "version": snippet.version,
            "use_count": snippet.use_count,
            "is_published": snippet.is_published,
            "icon_info": snippet.icon_info,
            "tags": snippet.get_tags(session=session),
            "created_by": snippet.created_by,
            "author_name": snippet.get_author_name(session=session),
            "created_at": snippet.created_at,
            "updated_by": snippet.updated_by,
            "updated_at": snippet.updated_at,
        }
    )


def snippet_list_item_responses(
    snippets: Iterable[CustomizedSnippet], *, session: Session
) -> list[SnippetListItemResponse]:
    return [snippet_list_item_response(snippet, session=session) for snippet in snippets]
