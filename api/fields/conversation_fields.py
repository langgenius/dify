from __future__ import annotations

from datetime import datetime
from typing import TypeAlias, Any

from flask_restx import fields
from pydantic import BaseModel, ConfigDict

from core.file import File


class MessageTextField(fields.Raw):
    def format(self, value):
        return value[0]["text"] if value else ""


JSONValue: TypeAlias = str | int | float | bool | None | dict[str, Any] | list[Any]


class ResponseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")


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


class SimpleConversation(ResponseModel):
    id: str
    name: str
    inputs: dict[str, JSONValue]
    status: str
    introduction: str | None = None
    created_at: int | None = None
    updated_at: int | None = None


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


class Annotation(ResponseModel):
    id: str
    question: str | None = None
    content: str
    account: SimpleAccount | None = None
    created_at: int | None = None


class AnnotationHitHistory(ResponseModel):
    annotation_id: str
    annotation_create_account: SimpleAccount | None = None
    created_at: int | None = None


class AgentThought(ResponseModel):
    id: str
    chain_id: str | None = None
    message_id: str
    position: int
    thought: str | None = None
    tool: str | None = None
    tool_labels: JSONValue
    tool_input: str | None = None
    created_at: int | None = None
    observation: str | None = None
    files: list[str]


class MessageDetail(ResponseModel):
    id: str
    conversation_id: str
    inputs: dict[str, JSONValue]
    query: str
    message: JSONValue
    message_tokens: int
    answer: str
    answer_tokens: int
    provider_response_latency: float
    from_source: str
    from_end_user_id: str | None = None
    from_account_id: str | None = None
    feedbacks: list[Feedback]
    workflow_run_id: str | None = None
    annotation: Annotation | None = None
    annotation_hit_history: AnnotationHitHistory | None = None
    created_at: int | None = None
    agent_thoughts: list[AgentThought]
    message_files: list[MessageFile]
    metadata: JSONValue
    status: str
    error: str | None = None
    parent_message_id: str | None = None


class FeedbackStat(ResponseModel):
    like: int
    dislike: int


class StatusCount(ResponseModel):
    success: int
    failed: int
    partial_success: int


class ModelConfig(ResponseModel):
    opening_statement: str | None = None
    suggested_questions: JSONValue | None = None
    model: JSONValue | None = None
    user_input_form: JSONValue | None = None
    pre_prompt: str | None = None
    agent_mode: JSONValue | None = None


class SimpleModelConfig(ResponseModel):
    model: JSONValue | None = None
    pre_prompt: str | None = None


class SimpleMessageDetail(ResponseModel):
    inputs: dict[str, JSONValue]
    query: str
    message: str
    answer: str


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
    annotation: Annotation | None = None
    model_config: SimpleModelConfig | None = None
    user_feedback_stats: FeedbackStat | None = None
    admin_feedback_stats: FeedbackStat | None = None
    message: SimpleMessageDetail | None = None


class ConversationPagination(ResponseModel):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[Conversation]


class ConversationMessageDetail(ResponseModel):
    id: str
    status: str
    from_source: str
    from_end_user_id: str | None = None
    from_account_id: str | None = None
    created_at: int | None = None
    model_config: ModelConfig | None = None
    message: MessageDetail | None = None


class ConversationWithSummary(ResponseModel):
    id: str
    status: str
    from_source: str
    from_end_user_id: str | None = None
    from_end_user_session_id: str | None = None
    from_account_id: str | None = None
    from_account_name: str | None = None
    name: str
    summary: str
    read_at: int | None = None
    created_at: int | None = None
    updated_at: int | None = None
    annotated: bool
    model_config: SimpleModelConfig | None = None
    message_count: int
    user_feedback_stats: FeedbackStat | None = None
    admin_feedback_stats: FeedbackStat | None = None
    status_count: StatusCount | None = None


class ConversationWithSummaryPagination(ResponseModel):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[ConversationWithSummary]


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
    model_config: ModelConfig | None = None
    message_count: int
    user_feedback_stats: FeedbackStat | None = None
    admin_feedback_stats: FeedbackStat | None = None


def _to_timestamp(value: datetime | None) -> int | None:
    if value is None:
        return None
    return int(value.timestamp())


def _format_files_contained(value: JSONValue) -> JSONValue:
    if isinstance(value, File):
        return value.model_dump()
    if isinstance(value, dict):
        return {k: _format_files_contained(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_format_files_contained(v) for v in value]
    return value


def _message_text(value: JSONValue) -> str:
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, dict):
            text = first.get("text")
            if isinstance(text, str):
                return text
    return ""


def _extract_model_config(value: object | None) -> dict[str, JSONValue]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return {}


def build_simple_account(account: object | None) -> SimpleAccount | None:
    if account is None:
        return None
    if isinstance(account, dict):
        return SimpleAccount.model_validate(account)
    return SimpleAccount(id=str(account.id), name=account.name, email=account.email)


def build_feedback(feedback: object | None) -> Feedback | None:
    if feedback is None:
        return None
    return Feedback(
        rating=feedback.rating,
        content=getattr(feedback, "content", None),
        from_source=feedback.from_source,
        from_end_user_id=feedback.from_end_user_id,
        from_account=build_simple_account(getattr(feedback, "from_account", None)),
    )


