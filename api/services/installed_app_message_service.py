"""Message reads and feedback for an admitted installation."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime
from decimal import Decimal
from typing import Literal, Protocol

from pydantic import JsonValue

from graphon.file import File
from services.installed_app_access_service import InstalledAppRef

type MessageRating = Literal["like", "dislike"]
type MessageInputValue = JsonValue | File | list[File]


class MessageNotChatAppError(Exception):
    pass


class FeedbackRatingRequiredError(Exception):
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


@dataclass(frozen=True, slots=True)
class MessageFeedbackEvent:
    tenant_id: str
    app_id: str
    conversation_id: str
    message_id: str
    account_id: str
    rating: str
    content: str | None


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

    def set_feedback(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        message_id: str,
        rating: MessageRating | None,
        content: str | None,
    ) -> MessageFeedbackEvent | None: ...


class MessageExtraContentsQuery(Protocol):
    def __call__(self, *, message_ids: Sequence[str]) -> Mapping[str, list[dict[str, JsonValue]]]: ...


class SuggestedQuestionGenerator(Protocol):
    def __call__(self, *, installed_app: InstalledAppRef, account_id: str, message_id: str) -> list[str]: ...


class MessageFeedbackEmitter(Protocol):
    def __call__(self, *, feedback: MessageFeedbackEvent) -> None: ...


class InstalledAppMessageService:
    def __init__(
        self,
        *,
        messages: InstalledAppMessageStore,
        get_extra_contents: MessageExtraContentsQuery,
        suggested_questions: SuggestedQuestionGenerator,
        emit_feedback: MessageFeedbackEmitter,
    ) -> None:
        self._messages: InstalledAppMessageStore = messages
        self._get_extra_contents: MessageExtraContentsQuery = get_extra_contents
        self._suggested_questions: SuggestedQuestionGenerator = suggested_questions
        self._emit_feedback: MessageFeedbackEmitter = emit_feedback

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

    def set_feedback(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        message_id: str,
        rating: MessageRating | None,
        content: str | None,
    ) -> None:
        feedback = self._messages.set_feedback(
            installed_app=installed_app,
            account_id=account_id,
            message_id=message_id,
            rating=rating,
            content=content,
        )
        if feedback is not None:
            self._emit_feedback(feedback=feedback)

    def get_suggested_questions(self, *, installed_app: InstalledAppRef, account_id: str, message_id: str) -> list[str]:
        self._require_chat_app(installed_app)
        return self._suggested_questions(installed_app=installed_app, account_id=account_id, message_id=message_id)

    @staticmethod
    def _require_chat_app(installed_app: InstalledAppRef) -> None:
        if installed_app.app_mode not in {"chat", "agent-chat", "advanced-chat"}:
            raise MessageNotChatAppError(f"Installed app {installed_app.id} is not a chat app.")
