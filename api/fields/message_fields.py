from __future__ import annotations

from datetime import datetime
from typing import TypeAlias

from pydantic import BaseModel, ConfigDict

from core.file import File
from fields.conversation_fields import AgentThought, JSONValue, MessageFile

JSONValueType: TypeAlias = JSONValue


class ResponseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")


class SimpleFeedback(ResponseModel):
    rating: str | None = None


class RetrieverResource(ResponseModel):
    id: str
    message_id: str
    position: int
    dataset_id: str | None = None
    dataset_name: str | None = None
    document_id: str | None = None
    document_name: str | None = None
    data_source_type: str | None = None
    segment_id: str | None = None
    score: float | None = None
    hit_count: int | None = None
    word_count: int | None = None
    segment_position: int | None = None
    index_node_hash: str | None = None
    content: str | None = None
    created_at: int | None = None


class MessageListItem(ResponseModel):
    id: str
    conversation_id: str
    parent_message_id: str | None = None
    inputs: dict[str, JSONValueType]
    query: str
    answer: str
    feedback: SimpleFeedback | None = None
    retriever_resources: list[RetrieverResource]
    created_at: int | None = None
    agent_thoughts: list[AgentThought]
    message_files: list[MessageFile]
    status: str
    error: str | None = None


class WebMessageListItem(MessageListItem):
    metadata: JSONValueType | None = None


class MessageInfiniteScrollPagination(ResponseModel):
    limit: int
    has_more: bool
    data: list[MessageListItem]


class WebMessageInfiniteScrollPagination(ResponseModel):
    limit: int
    has_more: bool
    data: list[WebMessageListItem]


class SavedMessageItem(ResponseModel):
    id: str
    inputs: dict[str, JSONValueType]
    query: str
    answer: str
    message_files: list[MessageFile]
    feedback: SimpleFeedback | None = None
    created_at: int | None = None


class SavedMessageInfiniteScrollPagination(ResponseModel):
    limit: int
    has_more: bool
    data: list[SavedMessageItem]


class SuggestedQuestionsResponse(ResponseModel):
    data: list[str]


def to_timestamp(value: datetime | None) -> int | None:
    if value is None:
        return None
    return int(value.timestamp())


def format_files_contained(value: JSONValueType) -> JSONValueType:
    if isinstance(value, File):
        return value.model_dump()
    if isinstance(value, dict):
        return {k: format_files_contained(v) for k, v in value.items()}
    if isinstance(value, list):
        return [format_files_contained(v) for v in value]
    return value
