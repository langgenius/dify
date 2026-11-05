"""Narrow persistence capabilities consumed by graph nodes."""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Any, Protocol

from services.knowledge.entities.segments import SegmentAttachmentRecord

if TYPE_CHECKING:
    from core.memory.token_buffer_memory import PreparedHistory


class RetrieverAttachments(Protocol):
    def attachments(self, *, tenant_id: str, segment_id: str) -> Sequence[SegmentAttachmentRecord]: ...


class ConversationHistory(Protocol):
    def history(
        self, *, tenant_id: str, app_id: str, conversation_id: str, message_limit: int | None
    ) -> PreparedHistory: ...


class DatasourceCredentials(Protocol):
    def __call__(
        self, tenant_id: str, provider: str, plugin_id: str, credential_id: str | None = None
    ) -> dict[str, Any]: ...
