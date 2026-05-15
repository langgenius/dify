from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field, field_validator, model_validator

from fields.base import ResponseModel
from graphon.file import File
from libs.helper import to_timestamp

type JSONValue = Any


class MessageFile(ResponseModel):
    id: str
    filename: str
    type: str
    url: str | None = None
    mime_type: str | None = None
    size: int | None = None
    transfer_method: str
    belongs_to: str | None = None
    upload_file_id: str | None = None

    @field_validator("transfer_method", mode="before")
    @classmethod
    def _normalize_transfer_method(cls, value: object) -> str:
        if isinstance(value, str):
            return value
        return str(value)


class SimpleConversation(ResponseModel):
    id: str
    name: str
    inputs: dict[str, JSONValue]
    status: str
    introduction: str | None = None
    created_at: int | None = None
    updated_at: int | None = None

    @field_validator("inputs", mode="before")
    @classmethod
    def _normalize_inputs(cls, value: JSONValue) -> JSONValue:
        return format_files_contained(value)

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class ConversationInfiniteScrollPagination(ResponseModel):
    limit: int
    has_more: bool
    data: list[SimpleConversation]


class ConversationDelete(ResponseModel):
    result: str


class ResultResponse(ResponseModel):
    result: str


class SimpleAccount(ResponseModel):
    id: str
    name: str
    email: str


class Feedback(ResponseModel):
    rating: str
    content: str | None = None
    from_source: str
    from_end_user_id: str | None = None
    from_account: SimpleAccount | None = None


class ConversationAnnotation(ResponseModel):
    id: str
    question: str | None = None
    content: str
    account: SimpleAccount | None = None
    created_at: int | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class ConversationAnnotationHitHistory(ResponseModel):
    annotation_id: str = Field(validation_alias="id")
    annotation_create_account: SimpleAccount | None = None
    created_at: int | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AgentThought(ResponseModel):
    id: str
    chain_id: str | None = None
    message_chain_id: str | None = Field(default=None, exclude=True, validation_alias="message_chain_id")
    message_id: str
    position: int
    thought: str | None = None
    tool: str | None = None
    tool_labels: JSONValue
    tool_input: str | None = None
    created_at: int | None = None
    observation: str | None = None
    files: list[str]

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)

    @model_validator(mode="after")
    def _fallback_chain_id(self):
        if self.chain_id is None and self.message_chain_id:
            self.chain_id = self.message_chain_id
        return self


class MessageDetail(ResponseModel):
    id: str
    conversation_id: str
    inputs: dict[str, JSONValue]
    query: str
    message: JSONValue
    message_tokens: int
    answer: str = Field(validation_alias="re_sign_file_url_answer")
    answer_tokens: int
    provider_response_latency: float
    from_source: str
    from_end_user_id: str | None = None
    from_account_id: str | None = None
    feedbacks: list[Feedback]
    workflow_run_id: str | None = None
    annotation: ConversationAnnotation | None = None
    annotation_hit_history: ConversationAnnotationHitHistory | None = None
    created_at: int | None = None
    agent_thoughts: list[AgentThought]
    message_files: list[MessageFile]
    metadata: JSONValue = Field(validation_alias="message_metadata_dict")
    status: str
    error: str | None = None
    parent_message_id: str | None = None

    @field_validator("inputs", mode="before")
    @classmethod
    def _normalize_inputs(cls, value: JSONValue) -> JSONValue:
        return format_files_contained(value)

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class FeedbackStat(ResponseModel):
    like: int
    dislike: int


class StatusCount(ResponseModel):
    success: int
    failed: int
    partial_success: int
    paused: int


class ModelConfig(ResponseModel):
    opening_statement: str | None = None
    suggested_questions: JSONValue | None = None
    model: JSONValue | None = None
    user_input_form: JSONValue | None = None
    pre_prompt: str | None = None
    agent_mode: JSONValue | None = None


