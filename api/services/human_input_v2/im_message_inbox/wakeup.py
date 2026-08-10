"""Payload-free post-commit wakeup contract for the IM message inbox."""

from typing import Protocol

from core.human_input_v2.im_message_inbox import IMInboxRecordId


class InboxWakeup(Protocol):
    """Post-commit latency hint carrying only the inbox record ID."""

    def publish(self, record_id: IMInboxRecordId) -> None:
        """Publish at most one wakeup for one accepted delivery."""


class InboxWakeupError(RuntimeError):
    """Expected broker unavailability after durable acceptance."""
