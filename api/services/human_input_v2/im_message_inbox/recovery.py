"""Bounded recovery dispatch from the database canonical inbox backlog."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass

from core.human_input_v2.im_message_inbox import IMMessageInboxRepository, InboxProcessingStatus
from core.human_input_v2.shared import UtcTimestamp

from .sink import InboxWakeup, InboxWakeupError
from .telemetry import IMInboxMetricKind, IMInboxMetrics

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RecoveryDispatchResult:
    """Payload-free bounded recovery scan result."""

    discovered: int
    dispatched: int


class IMInboxRecovery:
    """Rediscover database work and publish record-ID-only wakeups."""

    _repository: IMMessageInboxRepository
    _wakeup: InboxWakeup
    _clock: Callable[[], UtcTimestamp]
    _batch_size: int
    _metrics: IMInboxMetrics

    def __init__(
        self,
        *,
        repository: IMMessageInboxRepository,
        wakeup: InboxWakeup,
        clock: Callable[[], UtcTimestamp],
        batch_size: int,
        metrics: IMInboxMetrics,
    ) -> None:
        if batch_size < 1:
            raise ValueError("recovery batch size must be positive")
        self._repository = repository
        self._wakeup = wakeup
        self._clock = clock
        self._batch_size = batch_size
        self._metrics = metrics

    def dispatch_available(self) -> RecoveryDispatchResult:
        """Publish at most one payload-free wakeup per discovered record."""

        now = self._clock()
        backlog = self._repository.backlog(now=now)
        oldest_pending_age_seconds = (
            backlog.oldest_pending_age.total_seconds() if backlog.oldest_pending_age is not None else None
        )
        for status in InboxProcessingStatus:
            self._metrics.record_backlog(
                status=status.value,
                count=backlog.count(status),
                oldest_age_seconds=(oldest_pending_age_seconds if status is InboxProcessingStatus.PENDING else None),
            )

        record_ids = self._repository.recoverable_record_ids(now=now, limit=self._batch_size)
        dispatched = 0
        for record_id in record_ids:
            try:
                self._wakeup.publish(record_id)
            except InboxWakeupError:
                self._metrics.record(
                    IMInboxMetricKind.DISPATCH_FAILURE,
                    provider=None,
                    outcome="broker_unavailable",
                )
                logger.warning(
                    "Failed IM inbox recovery wakeup record_id=%s error_code=broker_unavailable",
                    record_id,
                )
                continue
            dispatched += 1
        return RecoveryDispatchResult(discovered=len(record_ids), dispatched=dispatched)
