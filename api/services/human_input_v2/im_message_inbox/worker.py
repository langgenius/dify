"""Claim, consumer handoff, and fenced outcome orchestration for IM inbox work.

Consumer execution is outside repository transactions and is at-least-once.
If heartbeat coordination reports a lost lease, this worker deliberately skips
all final writes so a stale owner cannot overwrite a newer processing attempt.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum
from typing import Protocol

from core.human_input_v2.im_message_inbox import (
    ConsumerDecision,
    IMInboxConsumer,
    IMInboxDelivery,
    IMInboxRecordId,
    IMMessageInboxRepository,
    InboxClaimOrigin,
    LostLease,
)
from core.human_input_v2.shared import UtcTimestamp

from .telemetry import IMInboxMetricKind, IMInboxMetrics

logger = logging.getLogger(__name__)


class WorkerClock(Protocol):
    """Injectable UTC clock shared by claim and finalize operations."""

    def now(self) -> UtcTimestamp:
        """Return the current UTC timestamp."""


@dataclass(frozen=True, slots=True)
class InboxWorkerPolicy:
    """Bounded attempt and lease policy for one worker instance."""

    maximum_attempts: int
    lease_duration: timedelta

    def __post_init__(self) -> None:
        if self.maximum_attempts < 1:
            raise ValueError("maximum attempts must be positive")
        if self.lease_duration <= timedelta():
            raise ValueError("lease duration must be positive")


@dataclass(frozen=True, slots=True)
class HeartbeatExecution:
    """Consumer decision plus whether its fenced lease remained current."""

    decision: ConsumerDecision
    lease_held: bool


class LeaseHeartbeat(Protocol):
    """Execute consumer work while renewing its current fenced lease."""

    def execute(
        self,
        delivery: IMInboxDelivery,
        operation: Callable[[], ConsumerDecision],
    ) -> HeartbeatExecution:
        """Run work and report whether finalization remains safe."""


class InboxWorkerOutcome(StrEnum):
    """Payload-free processing result used by tasks and metrics."""

    CLAIM_MISS = "claim_miss"
    SUCCEEDED = "succeeded"
    IGNORED = "ignored"
    RETRIED = "retried"
    FAILED = "failed"
    LOST_LEASE = "lost_lease"


class IMInboxWorker:
    """Reliable handoff orchestrator independent from Celery task types."""

    _repository: IMMessageInboxRepository
    _consumer: IMInboxConsumer
    _clock: WorkerClock
    _heartbeat: LeaseHeartbeat
    _metrics: IMInboxMetrics
    _policy: InboxWorkerPolicy

    def __init__(
        self,
        *,
        repository: IMMessageInboxRepository,
        consumer: IMInboxConsumer,
        clock: WorkerClock,
        heartbeat: LeaseHeartbeat,
        metrics: IMInboxMetrics,
        policy: InboxWorkerPolicy,
    ) -> None:
        self._repository = repository
        self._consumer = consumer
        self._clock = clock
        self._heartbeat = heartbeat
        self._metrics = metrics
        self._policy = policy

    def process(self, record_id: IMInboxRecordId) -> InboxWorkerOutcome:
        """Claim one record, call its consumer, and fence the resulting write."""

        delivery = self._repository.claim_by_id(
            record_id,
            now=self._clock.now(),
            lease_duration=self._policy.lease_duration,
        )
        if delivery is None:
            return InboxWorkerOutcome.CLAIM_MISS
        if delivery.claim_origin is InboxClaimOrigin.PENDING:
            self._metrics.record(
                IMInboxMetricKind.CLAIM,
                provider=delivery.event.provider,
                outcome="first_claim" if delivery.attempt == 1 else "retry_claim",
            )
        else:
            self._metrics.record(
                IMInboxMetricKind.LEASE_RECLAIM,
                provider=delivery.event.provider,
                outcome="reclaimed",
            )

        try:
            execution = self._heartbeat.execute(delivery, lambda: self._consumer.consume(delivery))
        except Exception:
            self._log_unexpected_consumer_failure(delivery)
            return self._retry(delivery)

        if not execution.lease_held:
            self._record_lost_lease(delivery, outcome="heartbeat")
            logger.warning(
                "Lost IM inbox lease before finalize record_id=%s integration_id=%s provider=%s attempt=%d",
                delivery.record_id,
                delivery.integration_id,
                delivery.event.provider.value,
                delivery.attempt,
            )
            return InboxWorkerOutcome.LOST_LEASE

        return self._apply_decision(delivery, execution.decision)

    @staticmethod
    def _log_unexpected_consumer_failure(delivery: IMInboxDelivery) -> None:
        # Consumer exceptions may include submitted values in their message.
        # Do not attach exception text or traceback to this payload-safe log.
        logger.error(
            "Unexpected IM inbox consumer failure record_id=%s integration_id=%s provider=%s "
            "attempt=%d error_code=unexpected_consumer_error",
            delivery.record_id,
            delivery.integration_id,
            delivery.event.provider.value,
            delivery.attempt,
        )

    def _apply_decision(self, delivery: IMInboxDelivery, decision: ConsumerDecision) -> InboxWorkerOutcome:
        now = self._clock.now()
        match decision:
            case ConsumerDecision.SUCCEEDED:
                transition = self._repository.succeed(delivery.record_id, delivery.claim_token, now=now)
                outcome = InboxWorkerOutcome.SUCCEEDED
            case ConsumerDecision.IGNORED:
                transition = self._repository.ignore(delivery.record_id, delivery.claim_token, now=now)
                outcome = InboxWorkerOutcome.IGNORED
            case ConsumerDecision.FAILED:
                transition = self._repository.fail(delivery.record_id, delivery.claim_token, now=now)
                outcome = InboxWorkerOutcome.FAILED
            case ConsumerDecision.RETRY:
                return self._retry(delivery)
        if isinstance(transition, LostLease):
            self._record_lost_lease(delivery, outcome="finalize")
            return InboxWorkerOutcome.LOST_LEASE
        self._metrics.record(
            IMInboxMetricKind.TERMINAL,
            provider=delivery.event.provider,
            outcome=outcome.value,
        )
        return outcome

    def _retry(self, delivery: IMInboxDelivery) -> InboxWorkerOutcome:
        transition = self._repository.retry(
            delivery.record_id,
            delivery.claim_token,
            now=self._clock.now(),
            maximum_attempts=self._policy.maximum_attempts,
        )
        if isinstance(transition, LostLease):
            self._record_lost_lease(delivery, outcome="retry")
            return InboxWorkerOutcome.LOST_LEASE
        if delivery.attempt >= self._policy.maximum_attempts:
            self._metrics.record(
                IMInboxMetricKind.RETRY,
                provider=delivery.event.provider,
                outcome="exhausted",
            )
            self._metrics.record(
                IMInboxMetricKind.TERMINAL,
                provider=delivery.event.provider,
                outcome=InboxWorkerOutcome.FAILED.value,
            )
            return InboxWorkerOutcome.FAILED
        self._metrics.record(
            IMInboxMetricKind.RETRY,
            provider=delivery.event.provider,
            outcome="pending",
        )
        return InboxWorkerOutcome.RETRIED

    def _record_lost_lease(self, delivery: IMInboxDelivery, *, outcome: str) -> None:
        self._metrics.record(
            IMInboxMetricKind.LOST_LEASE,
            provider=delivery.event.provider,
            outcome=outcome,
        )
