from __future__ import annotations

from pydantic import BaseModel

from dify_oapi.core.model.base_response import BaseResponse


class GetMetaResponse(BaseResponse):
    tool_icons: GetMetaResponseToolIcons | None = None


class GetMetaResponseToolIcons(BaseModel):
    dalle2: str | None = None
    api_tool: GetMetaResponseApiTool | None = None


class GetMetaResponseApiTool(BaseModel):
    background: str | None = None
    content: str | None = None
