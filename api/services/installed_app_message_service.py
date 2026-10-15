"""Message reads for an admitted installation."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime
from decimal import Decimal
from typing import Protocol

from pydantic import JsonValue

from graphon.file import File
from services.installed_app_access_service import InstalledAppRef

type MessageInputValue = JsonValue | File | list[File]


class MessageNotChatAppError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class MessageFeedbackRecord:
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
    feedback: MessageFeedbackRecord | None
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
class MessagePage:
    limit: int
    has_more: bool
    data: tuple[MessageRecord, ...]


class InstalledAppMessageStore(Protocol):
    def get_page(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        conversation_id: str,
        first_id: str | None,
        limit: int,
    ) -> MessagePage: ...


class MessageExtraContentsQuery(Protocol):
    def __call__(self, *, message_ids: Sequence[str]) -> Mapping[str, list[dict[str, JsonValue]]]: ...


class InstalledAppMessageService:
    def __init__(
        self,
        *,
        messages: InstalledAppMessageStore,
        get_extra_contents: MessageExtraContentsQuery,
    ) -> None:
        self._messages: InstalledAppMessageStore = messages
        self._get_extra_contents: MessageExtraContentsQuery = get_extra_contents

    def get_page(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        conversation_id: str,
        first_id: str | None,
        limit: int,
    ) -> MessagePage:
        self._require_chat_app(installed_app)
        page = self._messages.get_page(
            installed_app=installed_app,
            account_id=account_id,
            conversation_id=conversation_id,
            first_id=first_id,
            limit=limit,
        )
        if not page.data:
            return page
        contents = self._get_extra_contents(message_ids=[message.id for message in page.data])
        return replace(
            page,
            data=tuple(replace(message, extra_contents=contents.get(message.id, [])) for message in page.data),
        )

    @staticmethod
    def _require_chat_app(installed_app: InstalledAppRef) -> None:
        if installed_app.app_mode not in {"chat", "agent-chat", "advanced-chat"}:
            raise MessageNotChatAppError(f"Installed app {installed_app.id} is not a chat app.")
