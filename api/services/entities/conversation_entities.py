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
