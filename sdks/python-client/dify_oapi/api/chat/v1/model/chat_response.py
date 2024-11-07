from __future__ import annotations

from pydantic import BaseModel

from dify_oapi.core.model.base_response import BaseResponse


class ChatResponse(BaseResponse):
    message_id: str | None = None
    conversation_id: str | None = None
    mode: str | None = None
    answer: str | None = None
    metadata: ChatResponseMetadata | None = None
    created_at: int | None = None


class ChatResponseMetadata(BaseModel):
    usage: dict | None = None
    retriever_resources: list[dict] | None = None
