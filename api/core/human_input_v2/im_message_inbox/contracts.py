"""Infrastructure-free domain contracts for durable IM event delivery."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum
from typing import NewType, Protocol

from core.human_input_v2.im_provider import AuthenticatedIMEvent
from core.human_input_v2.shared import IntegrationId, UtcTimestamp

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


def validate_inbox_event(event: AuthenticatedIMEvent) -> None:
    """Reject Provider metadata that cannot fit one inbox record without truncation."""

    validate_inbox_provider_tenant_id(event.provider_tenant_id)
    if event.event_id is not None and len(event.event_id) > IM_INBOX_PROVIDER_METADATA_MAX_LENGTH:
        raise InboxEventValidationError("provider event id", IM_INBOX_PROVIDER_METADATA_MAX_LENGTH)
    if event.event_type is not None and len(event.event_type) > IM_INBOX_PROVIDER_METADATA_MAX_LENGTH:
        raise InboxEventValidationError("provider event type", IM_INBOX_PROVIDER_METADATA_MAX_LENGTH)


IMInboxRecordId = NewType("IMInboxRecordId", str)
ClaimToken = NewType("ClaimToken", str)


class InboxProcessingStatus(StrEnum):
    """Persisted inbox processing lifecycle."""

    PENDING = "pending"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    IGNORED = "ignored"
    FAILED = "failed"


class InboxClaimOrigin(StrEnum):
    """Persisted state from which the current processing lease was acquired."""

    PENDING = "pending"
    EXPIRED_PROCESSING = "expired_processing"


class ConsumerDecision(StrEnum):
    """Typed downstream processing decision."""

    SUCCEEDED = "succeeded"
    IGNORED = "ignored"
    RETRY = "retry"
    FAILED = "failed"


class AcceptanceKind(StrEnum):
    """Whether intake inserted a new record or resolved a durable duplicate."""

    NEW = "new"
    DUPLICATE = "duplicate"


@dataclass(frozen=True, slots=True)
class IMInboxDelivery:
    """Claimed authenticated event plus local routing and fencing metadata."""

    record_id: IMInboxRecordId
    integration_id: IntegrationId
    event: AuthenticatedIMEvent
    claim_origin: InboxClaimOrigin
    attempt: int
    claim_token: ClaimToken

    def __post_init__(self) -> None:
        if self.attempt < 1:
            raise ValueError("attempt must be positive")


@dataclass(frozen=True, slots=True)
class LostLease:
    """A stale owner result that cannot mutate the current record state."""

    record_id: IMInboxRecordId
    claim_token: ClaimToken


@dataclass(frozen=True, slots=True)
class InboxAcceptance:
    """Durably committed acceptance result."""

    record_id: IMInboxRecordId
    kind: AcceptanceKind


@dataclass(frozen=True, slots=True)
class TransitionApplied:
    """Successful processing metadata transition."""

    record_id: IMInboxRecordId


type TransitionResult = TransitionApplied | LostLease


@dataclass(frozen=True, slots=True)
class InboxBacklog:
    """Payload-free status counts and oldest pending age."""

    status_counts: tuple[tuple[InboxProcessingStatus, int], ...]
    oldest_pending_age: timedelta | None

    def count(self, status: InboxProcessingStatus) -> int:
        for candidate, count in self.status_counts:
            if candidate is status:
                return count
        return 0


class InboxPersistenceError(RuntimeError):
    """Expected database failure during durable intake."""


class IMInboxConsumer(Protocol):
    """Independent at-least-once consumer outside persistence transactions."""

    def consume(self, delivery: IMInboxDelivery) -> ConsumerDecision:
        """Process one claimed delivery and return an explicit decision."""


class IMMessageInboxRepository(Protocol):
    """Persistence port; implementations own all session and locking details."""

    def insert_or_resolve(
        self, integration_id: IntegrationId, event: AuthenticatedIMEvent, *, now: UtcTimestamp
    ) -> InboxAcceptance:
        """Commit a new record or resolve its identified duplicate."""

    def claim_by_id(
        self, record_id: IMInboxRecordId, *, now: UtcTimestamp, lease_duration: timedelta
    ) -> IMInboxDelivery | None:
        """Acquire an available record in a short transaction."""

    def claim_available(
        self, *, now: UtcTimestamp, lease_duration: timedelta, limit: int
    ) -> tuple[IMInboxDelivery, ...]:
        """Acquire a bounded available batch using the same claim contract."""

    def renew(
        self,
        record_id: IMInboxRecordId,
        claim_token: ClaimToken,
        *,
        now: UtcTimestamp,
        lease_duration: timedelta,
    ) -> TransitionResult:
        """Renew the current unexpired fenced lease."""

    def retry(
        self,
        record_id: IMInboxRecordId,
        claim_token: ClaimToken,
        *,
        now: UtcTimestamp,
        maximum_attempts: int,
    ) -> TransitionResult:
        """Return a current claim to pending or exhaust it to terminal failure."""

    def succeed(self, record_id: IMInboxRecordId, claim_token: ClaimToken, *, now: UtcTimestamp) -> TransitionResult:
        """Finalize current work successfully."""

    def ignore(self, record_id: IMInboxRecordId, claim_token: ClaimToken, *, now: UtcTimestamp) -> TransitionResult:
        """Finalize current work as intentionally ignored."""

    def fail(
        self,
        record_id: IMInboxRecordId,
        claim_token: ClaimToken,
        *,
        now: UtcTimestamp,
    ) -> TransitionResult:
        """Finalize current work as a terminal failure."""

    def recoverable_record_ids(self, *, now: UtcTimestamp, limit: int) -> tuple[IMInboxRecordId, ...]:
        """Return payload-free available pending and expired-processing IDs."""

    def backlog(self, *, now: UtcTimestamp) -> InboxBacklog:
        """Return payload-free backlog observations."""
