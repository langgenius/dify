from __future__ import annotations

from datetime import datetime
from typing import TypeAlias

from pydantic import BaseModel, ConfigDict

from core.file import File
from fields.conversation_fields import (
    AgentThought,
    JSONValue,
    MessageFile,
    build_agent_thought,
    build_message_file,
)

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


def _to_timestamp(value: datetime | None) -> int | None:
    if value is None:
        return None
    return int(value.timestamp())


def _format_files_contained(value: JSONValueType) -> JSONValueType:
    if isinstance(value, File):
        return value.model_dump()
    if isinstance(value, dict):
        return {k: _format_files_contained(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_format_files_contained(v) for v in value]
    return value


def build_simple_feedback(feedback: object | None) -> SimpleFeedback | None:
    if feedback is None:
        return None
    return SimpleFeedback(rating=getattr(feedback, "rating", None))


def build_retriever_resource(item: object) -> RetrieverResource:
    if isinstance(item, dict):
        return RetrieverResource.model_validate(item)
    return RetrieverResource(
        id=str(item.id),
        message_id=str(item.message_id),
        position=item.position,
        dataset_id=getattr(item, "dataset_id", None),
        dataset_name=getattr(item, "dataset_name", None),
        document_id=getattr(item, "document_id", None),
        document_name=getattr(item, "document_name", None),
        data_source_type=getattr(item, "data_source_type", None),
        segment_id=getattr(item, "segment_id", None),
        score=getattr(item, "score", None),
        hit_count=getattr(item, "hit_count", None),
        word_count=getattr(item, "word_count", None),
        segment_position=getattr(item, "segment_position", None),
        index_node_hash=getattr(item, "index_node_hash", None),
        content=getattr(item, "content", None),
        created_at=_to_timestamp(getattr(item, "created_at", None)),
    )


def build_message_list_item(message: object) -> MessageListItem:
    feedback = build_simple_feedback(getattr(message, "user_feedback", None))
    retriever_resources = [build_retriever_resource(item) for item in getattr(message, "retriever_resources", [])]
    agent_thoughts = [build_agent_thought(thought) for thought in getattr(message, "agent_thoughts", [])]
    message_files = [build_message_file(item) for item in getattr(message, "message_files", [])]
    return MessageListItem(
        id=str(message.id),
        conversation_id=str(message.conversation_id),
        parent_message_id=getattr(message, "parent_message_id", None),
        inputs=_format_files_contained(message.inputs),
        query=message.query,
        answer=message.re_sign_file_url_answer,
        feedback=feedback,
        retriever_resources=retriever_resources,
        created_at=_to_timestamp(message.created_at),
        agent_thoughts=agent_thoughts,
        message_files=message_files,
        status=message.status,
        error=getattr(message, "error", None),
    )


def build_web_message_list_item(message: object) -> WebMessageListItem:
    base = build_message_list_item(message)
    return WebMessageListItem(
        **base.model_dump(),
        metadata=getattr(message, "message_metadata_dict", None),
    )


def build_message_infinite_scroll_pagination(pagination: object) -> MessageInfiniteScrollPagination:
    return MessageInfiniteScrollPagination(
        limit=pagination.limit,
        has_more=pagination.has_more,
        data=[build_message_list_item(item) for item in pagination.data],
    )


def build_web_message_infinite_scroll_pagination(pagination: object) -> WebMessageInfiniteScrollPagination:
    return WebMessageInfiniteScrollPagination(
        limit=pagination.limit,
        has_more=pagination.has_more,
        data=[build_web_message_list_item(item) for item in pagination.data],
    )


def build_saved_message_item(message: object) -> SavedMessageItem:
    message_files = [build_message_file(item) for item in getattr(message, "message_files", [])]
    return SavedMessageItem(
        id=str(message.id),
        inputs=_format_files_contained(message.inputs),
        query=message.query,
        answer=message.answer,
        message_files=message_files,
        feedback=build_simple_feedback(getattr(message, "user_feedback", None)),
        created_at=_to_timestamp(message.created_at),
    )


def build_saved_message_infinite_scroll_pagination(pagination: object) -> SavedMessageInfiniteScrollPagination:
    return SavedMessageInfiniteScrollPagination(
        limit=pagination.limit,
        has_more=pagination.has_more,
        data=[build_saved_message_item(item) for item in pagination.data],
    )


def build_suggested_questions_response(questions: list[str]) -> SuggestedQuestionsResponse:
    return SuggestedQuestionsResponse(data=questions)
