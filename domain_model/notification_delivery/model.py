"""Notification delivery policy boundary over existing persistence stubs."""

from datetime import datetime
from typing import Protocol

from core.human_input_v2.entities import HumanInputDeliveryChannel

from domain_model.shared.identifiers import FormInstanceId


class NotificationDeliveryService(Protocol):
    """Application-facing lifecycle operations for existing delivery records.

    Implementations create and update the existing endpoint and attempt models.
    A delivery failure is recorded on the attempt and must never mutate the Human
    Input form status directly.
    """

    def schedule_attempt(
        self,
        *,
        form_instance_id: FormInstanceId,
        endpoint_id: str,
        channel: HumanInputDeliveryChannel,
        scheduled_at: datetime,
    ) -> str:
        """Create one queued delivery attempt and return its persistence ID."""

        ...

    def mark_sent(
        self, *, attempt_id: str, provider_message_id: str, sent_at: datetime
    ) -> None:
        """Finalize one attempt as sent without changing the form lifecycle."""

        ...

    def mark_failed(
        self, *, attempt_id: str, failure_code: str, failed_at: datetime
    ) -> None:
        """Finalize one attempt with a stable failure code for retry and audit."""

        ...
