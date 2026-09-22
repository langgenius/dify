from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated
from uuid import uuid4

from pydantic import Field, WithJsonSchema, computed_field, field_validator

from core.entities.execution_extra_content import ExecutionExtraContentDomainModel
from fields.base import ResponseModel
from fields.conversation_fields import AgentThought, JSONValue, MessageFile
from graphon.file import File
from libs.helper import to_timestamp

type JSONValueType = JSONValue
UUIDString = Annotated[str, WithJsonSchema({"format": "uuid", "type": "string"})]
Int64 = Annotated[int, WithJsonSchema({"format": "int64", "type": "integer"})]
FloatNumber = Annotated[float, WithJsonSchema({"format": "float", "type": "number"})]


class SimpleFeedback(ResponseModel):
    rating: str | None = None


class RetrieverResource(ResponseModel):
    id: UUIDString = Field(default_factory=lambda: str(uuid4()))
    message_id: UUIDString = Field(default_factory=lambda: str(uuid4()))
    position: int
    dataset_id: UUIDString | None = None
    dataset_name: str | None = None
    document_id: UUIDString | None = None
    document_name: str | None = None
    data_source_type: str | None = None
    segment_id: UUIDString | None = None
    score: FloatNumber | None = None
    hit_count: int | None = None
    word_count: int | None = None
    segment_position: int | None = None
    index_node_hash: str | None = None
    content: str | None = None
    summary: str | None = None
    created_at: Int64 | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class MessageListItem(ResponseModel):
    id: UUIDString
    conversation_id: UUIDString
    parent_message_id: UUIDString | None = None
    inputs: dict[str, JSONValueType]
    query: str
    answer: str = Field(validation_alias="re_sign_file_url_answer")
    feedback: SimpleFeedback | None = Field(default=None, validation_alias="user_feedback")
    retriever_resources: list[RetrieverResource]
    created_at: Int64 | None = None
    agent_thoughts: list[AgentThought]
    message_files: list[MessageFile]
    message_tokens: int = 0
    answer_tokens: int = 0
    provider_response_latency: FloatNumber = 0
    total_price: Decimal | None = None
    currency: str | None = None
    status: str
    error: str | None = None
    extra_contents: list[ExecutionExtraContentDomainModel]

    @computed_field
    def total_tokens(self) -> int:
        return self.message_tokens + self.answer_tokens

    @field_validator("inputs", mode="before")
    @classmethod
    def _normalize_inputs(cls, value: JSONValueType) -> JSONValueType:
        return format_files_contained(value)

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WebMessageListItem(MessageListItem):
    metadata: JSONValueType | None = Field(
        default=None,
        validation_alias="message_metadata_dict",
    )


class ExploreMessageListItem(MessageListItem):
    metadata: JSONValueType | None = Field(
        default=None,
        validation_alias="message_metadata_dict",
    )


class MessageInfiniteScrollPagination(ResponseModel):
    limit: int
    has_more: bool
    data: list[MessageListItem]


class WebMessageInfiniteScrollPagination(ResponseModel):
    limit: int
    has_more: bool
    data: list[WebMessageListItem]


class ExploreMessageInfiniteScrollPagination(ResponseModel):
    limit: int
    has_more: bool
    data: list[ExploreMessageListItem]


class SavedMessageItem(ResponseModel):
    id: str
    inputs: dict[str, JSONValueType]
    query: str
    answer: str
    message_files: list[MessageFile]
    feedback: SimpleFeedback | None = Field(default=None, validation_alias="user_feedback")
    created_at: int | None = None

    @field_validator("inputs", mode="before")
    @classmethod
    def _normalize_inputs(cls, value: JSONValueType) -> JSONValueType:
        return format_files_contained(value)

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class SavedMessageInfiniteScrollPagination(ResponseModel):
    limit: int
    has_more: bool
    data: list[SavedMessageItem]


class SuggestedQuestionsResponse(ResponseModel):
    data: list[str]


def format_files_contained(value: JSONValueType) -> JSONValueType:
    if isinstance(value, File):
        # Response payloads must preserve legacy file keys like `related_id`/`url`
        # while still exposing the new graph-layer `reference` field.
        return value.to_dict()
    if isinstance(value, dict):
        return {k: format_files_contained(v) for k, v in value.items()}
    if isinstance(value, list):
        return [format_files_contained(v) for v in value]
    return value
