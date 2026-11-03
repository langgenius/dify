"""Persist a message owner's completed OpenUI form draft independently of runs."""

from typing import Protocol

from pydantic import JsonValue

from libs.generative_ui import OpenUIContentBlock
from services.entities.message_entities import MessageActor
from services.installed_app_access_service import InstalledAppRef


class OpenUIBlockNotReadyError(Exception):
    """The target block has not completed generation and cannot accept a draft."""


class OpenUIStateRepository(Protocol):
    def save_state(
        self,
        *,
        actor: MessageActor,
        app_id: str,
        app_owner_tenant_id: str,
        message_id: str,
        block_id: str,
        form_state: dict[str, JsonValue],
        installed_app: InstalledAppRef | None,
    ) -> OpenUIContentBlock:
        """Update a completed block scoped to its app, tenant and message author.

        Revalidate an optional installed-app reference inside the same transaction.
        Hold a message-row lock across checking and writing, preserving unrelated
        metadata; the last successful write to a block wins. Reject incomplete
        blocks with OpenUIBlockNotReadyError and unavailable resources with
        MessageNotExistsError. Return a detached block after committing.
        """
        ...


class OpenUIStateService:
    def __init__(self, repository: OpenUIStateRepository) -> None:
        self._repository = repository

    def save_state(
        self,
        *,
        actor: MessageActor,
        app_id: str,
        app_owner_tenant_id: str,
        message_id: str,
        block_id: str,
        form_state: dict[str, JsonValue],
        installed_app: InstalledAppRef | None = None,
    ) -> OpenUIContentBlock:
        return self._repository.save_state(
            actor=actor,
            app_id=app_id,
            app_owner_tenant_id=app_owner_tenant_id,
            message_id=message_id,
            block_id=block_id,
            form_state=form_state,
            installed_app=installed_app,
        )
