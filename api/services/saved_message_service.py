from dataclasses import dataclass
from datetime import datetime
from typing import Literal, NamedTuple, Protocol

from pydantic import JsonValue

from graphon.file import File

type SavedMessageActorRole = Literal["account", "end_user"]
type SavedMessageInputValue = JsonValue | File | list[File]


@dataclass(frozen=True, slots=True)
class SavedMessageActor:
    id: str
    role: SavedMessageActorRole

    @classmethod
    def account(cls, account_id: str) -> "SavedMessageActor":
        return cls(id=account_id, role="account")

    @classmethod
    def end_user(cls, end_user_id: str) -> "SavedMessageActor":
        return cls(id=end_user_id, role="end_user")


class SavedMessageFeedback(NamedTuple):
    rating: str | None


class SavedMessageFileRecord(NamedTuple):
    id: str
    filename: str
    type: str
    url: str | None
    mime_type: str | None
    size: int | None
    transfer_method: str
    belongs_to: str | None
    upload_file_id: str | None


class SavedMessageRecord(NamedTuple):
    id: str
    inputs: dict[str, SavedMessageInputValue]
    query: str
    answer: str
    message_files: list[SavedMessageFileRecord]
    user_feedback: SavedMessageFeedback | None
    created_at: datetime | None


class SavedMessagePage(NamedTuple):
    limit: int
    has_more: bool
    data: tuple[SavedMessageRecord, ...]


class SavedMessageStore(Protocol):
    def pagination_by_last_id(
        self,
        *,
        app_id: str,
        actor: SavedMessageActor,
        last_id: str | None,
        limit: int,
    ) -> SavedMessagePage: ...

    def save(self, *, app_id: str, actor: SavedMessageActor, message_id: str) -> None: ...

    def delete(self, *, app_id: str, actor: SavedMessageActor, message_id: str) -> None: ...


class SavedMessageService:
    def __init__(self, *, saved_messages: SavedMessageStore) -> None:
        self._saved_messages = saved_messages

    def pagination_by_last_id(
        self,
        *,
        app_id: str,
        actor: SavedMessageActor,
        last_id: str | None,
        limit: int,
    ) -> SavedMessagePage:
        return self._saved_messages.pagination_by_last_id(
            app_id=app_id,
            actor=actor,
            last_id=last_id,
            limit=limit,
        )

    def save(self, *, app_id: str, actor: SavedMessageActor, message_id: str) -> None:
        self._saved_messages.save(app_id=app_id, actor=actor, message_id=message_id)

    def delete(self, *, app_id: str, actor: SavedMessageActor, message_id: str) -> None:
        self._saved_messages.delete(app_id=app_id, actor=actor, message_id=message_id)
