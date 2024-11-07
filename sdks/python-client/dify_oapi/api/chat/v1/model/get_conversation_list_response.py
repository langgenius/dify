from __future__ import annotations

from pydantic import BaseModel

from dify_oapi.core.model.base_response import BaseResponse


class GetConversationListResponse(BaseResponse):
    data: list[GetConversationListData] | None = None
    has_more: bool | None = None
    limit: int | None = None


class GetConversationListData(BaseModel):
    id: str | None = None
    name: str | None = None
    inputs: dict | None = None
    status: str | None = None
    introduction: str | None = None
    created_at: int | None = None
    updated_at: int | None = None
