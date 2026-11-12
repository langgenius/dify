"""Rename conversations with model work outside their read and write transactions."""

import logging
from datetime import datetime
from typing import Protocol

from libs.datetime_utils import naive_utc_now
from services.entities.conversation_entities import ConversationNameSource, ConversationRecord, ConversationRef

logger = logging.getLogger(__name__)


class ConversationNameRequiredError(ValueError):
    """A manual rename must provide a name."""


class ConversationNameGenerator(Protocol):
    def __call__(self, *, tenant_id: str, app_id: str, conversation_id: str, query: str, app_mode: str) -> str: ...


class ConversationNameStore(Protocol):
    def get(self, *, ref: ConversationRef) -> ConversationRecord: ...

    def get_name_source(self, *, ref: ConversationRef) -> ConversationNameSource: ...

    def rename(self, *, ref: ConversationRef, name: str, updated_at: datetime | None) -> ConversationRecord:
        """None uses the database model's automatic update timestamp."""
        ...


class ConversationNameService:
    def __init__(self, *, conversations: ConversationNameStore, generate_name: ConversationNameGenerator) -> None:
        self._conversations = conversations
        self._generate_name = generate_name

    def rename(
        self,
        *,
        ref: ConversationRef,
        app_mode: str,
        name: str | None,
        auto_generate: bool,
    ) -> ConversationRecord:
        """Require name for manual renames; ignore it when generating automatically."""
        if not auto_generate:
            if name is None:
                raise ConversationNameRequiredError("name is required when auto_generate is false")
            return self._conversations.rename(ref=ref, name=name, updated_at=naive_utc_now())

        source = self._conversations.get_name_source(ref=ref)
        # The store closes its read transaction before entering the model provider.
        try:
            generated_name = self._generate_name(
                tenant_id=source.tenant_id,
                app_id=ref.app_id,
                conversation_id=ref.conversation_id,
                query=source.query,
                app_mode=app_mode,
            )
        except Exception:
            # Automatic naming is best-effort; preserve the existing name on failure.
            logger.exception("Failed to generate a name for app %s conversation %s", ref.app_id, ref.conversation_id)
            return self._conversations.get(ref=ref)
        # The write transaction rechecks ownership and deletion state.
        return self._conversations.rename(ref=ref, name=generated_name, updated_at=None)
