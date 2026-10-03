"""TypedDict definitions for Conversation, Message, and related model dict return types."""

from datetime import datetime
from decimal import Decimal
from typing import Any, TypedDict


class ConversationDict(TypedDict):
    id: str
    app_id: str
    app_model_config_id: str | None
    model_provider: str | None
    override_model_configs: str | None
    model_id: str | None
    mode: str
    name: str
    summary: str | None
    inputs: dict[str, Any]
    introduction: str | None
    system_instruction: str | None
    system_instruction_tokens: int
    status: str
    invoke_from: str | None
    from_source: str
    from_end_user_id: str | None
    from_account_id: str | None
    read_at: datetime | None
    read_account_id: str | None
    dialogue_count: int
    created_at: datetime
    updated_at: datetime


class MessageDict(TypedDict):
    id: str
    app_id: str
    conversation_id: str
    model_id: str | None
    inputs: dict[str, Any]
    query: str
    total_price: Decimal | None
    message: dict[str, Any]
    answer: str
    status: str
    error: str | None
    message_metadata: dict[str, Any]
    from_source: str
    from_end_user_id: str | None
    from_account_id: str | None
    created_at: str
    updated_at: str
    agent_based: bool
    workflow_run_id: str | None


class MessageFeedbackDict(TypedDict):
    id: str
    app_id: str
    conversation_id: str
    message_id: str
    rating: str
    content: str | None
    from_source: str
    from_end_user_id: str | None
    from_account_id: str | None
    created_at: str
    updated_at: str


class MessageFileInfo(TypedDict, total=False):
    belongs_to: str | None
    upload_file_id: str | None
    id: str
    tenant_id: str
    type: str
    transfer_method: str
    remote_url: str | None
    related_id: str | None
    filename: str | None
    extension: str | None
    mime_type: str | None
    size: int
    dify_model_identity: str
    url: str | None


class ExtraContentDict(TypedDict, total=False):
    type: str
    workflow_run_id: str


class TraceAppConfigDict(TypedDict):
    id: str
    app_id: str
    tracing_provider: str | None
    tracing_config: dict[str, Any]
    is_active: bool
    created_at: str | None
    updated_at: str | None
