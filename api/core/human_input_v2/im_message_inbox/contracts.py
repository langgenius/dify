"""Domain contracts for durable IM callback records."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from typing import NewType, Protocol

from core.human_input_v2.im_integration.adapters.entities import AuthenticatedIMEvent
from core.human_input_v2.shared import IntegrationId

IM_INBOX_PROVIDER_METADATA_MAX_LENGTH = 128


class InboxEventValidationError(ValueError):
    """Provider metadata cannot be represented by the durable inbox contract."""

    field_name: str
    maximum_length: int

    def __init__(self, field_name: str, maximum_length: int) -> None:
        self.field_name = field_name
        self.maximum_length = maximum_length
        super().__init__(f"{field_name} must not exceed {maximum_length} characters")


def validate_inbox_provider_tenant_id(provider_tenant_id: str) -> None:
    """Reject a Provider tenant identity that cannot fit one inbox record."""

    if len(provider_tenant_id) > IM_INBOX_PROVIDER_METADATA_MAX_LENGTH:
        raise InboxEventValidationError("provider tenant id", IM_INBOX_PROVIDER_METADATA_MAX_LENGTH)


def canonicalize_inbox_event(event: AuthenticatedIMEvent) -> AuthenticatedIMEvent:
    """Represent a blank Provider event ID as an absent deduplication identity."""

    if event.event_id is None or event.event_id.strip():
        return event
    return replace(event, event_id=None)


def validate_inbox_event(event: AuthenticatedIMEvent) -> None:
    """Reject Provider metadata that cannot fit one inbox record without truncation."""

    validate_inbox_provider_tenant_id(event.provider_tenant_id)
    if event.event_id is not None and len(event.event_id) > IM_INBOX_PROVIDER_METADATA_MAX_LENGTH:
        raise InboxEventValidationError("provider event id", IM_INBOX_PROVIDER_METADATA_MAX_LENGTH)
    if event.event_type is not None and len(event.event_type) > IM_INBOX_PROVIDER_METADATA_MAX_LENGTH:
        raise InboxEventValidationError("provider event type", IM_INBOX_PROVIDER_METADATA_MAX_LENGTH)


IMInboxRecordId = NewType("IMInboxRecordId", str)


class AcceptanceKind(StrEnum):
    """Whether intake inserted a record or resolved an identified callback."""

    NEW = "new"
    DUPLICATE = "duplicate"


@dataclass(frozen=True, slots=True)
class InboxAcceptance:
    """Durably committed callback record."""

    record_id: IMInboxRecordId
    kind: AcceptanceKind


@dataclass(frozen=True, slots=True)
class IMInboxRecord:
    """Persisted callback facts reconstructed for Celery processing."""

    record_id: IMInboxRecordId
    integration_id: IntegrationId
    event: AuthenticatedIMEvent
    processed_at: datetime | None


class InboxPersistenceError(Exception):
    """Expected database failure while storing or updating an inbox record."""


class IMInboxConsumer(Protocol):
    """Application callback consumer invoked by the Celery task."""

    def consume(self, record: IMInboxRecord) -> None:
        """Process one callback or raise so Celery can retry the task."""


class IMMessageInboxRepository(Protocol):
    """Persistence operations for durable callback facts."""

    def insert_or_resolve(
        self, integration_id: IntegrationId, event: AuthenticatedIMEvent, *, now: datetime
    ) -> InboxAcceptance:
        """Commit a callback or resolve its identified duplicate."""

    def get(self, record_id: IMInboxRecordId) -> IMInboxRecord | None:
        """Load one durable callback record."""

    def mark_processed(self, record_id: IMInboxRecordId, *, processed_at: datetime) -> None:
        """Record that callback processing completed successfully."""