def build_annotation(annotation: object | None) -> Annotation | None:
    if annotation is None:
        return None
    return Annotation(
        id=str(annotation.id),
        question=getattr(annotation, "question", None),
        content=annotation.content,
        account=build_simple_account(getattr(annotation, "account", None)),
        created_at=_to_timestamp(getattr(annotation, "created_at", None)),
    )


def build_annotation_hit_history(annotation: object | None) -> AnnotationHitHistory | None:
    if annotation is None:
        return None
    return AnnotationHitHistory(
        annotation_id=str(annotation.id),
        annotation_create_account=build_simple_account(getattr(annotation, "annotation_create_account", None)),
        created_at=_to_timestamp(getattr(annotation, "created_at", None)),
    )


def build_agent_thought(thought: object) -> AgentThought:
    chain_id = getattr(thought, "chain_id", None)
    if chain_id is None:
        chain_id = getattr(thought, "message_chain_id", None)
    return AgentThought(
        id=str(thought.id),
        chain_id=chain_id,
        message_id=str(thought.message_id),
        position=thought.position,
        thought=getattr(thought, "thought", None),
        tool=getattr(thought, "tool", None),
        tool_labels=getattr(thought, "tool_labels", {}),
        tool_input=getattr(thought, "tool_input", None),
        created_at=_to_timestamp(getattr(thought, "created_at", None)),
        observation=getattr(thought, "observation", None),
        files=getattr(thought, "files", []),
    )


def build_message_file(item: object) -> MessageFile:
    if isinstance(item, MessageFile):
        return item
    if isinstance(item, dict):
        return MessageFile.model_validate(item)
    return MessageFile(
        id=str(item.id),
        filename=getattr(item, "filename", ""),
        type=item.type,
        url=getattr(item, "url", None),
        mime_type=getattr(item, "mime_type", None),
        size=getattr(item, "size", None),
        transfer_method=str(item.transfer_method),
        belongs_to=getattr(item, "belongs_to", None),
        upload_file_id=getattr(item, "upload_file_id", None),
    )


def build_message_detail(message: object | None) -> MessageDetail | None:
    if message is None:
        return None
    feedbacks = [build_feedback(feedback) for feedback in getattr(message, "feedbacks", [])]
    agent_thoughts = [build_agent_thought(thought) for thought in getattr(message, "agent_thoughts", [])]
    message_files = [build_message_file(item) for item in getattr(message, "message_files", [])]
    return MessageDetail(
        id=str(message.id),
        conversation_id=str(message.conversation_id),
        inputs=_format_files_contained(message.inputs),
        query=message.query,
        message=message.message,
        message_tokens=message.message_tokens,
        answer=message.re_sign_file_url_answer,
        answer_tokens=message.answer_tokens,
        provider_response_latency=message.provider_response_latency,
        from_source=message.from_source,
        from_end_user_id=message.from_end_user_id,
        from_account_id=message.from_account_id,
        feedbacks=feedbacks,
        workflow_run_id=getattr(message, "workflow_run_id", None),
        annotation=build_annotation(getattr(message, "annotation", None)),
        annotation_hit_history=build_annotation_hit_history(getattr(message, "annotation_hit_history", None)),
        created_at=_to_timestamp(message.created_at),
        agent_thoughts=agent_thoughts,
        message_files=message_files,
        metadata=message.message_metadata_dict,
        status=message.status,
        error=message.error,
        parent_message_id=message.parent_message_id,
    )


def build_feedback_stat(stats: dict[str, int] | None) -> FeedbackStat | None:
    if stats is None:
        return None
    return FeedbackStat(like=stats.get("like", 0), dislike=stats.get("dislike", 0))


def build_status_count(stats: dict[str, int] | None) -> StatusCount | None:
    if stats is None:
        return None
    return StatusCount(
        success=stats.get("success", 0),
        failed=stats.get("failed", 0),
        partial_success=stats.get("partial_success", 0),
    )


def build_model_config(value: object | None) -> ModelConfig | None:
    config = _extract_model_config(value)
    if not config:
        return None
    return ModelConfig(
        opening_statement=config.get("opening_statement"),
        suggested_questions=config.get("suggested_questions"),
        model=config.get("model"),
        user_input_form=config.get("user_input_form"),
        pre_prompt=config.get("pre_prompt"),
        agent_mode=config.get("agent_mode"),
    )


def build_simple_model_config(value: object | None) -> SimpleModelConfig | None:
    config = _extract_model_config(value)
    if not config:
        return None
    model_value = config.get("model")
    if model_value is None:
        model_value = config.get("model_dict")
    return SimpleModelConfig(
        model=model_value,
        pre_prompt=config.get("pre_prompt"),
    )


def build_simple_message_detail(message: object | None) -> SimpleMessageDetail | None:
    if message is None:
        return None
    return SimpleMessageDetail(
        inputs=_format_files_contained(message.inputs),
        query=message.query,
        message=_message_text(message.message),
        answer=message.answer,
    )