class SimpleModelConfig(ResponseModel):
    model: JSONValue | None = Field(default=None, validation_alias="model_dict")
    pre_prompt: str | None = None


class SimpleMessageDetail(ResponseModel):
    inputs: dict[str, JSONValue]
    query: str
    message: str
    answer: str

    @field_validator("inputs", mode="before")
    @classmethod
    def _normalize_inputs(cls, value: JSONValue) -> JSONValue:
        return format_files_contained(value)

    @field_validator("message", mode="before")
    @classmethod
    def _normalize_message(cls, value: JSONValue) -> str:
        return message_text(value)


class Conversation(ResponseModel):
    id: str
    status: str
    from_source: str
    from_end_user_id: str | None = None
    from_end_user_session_id: str | None = None
    from_account_id: str | None = None
    from_account_name: str | None = None
    read_at: int | None = None
    created_at: int | None = None
    updated_at: int | None = None
    annotation: ConversationAnnotation | None = None
    model_config_: SimpleModelConfig | None = Field(default=None, alias="model_config")
    user_feedback_stats: FeedbackStat | None = None
    admin_feedback_stats: FeedbackStat | None = None
    message: SimpleMessageDetail | None = Field(default=None, validation_alias="first_message")

    @field_validator("read_at", "created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class ConversationPagination(ResponseModel):
    page: int
    limit: int = Field(validation_alias="per_page")
    total: int
    has_more: bool = Field(validation_alias="has_next")
    data: list[Conversation] = Field(validation_alias="items")


class ConversationMessageDetail(ResponseModel):
    id: str
    status: str
    from_source: str
    from_end_user_id: str | None = None
    from_account_id: str | None = None
    created_at: int | None = None
    model_config_: ModelConfig | None = Field(default=None, alias="model_config")
    message: MessageDetail | None = Field(default=None, validation_alias="first_message")

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class ConversationWithSummary(ResponseModel):
    id: str
    status: str
    from_source: str
    from_end_user_id: str | None = None
    from_end_user_session_id: str | None = None
    from_account_id: str | None = None
    from_account_name: str | None = None
    name: str
    summary: str = Field(validation_alias="summary_or_query")
    read_at: int | None = None
    created_at: int | None = None
    updated_at: int | None = None
    annotated: bool
    model_config_: SimpleModelConfig | None = Field(default=None, alias="model_config")
    message_count: int
    user_feedback_stats: FeedbackStat | None = None
    admin_feedback_stats: FeedbackStat | None = None
    status_count: StatusCount | None = None

    @field_validator("read_at", "created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class ConversationWithSummaryPagination(ResponseModel):
    page: int
    limit: int = Field(validation_alias="per_page")
    total: int
    has_more: bool = Field(validation_alias="has_next")
    data: list[ConversationWithSummary] = Field(validation_alias="items")


class ConversationDetail(ResponseModel):
    id: str
    status: str
    from_source: str
    from_end_user_id: str | None = None
    from_account_id: str | None = None
    created_at: int | None = None
    updated_at: int | None = None
    annotated: bool
    introduction: str | None = None
    model_config_: ModelConfig | None = Field(default=None, alias="model_config")
    message_count: int
    user_feedback_stats: FeedbackStat | None = None
    admin_feedback_stats: FeedbackStat | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


def format_files_contained(value: JSONValue) -> JSONValue:
    if isinstance(value, File):
        # Response payloads must preserve legacy file keys like `related_id`/`url`
        # while still exposing the new graph-layer `reference` field.
        return value.to_dict()
    if isinstance(value, dict):
        return {k: format_files_contained(v) for k, v in value.items()}
    if isinstance(value, list):
        return [format_files_contained(v) for v in value]
    return value


def message_text(value: JSONValue) -> str:
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, dict):
            text = first.get("text")
            if isinstance(text, str):
                return text
    return ""


def extract_model_config(value: object | None) -> dict[str, JSONValue]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return {}
