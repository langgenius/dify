"""Operation-oriented persistence port for durable delivery attempts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from pydantic import NaiveDatetime

from core.human_input_v2.delivery_runtime import ConfigurationSnapshotIdentity, DeliveryOutcome
from core.human_input_v2.shared import DeliveryAttemptId

from .delivery import DeliveryAttempt, DeliveryAttemptData


@dataclass(frozen=True, slots=True)
class ClaimedDeliveryAttempt:
    attempt: DeliveryAttempt
    data: DeliveryAttemptData


class DeliveryAttemptRepository(Protocol):
    def list_due_ids(self, *, now: NaiveDatetime, limit: int) -> tuple[DeliveryAttemptId, ...]: ...

    def claim(self, attempt_id: DeliveryAttemptId, *, now: NaiveDatetime) -> ClaimedDeliveryAttempt | None: ...

    def bind_prepared(
        self,
        claim: ClaimedDeliveryAttempt,
        *,
        snapshot: ConfigurationSnapshotIdentity,
        payload_fingerprint: str,
        now: NaiveDatetime,
    ) -> ClaimedDeliveryAttempt | None: ...

    def requeue(
        self,
        claim: ClaimedDeliveryAttempt,
        *,
        outcome: DeliveryOutcome,
        scheduled_at: NaiveDatetime,
        now: NaiveDatetime,
    ) -> bool: ...

    def complete(
        self,
        claim: ClaimedDeliveryAttempt,
        *,
        outcome: DeliveryOutcome,
        now: NaiveDatetime,
    ) -> bool: ...

    def recover_stale(
        self,
        *,
        stale_before: NaiveDatetime,
        idempotency_cutoff: NaiveDatetime,
        now: NaiveDatetime,
        limit: int,
    ) -> int: ...


__all__ = ["ClaimedDeliveryAttempt", "DeliveryAttemptRepository"]
