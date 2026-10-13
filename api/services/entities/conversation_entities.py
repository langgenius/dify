"""Detached conversation records and explicit ownership references."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import JsonValue

from graphon.file import File
from services.installed_app_access_service import InstalledAppRef

type ConversationInputValue = JsonValue | File | list[File]
type ConversationListSource = Literal["web-app", "service-api", "explore"]
type ConversationSort = Literal["created_at", "-created_at", "updated_at", "-updated_at"]


@dataclass(frozen=True, slots=True)
class ConversationRecord:
    id: str
    name: str
    inputs: dict[str, ConversationInputValue]
    status: str
    introduction: str | None
    created_at: datetime | None
    updated_at: datetime | None


@dataclass(frozen=True, slots=True)
class ConversationNameSource:
    tenant_id: str
    query: str


@dataclass(frozen=True, slots=True)
class EndUserConversationScope:
    app_id: str
    tenant_id: str
    end_user_id: str


@dataclass(frozen=True, slots=True)
class EndUserConversationRef(EndUserConversationScope):
    conversation_id: str


@dataclass(frozen=True, slots=True)
class InstalledAppConversationScope:
    # An installation can belong to a different workspace than its underlying app.
    installed_app: InstalledAppRef
    account_id: str

    @property
    def app_id(self) -> str:
        return self.installed_app.app_id


@dataclass(frozen=True, slots=True)
class InstalledAppConversationRef(InstalledAppConversationScope):
    conversation_id: str


type ConversationScope = EndUserConversationScope | InstalledAppConversationScope
type ConversationRef = EndUserConversationRef | InstalledAppConversationRef


@dataclass(frozen=True, slots=True)
class ConversationPage:
    tenant_id: str
    limit: int
    has_more: bool
    data: tuple[ConversationRecord, ...]


@dataclass(frozen=True, slots=True)
class ConversationDeletion:
    tenant_id: str
    conversation_id: str
    retired_workspace_ids: tuple[str, ...]


type ConsoleConversationKind = Literal["completion", "chat"]
type ConversationAnnotationStatus = Literal["annotated", "not_annotated", "all"]


@dataclass(frozen=True, slots=True)
class ConsoleConversationScope:
    app_id: str
    tenant_id: str
    app_mode: str
    timezone: str


@dataclass(frozen=True, slots=True)
class ConsoleConversationFilters:
    keyword: str | None
    start: datetime | None
    end: datetime | None
    annotation_status: ConversationAnnotationStatus
    sort_by: ConversationSort
    page: int
    limit: int


@dataclass(frozen=True, slots=True)
class ConsoleConversationAccount:
    id: str
    name: str
    email: str


@dataclass(frozen=True, slots=True)
class ConsoleConversationAnnotation:
    id: str
    question: str | None
    content: str
    account: ConsoleConversationAccount | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ConsoleConversationMessage:
    # File reconstruction belongs after the repository's read session closes.
    inputs: dict[str, ConversationInputValue]
    query: str
    message: JsonValue
    answer: str


@dataclass(frozen=True, slots=True)
class ConsoleConversationRecord:
    id: str
    status: str
    from_source: str
    from_end_user_id: str | None
    from_end_user_session_id: str | None
    from_account_id: str | None
    from_account_name: str | None
    read_at: datetime | None
    created_at: datetime | None
    updated_at: datetime | None
    model_config: dict[str, JsonValue]
    user_feedback_stats: dict[str, int]
    admin_feedback_stats: dict[str, int]


@dataclass(frozen=True, slots=True)
class ConsoleCompletionConversationRecord(ConsoleConversationRecord):
    annotation: ConsoleConversationAnnotation | None
    first_message: ConsoleConversationMessage | None


@dataclass(frozen=True, slots=True)
class ConsoleChatConversationRecord(ConsoleConversationRecord):
    name: str
    summary_or_query: str
    annotated: bool
    message_count: int
    status_count: dict[str, int] | None


@dataclass(frozen=True, slots=True)
class ConsoleConversationPage:
    tenant_id: str
    page: int
    per_page: int
    total: int
    has_next: bool
    items: tuple[ConsoleCompletionConversationRecord | ConsoleChatConversationRecord, ...]
