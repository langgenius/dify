"""Manage an account's conversations in an admitted installation."""

from typing import Protocol

from services.conversation_command_service import ConversationCommandService
from services.conversation_name_service import ConversationNameService
from services.entities.conversation_entities import (
    ConversationPage,
    ConversationRecord,
    InstalledAppConversationRef,
)
from services.installed_app_access_service import InstalledAppRef


class ConversationNotChatAppError(ValueError):
    """The installed app does not support conversation management."""


class InstalledAppConversationStore(Protocol):
    def get_page(
        self, *, installed_app: InstalledAppRef, account_id: str, last_id: str | None, limit: int, pinned: bool | None
    ) -> ConversationPage: ...


class InstalledAppConversationService:
    def __init__(
        self,
        *,
        conversations: InstalledAppConversationStore,
        names: ConversationNameService,
        commands: ConversationCommandService,
    ) -> None:
        self._conversations: InstalledAppConversationStore = conversations
        self._names = names
        self._commands = commands

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
        """Rename a conversation manually or generate its name.

        When auto_generate is False, name is required and cannot be None.
        When auto_generate is True, name is ignored.
        """
        app_mode = self._get_chat_mode(installed_app)
        return self._names.rename(
            ref=InstalledAppConversationRef(
                installed_app=installed_app, account_id=account_id, conversation_id=conversation_id
            ),
            app_mode=app_mode,
            name=name,
            auto_generate=auto_generate,
        )

    def delete(self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str) -> None:
        self._get_chat_mode(installed_app)
        self._commands.delete(
            ref=InstalledAppConversationRef(
                installed_app=installed_app, account_id=account_id, conversation_id=conversation_id
            )
        )

    def set_pinned(
        self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str, is_pinned: bool
    ) -> None:
        self._get_chat_mode(installed_app)
        self._commands.set_pinned(
            ref=InstalledAppConversationRef(
                installed_app=installed_app, account_id=account_id, conversation_id=conversation_id
            ),
            is_pinned=is_pinned,
        )

    @staticmethod
    def _get_chat_mode(installed_app: InstalledAppRef) -> str:
        mode = installed_app.app_mode
        if mode not in {"chat", "agent-chat", "advanced-chat"}:
            raise ConversationNotChatAppError(f"App {installed_app.app_id} is not a chat app")
        return mode
