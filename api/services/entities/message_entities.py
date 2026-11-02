"""Caller identities and detached projections shared by message operations."""

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from pydantic import JsonValue

from graphon.file import File


@dataclass(frozen=True, slots=True)
class MessageAccount:
    account_id: str


@dataclass(frozen=True, slots=True)
class MessageEndUser:
    end_user_id: str


type MessageActor = MessageAccount | MessageEndUser


type MessageInputValue = JsonValue | File | list[File]


@dataclass(frozen=True, slots=True)
class MessageRating:
    rating: str | None


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
class MessageFileReference:
    """Persisted reference; file metadata and URLs are resolved after the read."""

    id: str
    type: str
    transfer_method: str
    url: str | None
    upload_file_id: str | None
    belongs_to: str | None


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
class MessageRecord:
    id: str
    conversation_id: str
    parent_message_id: str | None
    inputs: dict[str, MessageInputValue]
    query: str
    answer: str
    feedback: MessageRating | None
    retriever_resources: list[dict[str, JsonValue]] | None
    created_at: datetime | None
    agent_thoughts: list[MessageAgentThoughtRecord]
    message_files: list[MessageFileRecord]
    message_tokens: int
    answer_tokens: int
    provider_response_latency: float
    total_price: Decimal | None
    currency: str | None
    status: str
    error: str | None
    metadata: JsonValue
    extra_contents: list[dict[str, JsonValue]] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class MessagePage[RecordT]:
    limit: int
    has_more: bool
    data: tuple[RecordT, ...]


@dataclass(frozen=True, slots=True)
class MessageSource[RecordT: MessageRecord]:
    """Database projection before file restoration and extra-content loading.

    The record retains stored JSON inputs and the original answer. Its
    message_files and extra_contents are filled by the shared query service.
    """

    record: RecordT
    files: tuple[MessageFileReference, ...]


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


@dataclass(frozen=True, slots=True, kw_only=True)
class ConsoleMessageRecord(MessageRecord):
    message: JsonValue
    from_source: str
    from_end_user_id: str | None
    from_account_id: str | None
    feedbacks: list[ConsoleMessageFeedbackRecord]
    workflow_run_id: str | None
    annotation: MessageAnnotationRecord | None
    annotation_hit_history: MessageAnnotationHitRecord | None
