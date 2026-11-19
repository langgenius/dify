"""Message queries returning complete, detached records."""

from collections.abc import Sequence
from dataclasses import replace
from typing import Protocol

from pydantic import JsonValue

from services.entities.message_entities import (
    ConsoleMessageRecord,
    MessageActor,
    MessageFileProjection,
    MessageFileReference,
    MessageInputValue,
    MessagePage,
    MessageRecord,
    MessageSource,
)
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
    ) -> MessagePage[MessageSource[MessageRecord]]: ...

    def get_console_message_page(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        account_id: str,
        conversation_id: str,
        first_id: str | None,
        limit: int,
    ) -> MessagePage[MessageSource[ConsoleMessageRecord]]: ...

    def get_console_message(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        account_id: str,
        message_id: str,
    ) -> MessageSource[ConsoleMessageRecord]: ...


class MessageFiles(Protocol):
    def resolve(
        self,
        *,
        tenant_id: str,
        inputs: dict[str, MessageInputValue],
        answer: str,
        files: Sequence[MessageFileReference],
    ) -> MessageFileProjection: ...


class MessageExtraContents(Protocol):
    def get_by_message_ids(self, message_ids: Sequence[str]) -> list[list[dict[str, JsonValue]]]: ...


class MessageQueryService:
    def __init__(
        self, *, messages: MessageQueryStore, files: MessageFiles, extra_contents: MessageExtraContents
    ) -> None:
        self._messages: MessageQueryStore = messages
        self._files: MessageFiles = files
        self._extra_contents: MessageExtraContents = extra_contents

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
        page = self._messages.get_message_page(
            app_id=app_id,
            app_owner_tenant_id=app_owner_tenant_id,
            actor=actor,
            conversation_id=conversation_id,
            first_id=first_id,
            limit=limit,
            installed_app=installed_app,
        )
        return self._render_page(page, tenant_id=app_owner_tenant_id)

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
        page = self._messages.get_console_message_page(
            app_id=app_id,
            app_owner_tenant_id=app_owner_tenant_id,
            account_id=account_id,
            conversation_id=conversation_id,
            first_id=first_id,
            limit=limit,
        )
        return self._render_page(page, tenant_id=app_owner_tenant_id)

    def get_console_message(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        account_id: str,
        message_id: str,
    ) -> ConsoleMessageRecord:
        """Read an app-scoped Console detail, including other accounts' messages."""
        source = self._messages.get_console_message(
            app_id=app_id,
            app_owner_tenant_id=app_owner_tenant_id,
            account_id=account_id,
            message_id=message_id,
        )
        return self._render((source,), tenant_id=app_owner_tenant_id)[0]

    def _render_page[RecordT: MessageRecord](
        self, page: MessagePage[MessageSource[RecordT]], *, tenant_id: str
    ) -> MessagePage[RecordT]:
        return MessagePage(
            limit=page.limit,
            has_more=page.has_more,
            data=self._render(page.data, tenant_id=tenant_id),
        )

    def _render[RecordT: MessageRecord](
        self, sources: Sequence[MessageSource[RecordT]], *, tenant_id: str
    ) -> tuple[RecordT, ...]:
        if not sources:
            return ()

        # The repository has closed its read session before file restoration,
        # which may fetch remote metadata or open its own short lookup sessions.
        records: list[RecordT] = []
        for source in sources:
            files = self._files.resolve(
                tenant_id=tenant_id,
                inputs=source.record.inputs,
                answer=source.record.answer,
                files=source.files,
            )
            records.append(replace(source.record, inputs=files.inputs, answer=files.answer, message_files=files.files))

        contents = self._extra_contents.get_by_message_ids([record.id for record in records])
        return tuple(replace(record, extra_contents=items) for record, items in zip(records, contents, strict=True))
