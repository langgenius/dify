from __future__ import annotations

from pydantic import BaseModel

from dify_oapi.core.model.base_response import BaseResponse


class MessageHistoryResponse(BaseResponse):
    data: list[dict] | None = None
    id: str | None = None
    conversation_id: str | None = None
    inputs: list[dict] | None = None
    query: str | None = None
    message_files: list[MessageHistoryResponseFile] | None = None
    answer: str | None = None
    created_at: int | None = None
    feedback: MessageHistoryResponseFeedback | None = None
    retriever_resources: list[dict] | None = None
    has_more: bool | None = None
    limit: int | None = None


class MessageHistoryResponseFeedback(BaseModel):
    rating: str | None = None


class MessageHistoryResponseFile(BaseModel):
    id: str | None = None
    type: str | None = None
    url: str | None = None
    belongs_to: str | None = None
    agent_thoughts: list[MessageHistoryResponseFileAgentThought] | None = None


class MessageHistoryResponseFileAgentThought(BaseResponse):
    id: str | None = None
    message_id: str | None = None
    position: int | None = None
    thought: str | None = None
    observation: str | None = None
    tool: str | None = None
    tool_input: str | None = None
    created_at: int | None = None
    message_files: list[MessageHistoryResponseFileAgentThoughtFile] | None = None
    conversation_id: str | None = None


class MessageHistoryResponseFileAgentThoughtFile(BaseModel):
    file_id: str | None = None
