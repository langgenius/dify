"""Operation-oriented persistence port for durable delivery attempts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from core.human_input_v2.delivery_runtime import ConfigurationSnapshotIdentity, DeliveryOutcome
from core.human_input_v2.shared import DeliveryAttemptId, UtcTimestamp

from .delivery import DeliveryAttempt, DeliveryAttemptData


@dataclass(frozen=True, slots=True)
class ClaimedDeliveryAttempt:
    attempt: DeliveryAttempt
    data: DeliveryAttemptData


class DeliveryAttemptRepository(Protocol):
    def list_due_ids(self, *, now: UtcTimestamp, limit: int) -> tuple[DeliveryAttemptId, ...]: ...

    def claim(self, attempt_id: DeliveryAttemptId, *, now: UtcTimestamp) -> ClaimedDeliveryAttempt | None: ...

    def bind_prepared(
        self,
        claim: ClaimedDeliveryAttempt,
        *,
        snapshot: ConfigurationSnapshotIdentity,
        payload_fingerprint: str,
        now: UtcTimestamp,
    ) -> ClaimedDeliveryAttempt | None: ...

    def requeue(
        self,
        claim: ClaimedDeliveryAttempt,
        *,
        outcome: DeliveryOutcome,
        scheduled_at: UtcTimestamp,
        now: UtcTimestamp,
    ) -> bool: ...

    def complete(
        self,
        claim: ClaimedDeliveryAttempt,
        *,
        outcome: DeliveryOutcome,
        now: UtcTimestamp,
    ) -> bool: ...

    def recover_stale(
        self,
        *,
        stale_before: UtcTimestamp,
        idempotency_cutoff: UtcTimestamp,
        now: UtcTimestamp,
        limit: int,
    ) -> int: ...


__all__ = ["ClaimedDeliveryAttempt", "DeliveryAttemptRepository"]