def build_conversation(conversation: object) -> Conversation:
    return Conversation(
        id=str(conversation.id),
        status=conversation.status,
        from_source=conversation.from_source,
        from_end_user_id=conversation.from_end_user_id,
        from_end_user_session_id=getattr(conversation, "from_end_user_session_id", None),
        from_account_id=conversation.from_account_id,
        from_account_name=getattr(conversation, "from_account_name", None),
        read_at=_to_timestamp(getattr(conversation, "read_at", None)),
        created_at=_to_timestamp(conversation.created_at),
        updated_at=_to_timestamp(conversation.updated_at),
        annotation=build_annotation(getattr(conversation, "annotation", None)),
        model_config=build_simple_model_config(getattr(conversation, "model_config", None)),
        user_feedback_stats=build_feedback_stat(getattr(conversation, "user_feedback_stats", None)),
        admin_feedback_stats=build_feedback_stat(getattr(conversation, "admin_feedback_stats", None)),
        message=build_simple_message_detail(getattr(conversation, "first_message", None)),
    )


def build_simple_conversation(conversation: object) -> SimpleConversation:
    return SimpleConversation(
        id=str(conversation.id),
        name=conversation.name,
        inputs=_format_files_contained(conversation.inputs),
        status=conversation.status,
        introduction=getattr(conversation, "introduction", None),
        created_at=_to_timestamp(conversation.created_at),
        updated_at=_to_timestamp(conversation.updated_at),
    )


def build_conversation_message_detail(conversation: object) -> ConversationMessageDetail:
    return ConversationMessageDetail(
        id=str(conversation.id),
        status=conversation.status,
        from_source=conversation.from_source,
        from_end_user_id=conversation.from_end_user_id,
        from_account_id=conversation.from_account_id,
        created_at=_to_timestamp(conversation.created_at),
        model_config=build_model_config(getattr(conversation, "model_config", None)),
        message=build_message_detail(getattr(conversation, "first_message", None)),
    )


def build_conversation_with_summary(conversation: object) -> ConversationWithSummary:
    return ConversationWithSummary(
        id=str(conversation.id),
        status=conversation.status,
        from_source=conversation.from_source,
        from_end_user_id=conversation.from_end_user_id,
        from_end_user_session_id=getattr(conversation, "from_end_user_session_id", None),
        from_account_id=conversation.from_account_id,
        from_account_name=getattr(conversation, "from_account_name", None),
        name=conversation.name,
        summary=getattr(conversation, "summary_or_query", ""),
        read_at=_to_timestamp(getattr(conversation, "read_at", None)),
        created_at=_to_timestamp(conversation.created_at),
        updated_at=_to_timestamp(conversation.updated_at),
        annotated=bool(getattr(conversation, "annotated", False)),
        model_config=build_simple_model_config(getattr(conversation, "model_config", None)),
        message_count=getattr(conversation, "message_count", 0),
        user_feedback_stats=build_feedback_stat(getattr(conversation, "user_feedback_stats", None)),
        admin_feedback_stats=build_feedback_stat(getattr(conversation, "admin_feedback_stats", None)),
        status_count=build_status_count(getattr(conversation, "status_count", None)),
    )


def build_conversation_detail(conversation: object) -> ConversationDetail:
    return ConversationDetail(
        id=str(conversation.id),
        status=conversation.status,
        from_source=conversation.from_source,
        from_end_user_id=conversation.from_end_user_id,
        from_account_id=conversation.from_account_id,
        created_at=_to_timestamp(conversation.created_at),
        updated_at=_to_timestamp(conversation.updated_at),
        annotated=bool(getattr(conversation, "annotated", False)),
        introduction=getattr(conversation, "introduction", None),
        model_config=build_model_config(getattr(conversation, "model_config", None)),
        message_count=getattr(conversation, "message_count", 0),
        user_feedback_stats=build_feedback_stat(getattr(conversation, "user_feedback_stats", None)),
        admin_feedback_stats=build_feedback_stat(getattr(conversation, "admin_feedback_stats", None)),
    )


def build_conversation_pagination(pagination: object) -> ConversationPagination:
    return ConversationPagination(
        page=pagination.page,
        limit=pagination.per_page,
        total=pagination.total,
        has_more=pagination.has_next,
        data=[build_conversation(item) for item in pagination.items],
    )


def build_conversation_infinite_scroll_pagination(pagination: object) -> ConversationInfiniteScrollPagination:
    return ConversationInfiniteScrollPagination(
        limit=pagination.limit,
        has_more=pagination.has_more,
        data=[build_simple_conversation(item) for item in pagination.data],
    )


def build_conversation_with_summary_pagination(pagination: object) -> ConversationWithSummaryPagination:
    return ConversationWithSummaryPagination(
        page=pagination.page,
        limit=pagination.per_page,
        total=pagination.total,
        has_more=pagination.has_next,
        data=[build_conversation_with_summary(item) for item in pagination.items],
    )


def build_conversation_delete(result: str = "success") -> ConversationDelete:
    return ConversationDelete(result=result)
