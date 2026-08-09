from collections.abc import Sequence
from datetime import datetime
from typing import Any

from pydantic import Field, field_validator
from sqlalchemy.orm import Session

from fields.base import ResponseModel
from fields.member_fields import SimpleAccountResponse
from libs.helper import to_timestamp
from models.account import Account
from models.model import Tag
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


class SnippetResponseSource:
    """Adapt a snippet to the attribute shape the response models validate against.

    ``CustomizedSnippet`` exposes its session-backed lookups as ``get_*(session=...)``
    methods, so the session is bound here at the request boundary instead of inside
    the model.
    """

    def __init__(self, snippet: CustomizedSnippet, *, session: Session) -> None:
        self._snippet = snippet
        self._session = session

    def __getattr__(self, name: str) -> object:
        return getattr(self._snippet, name)  # guard-ignore: no-new-getattr -- delegates model fields

    @property
    def graph_dict(self) -> dict[str, Any]:
        return self._snippet.get_graph_dict(session=self._session)

    @property
    def tags(self) -> Sequence[Tag]:
        return self._snippet.get_tags(session=self._session)

    @property
    def created_by_account(self) -> Account | None:
        return self._snippet.get_created_by_account(session=self._session)

    @property
    def author_name(self) -> str | None:
        return self._snippet.get_author_name(session=self._session)

    @property
    def updated_by_account(self) -> Account | None:
        return self._snippet.get_updated_by_account(session=self._session)
