"""Manage an account's conversations in an admitted installation."""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from pydantic import JsonValue

from graphon.file import File
from libs.datetime_utils import naive_utc_now
from services.installed_app_access_service import InstalledAppRef

logger = logging.getLogger(__name__)

type ConversationInputValue = JsonValue | File | list[File]


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
class ConversationPage:
    limit: int
    has_more: bool
    data: tuple[ConversationRecord, ...]


@dataclass(frozen=True, slots=True)
class ConversationNameSource:
    tenant_id: str
    query: str


@dataclass(frozen=True, slots=True)
class ConversationDeletion:
    tenant_id: str
    conversation_id: str
    retired_binding_id: str | None


class ConversationNotChatAppError(ValueError):
    """The installed app does not support conversation management."""


class ConversationNameRequiredError(ValueError):
    """A manual rename must provide a name."""


class InstalledAppConversationStore(Protocol):
    def get(self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str) -> ConversationRecord: ...

    def get_page(
        self, *, installed_app: InstalledAppRef, account_id: str, last_id: str | None, limit: int, pinned: bool | None
    ) -> ConversationPage: ...

    def get_name_source(
        self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str
    ) -> ConversationNameSource: ...

    def rename(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        conversation_id: str,
        name: str,
        updated_at: datetime | None,
    ) -> ConversationRecord: ...

    def delete(
        self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str
    ) -> ConversationDeletion: ...

    def set_pinned(
        self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str, is_pinned: bool
    ) -> None: ...


class ConversationNameGenerator(Protocol):
    def __call__(self, *, tenant_id: str, app_id: str, conversation_id: str, query: str, app_mode: str) -> str: ...


class ConversationCleanup(Protocol):
    def __call__(self, *, tenant_id: str, conversation_id: str, retired_binding_id: str | None) -> None: ...


class InstalledAppConversationService:
    def __init__(
        self,
        *,
        conversations: InstalledAppConversationStore,
        generate_name: ConversationNameGenerator,
        enqueue_delete_cleanup: ConversationCleanup,
    ) -> None:
        self._conversations: InstalledAppConversationStore = conversations
        self._generate_name: ConversationNameGenerator = generate_name
        self._enqueue_delete_cleanup: ConversationCleanup = enqueue_delete_cleanup

    def get_page(
        self, *, installed_app: InstalledAppRef, account_id: str, last_id: str | None, limit: int, pinned: bool | None
    ) -> ConversationPage:
        self._get_chat_mode(installed_app)
        return self._conversations.get_page(
            installed_app=installed_app, account_id=account_id, last_id=last_id, limit=limit, pinned=pinned
        )

    def rename(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        conversation_id: str,
        name: str | None,
        auto_generate: bool,
    ) -> ConversationRecord:
        app_mode = self._get_chat_mode(installed_app)
        if not auto_generate:
            if name is None:
                raise ConversationNameRequiredError("name is required when auto_generate is false")
            return self._conversations.rename(
                installed_app=installed_app,
                account_id=account_id,
                conversation_id=conversation_id,
                name=name,
                updated_at=naive_utc_now(),
            )

        source = self._conversations.get_name_source(
            installed_app=installed_app, account_id=account_id, conversation_id=conversation_id
        )
        # The read transaction is closed before entering the model provider.
        try:
            generated_name = self._generate_name(
                tenant_id=source.tenant_id,
                app_id=installed_app.app_id,
                conversation_id=conversation_id,
                query=source.query,
                app_mode=app_mode,
            )
        except Exception:
            # Automatic naming is best-effort; preserve the existing name on failure.
            logger.exception(
                "Failed to generate a name for app %s conversation %s", installed_app.app_id, conversation_id
            )
            return self._conversations.get(
                installed_app=installed_app, account_id=account_id, conversation_id=conversation_id
            )
        # Recheck ownership and deletion state in the write transaction.
        return self._conversations.rename(
            installed_app=installed_app,
            account_id=account_id,
            conversation_id=conversation_id,
            name=generated_name,
            updated_at=None,
        )

    def delete(self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str) -> None:
        self._get_chat_mode(installed_app)
        deleted = self._conversations.delete(
            installed_app=installed_app, account_id=account_id, conversation_id=conversation_id
        )
        # The retirement and soft-delete commit must precede physical cleanup.
        self._enqueue_delete_cleanup(
            tenant_id=deleted.tenant_id,
            conversation_id=deleted.conversation_id,
            retired_binding_id=deleted.retired_binding_id,
        )

    def set_pinned(
        self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str, is_pinned: bool
    ) -> None:
        self._get_chat_mode(installed_app)
        self._conversations.set_pinned(
            installed_app=installed_app, account_id=account_id, conversation_id=conversation_id, is_pinned=is_pinned
        )

    @staticmethod
    def _get_chat_mode(installed_app: InstalledAppRef) -> str:
        mode = installed_app.app_mode
        if mode not in {"chat", "agent-chat", "advanced-chat"}:
            raise ConversationNotChatAppError(f"App {installed_app.app_id} is not a chat app")
        return mode
