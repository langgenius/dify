"""Scan detached renewal candidates and coordinate their queued reservations."""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class TriggerSubscriptionRefreshRef:
    tenant_id: str
    subscription_id: str


@dataclass(frozen=True, slots=True)
class TriggerSubscriptionRefreshJob:
    subscription: TriggerSubscriptionRefreshRef
    token: str


class TriggerSubscriptionRefreshQuery(Protocol):
    def list_due_for_refresh(
        self,
        *,
        credential_due_at: int,
        subscription_due_at: int,
        after_id: str | None,
        limit: int,
    ) -> tuple[TriggerSubscriptionRefreshRef, ...]:
        """None starts the scan; otherwise continue after the last immutable subscription ID."""
        ...


class TriggerSubscriptionRefreshReservations(Protocol):
    def reserve(
        self, *, subscriptions: Sequence[TriggerSubscriptionRefreshRef], ttl: int
    ) -> tuple[TriggerSubscriptionRefreshJob, ...]: ...

    def owns(self, job: TriggerSubscriptionRefreshJob) -> bool: ...

    def release(self, job: TriggerSubscriptionRefreshJob) -> None: ...


class TriggerSubscriptionRefreshPublisher(Protocol):
    def __call__(self, job: TriggerSubscriptionRefreshJob) -> None: ...


class TriggerSubscriptionRenewer(Protocol):
    def refresh_if_due(self, *, tenant_id: str, subscription_id: str, now: int) -> None: ...


class TriggerSubscriptionRefreshService:
    def __init__(
        self,
        *,
        subscriptions: TriggerSubscriptionRefreshQuery,
        reservations: TriggerSubscriptionRefreshReservations,
        publish: TriggerSubscriptionRefreshPublisher,
        renewal: TriggerSubscriptionRenewer,
    ) -> None:
        self._subscriptions = subscriptions
        self._reservations = reservations
        self._publish = publish
        self._renewal = renewal

    def enqueue_due(self, *, now: int, credential_threshold: int, subscription_threshold: int, batch_size: int) -> int:
        if batch_size <= 0:
            raise ValueError("Trigger subscription refresh batch size must be positive.")
        after_id = None
        enqueued = 0
        while subscriptions := self._subscriptions.list_due_for_refresh(
            credential_due_at=now + credential_threshold,
            subscription_due_at=now + subscription_threshold,
            after_id=after_id,
            limit=batch_size,
        ):
            # Renewed rows can leave the due set while the scan runs; OFFSET would skip later rows.
            after_id = subscriptions[-1].subscription_id
            jobs = self._reservations.reserve(subscriptions=subscriptions, ttl=max(300, subscription_threshold))
            for index, job in enumerate(jobs):
                try:
                    self._publish(job)
                except Exception:
                    logger.exception("Failed to publish trigger renewal: %s", job.subscription)
                    # Keep already published reservations; failed and unsent jobs can retry next tick.
                    for unpublished in jobs[index:]:
                        self._release(unpublished)
                    raise
                else:
                    enqueued += 1
        logger.info("Trigger refresh scan done: enqueued=%d", enqueued)
        return enqueued

    def execute(self, *, job: TriggerSubscriptionRefreshJob, now: int) -> None:
        if not self._reservations.owns(job):
            logger.debug("Refresh reservation missing or replaced: %s", job.subscription)
            return
        try:
            self._renewal.refresh_if_due(
                tenant_id=job.subscription.tenant_id, subscription_id=job.subscription.subscription_id, now=now
            )
        finally:
            self._release(job)

    def _release(self, job: TriggerSubscriptionRefreshJob) -> None:
        try:
            self._reservations.release(job)
        except Exception:
            logger.warning("Failed to release trigger refresh reservation: %s", job.subscription, exc_info=True)
