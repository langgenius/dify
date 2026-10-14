"""Detached message details and file references shared by Console queries."""

from dataclasses import dataclass
from datetime import datetime

from pydantic import JsonValue

from graphon.file import File

type MessageInputValue = JsonValue | File | list[File]


@dataclass(frozen=True, slots=True)
class MessageFileReference:
    """Persisted reference; file metadata and URLs are resolved after the read."""

    id: str
    type: str
    transfer_method: str
    url: str | None
    upload_file_id: str | None
    belongs_to: str | None


@dataclass(frozen=True, slots=True)
class MessageFileRecord:
    id: str
    filename: str | None
    type: str
    url: str | None
    mime_type: str | None
    size: int | None
    transfer_method: str
    belongs_to: str | None
    upload_file_id: str | None


@dataclass(frozen=True, slots=True)
class MessageFileProjection:
    inputs: dict[str, MessageInputValue]
    answer: str
    files: list[MessageFileRecord]


@dataclass(frozen=True, slots=True)
class MessageAgentThoughtRecord:
    id: str
    message_id: str
    message_chain_id: str | None
    position: int
    thought: str | None
    answer: str | None
    tool: str | None
    tool_labels: JsonValue
    tool_input: str | None
    created_at: datetime | None
    observation: str | None
    files: list[str]


@dataclass(frozen=True, slots=True)
class MessageAccountRecord:
    id: str
    name: str
    email: str


@dataclass(frozen=True, slots=True)
class ConsoleMessageFeedbackRecord:
    rating: str
    content: str | None
    from_source: str
    from_end_user_id: str | None
    from_account: MessageAccountRecord | None


@dataclass(frozen=True, slots=True)
class MessageAnnotationRecord:
    id: str
    question: str | None
    content: str
    account: MessageAccountRecord | None
    created_at: datetime | None


@dataclass(frozen=True, slots=True)
class MessageAnnotationHitRecord:
    id: str
    annotation_create_account: MessageAccountRecord | None
    created_at: datetime | None


@dataclass(frozen=True, slots=True)
class ConsoleMessageRecord:
    id: str
    conversation_id: str
    inputs: dict[str, MessageInputValue]
    query: str
    message: JsonValue
    message_tokens: int
    answer: str
    answer_tokens: int
    provider_response_latency: float
    from_source: str
    from_end_user_id: str | None
    from_account_id: str | None
    feedbacks: list[ConsoleMessageFeedbackRecord]
    workflow_run_id: str | None
    annotation: MessageAnnotationRecord | None
    annotation_hit_history: MessageAnnotationHitRecord | None
    created_at: datetime | None
    agent_thoughts: list[MessageAgentThoughtRecord]
    message_files: list[MessageFileRecord]
    metadata: JsonValue
    status: str
    error: str | None
    parent_message_id: str | None

    @property
    def re_sign_file_url_answer(self) -> str:
        """The response schema's legacy alias; signing has already completed."""
        return self.answer

    @property
    def message_metadata_dict(self) -> JsonValue:
        return self.metadata
