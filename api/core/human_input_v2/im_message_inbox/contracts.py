"""Infrastructure-free domain contracts for durable IM event delivery."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum
from typing import NewType, Protocol

from core.human_input_v2.entities import IMProvider
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
class InboxProcessingPolicy:
    """Immutable attempt, lease, and retry-availability policy owned by persistence."""

    maximum_attempts: int
    lease_duration: timedelta
    retry_backoff_minimum: timedelta
    retry_backoff_maximum: timedelta

    def __post_init__(self) -> None:
        if self.maximum_attempts < 1:
            raise ValueError("maximum attempts must be positive")
        if self.lease_duration <= timedelta():
            raise ValueError("lease duration must be positive")
        if self.retry_backoff_minimum <= timedelta():
            raise ValueError("retry backoff minimum must be positive")
        if self.retry_backoff_maximum < self.retry_backoff_minimum:
            raise ValueError("retry backoff maximum must not be shorter than its minimum")

    def retry_delay(self, completed_attempts: int) -> timedelta:
        """Return capped exponential delay after the given completed attempt."""

        if completed_attempts < 1:
            raise ValueError("completed attempts must be positive")
        delay = self.retry_backoff_minimum
        remaining_doublings = completed_attempts - 1
        while remaining_doublings > 0 and delay < self.retry_backoff_maximum:
            delay = min(delay * 2, self.retry_backoff_maximum)
            remaining_doublings -= 1
        return delay


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
class InboxClaimExhausted:
    """Expired processing work atomically failed before a new claim was issued."""

    record_id: IMInboxRecordId
    provider: IMProvider
    attempt: int

    def __post_init__(self) -> None:
        if self.attempt < 1:
            raise ValueError("attempt must be positive")


type InboxClaimResult = IMInboxDelivery | InboxClaimExhausted


@dataclass(frozen=True, slots=True)
class LostLease:
    """A stale owner result that cannot mutate the current record state."""

    record_id: IMInboxRecordId
    claim_token: ClaimToken


@dataclass(frozen=True, slots=True)
class RetryScheduled:
    """Current processing claim returned to delayed pending work."""

    record_id: IMInboxRecordId


@dataclass(frozen=True, slots=True)
class RetryExhausted:
    """Current processing claim reached its attempt limit and failed terminally."""

    record_id: IMInboxRecordId


type RetryResult = RetryScheduled | RetryExhausted | LostLease


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
    """Persistence port; ``now`` values are timezone-aware UTC instants.

    Implementations own all session and locking details and may normalize those
    instants to the database timestamp representation at the persistence edge.
    """

    def insert_or_resolve(
        self, integration_id: IntegrationId, event: AuthenticatedIMEvent, *, now: datetime
    ) -> InboxAcceptance:
        """Commit a new record or resolve its identified duplicate."""

    def claim_by_id(self, record_id: IMInboxRecordId, *, now: datetime) -> InboxClaimResult | None:
        """Acquire an available record in a short transaction."""

    def claim_available(self, *, now: datetime, limit: int) -> tuple[InboxClaimResult, ...]:
        """Acquire a bounded available batch using the same claim contract."""

    def renew(
        self,
        record_id: IMInboxRecordId,
        claim_token: ClaimToken,
        *,
        now: datetime,
    ) -> TransitionResult:
        """Renew the current unexpired fenced lease."""

    def retry(
        self,
        record_id: IMInboxRecordId,
        claim_token: ClaimToken,
        *,
        now: datetime,
    ) -> RetryResult:
        """Return a current claim to pending or exhaust it to terminal failure."""

    def succeed(self, record_id: IMInboxRecordId, claim_token: ClaimToken, *, now: datetime) -> TransitionResult:
        """Finalize current work successfully."""

    def ignore(self, record_id: IMInboxRecordId, claim_token: ClaimToken, *, now: datetime) -> TransitionResult:
        """Finalize current work as intentionally ignored."""

    def fail(
        self,
        record_id: IMInboxRecordId,
        claim_token: ClaimToken,
        *,
        now: datetime,
    ) -> TransitionResult:
        """Finalize current work as a terminal failure."""

    def recoverable_record_ids(self, *, now: datetime, limit: int) -> tuple[IMInboxRecordId, ...]:
        """Return payload-free available pending and expired-processing IDs."""

    def backlog(self, *, now: datetime) -> InboxBacklog:
        """Return payload-free backlog observations."""
