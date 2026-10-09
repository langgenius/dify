"""Message queries returning complete, detached records."""

from typing import Protocol

from services.entities.message_entities import ConsoleMessageRecord, MessageActor, MessagePage, MessageRecord
from services.installed_app_access_service import InstalledAppRef


class MessageNotChatAppError(Exception):
    pass


class MessageQueryStore(Protocol):
    def get_message_page(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        actor: MessageActor,
        conversation_id: str,
        first_id: str | None,
        limit: int,
        installed_app: InstalledAppRef | None,
    ) -> MessagePage[MessageRecord]: ...

    def get_console_message_page(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        account_id: str,
        conversation_id: str,
        first_id: str | None,
        limit: int,
    ) -> MessagePage[ConsoleMessageRecord]: ...

    def get_console_message(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        account_id: str,
        message_id: str,
    ) -> ConsoleMessageRecord: ...


class MessageQueryService:
    def __init__(self, *, messages: MessageQueryStore) -> None:
        self._messages: MessageQueryStore = messages

    def get_page(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        actor: MessageActor,
        conversation_id: str,
        first_id: str | None,
        limit: int,
        installed_app: InstalledAppRef | None = None,
    ) -> MessagePage[MessageRecord]:
        """Read an actor's conversation; installed_app rechecks Explore ownership.

        Web and Service API pass no installation. A missing first_id reads the
        latest page, presented oldest first within that page.
        """
        if installed_app is not None and installed_app.app_mode not in {"chat", "agent-chat", "advanced-chat"}:
            raise MessageNotChatAppError(f"Installed app {installed_app.id} is not a chat app.")
        return self._messages.get_message_page(
            app_id=app_id,
            app_owner_tenant_id=app_owner_tenant_id,
            actor=actor,
            conversation_id=conversation_id,
            first_id=first_id,
            limit=limit,
            installed_app=installed_app,
        )

    def get_console_page(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        account_id: str,
        conversation_id: str,
        first_id: str | None,
        limit: int,
    ) -> MessagePage[ConsoleMessageRecord]:
        """Read Console logs, retaining account ownership for Agent conversations."""
        return self._messages.get_console_message_page(
            app_id=app_id,
            app_owner_tenant_id=app_owner_tenant_id,
            account_id=account_id,
            conversation_id=conversation_id,
            first_id=first_id,
            limit=limit,
        )

    def get_console_message(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        account_id: str,
        message_id: str,
    ) -> ConsoleMessageRecord:
        """Read an app-scoped Console detail, including other accounts' messages."""
        return self._messages.get_console_message(
            app_id=app_id,
            app_owner_tenant_id=app_owner_tenant_id,
            account_id=account_id,
            message_id=message_id,
        )
