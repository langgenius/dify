"""Background renewable lease coordination around synchronous consumer work."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import timedelta
from threading import Event, Thread

from core.human_input_v2.im_message_inbox import (
    ConsumerDecision,
    IMInboxDelivery,
    IMMessageInboxRepository,
    InboxPersistenceError,
    LostLease,
)

from .worker import HeartbeatExecution, WorkerClock

logger = logging.getLogger(__name__)


class RenewableLeaseHeartbeat:
    """Renew a lease periodically without extending repository transactions."""

    _repository: IMMessageInboxRepository
    _clock: WorkerClock
    _heartbeat_interval: timedelta
    _lease_duration: timedelta

    def __init__(
        self,
        *,
        repository: IMMessageInboxRepository,
        clock: WorkerClock,
        heartbeat_interval: timedelta,
        lease_duration: timedelta,
    ) -> None:
        if heartbeat_interval <= timedelta():
            raise ValueError("heartbeat interval must be positive")
        if heartbeat_interval >= lease_duration:
            raise ValueError("heartbeat interval must be shorter than lease duration")
        self._repository = repository
        self._clock = clock
        self._heartbeat_interval = heartbeat_interval
        self._lease_duration = lease_duration

    def execute(
        self,
        delivery: IMInboxDelivery,
        operation: Callable[[], ConsumerDecision],
    ) -> HeartbeatExecution:
        """Run consumer work while a daemon thread renews its fenced lease."""

        stop = Event()
        lost_lease = Event()

        def renew_until_stopped() -> None:
            while not stop.wait(self._heartbeat_interval.total_seconds()):
                try:
                    result = self._repository.renew(
                        delivery.record_id,
                        delivery.claim_token,
                        now=self._clock.now(),
                        lease_duration=self._lease_duration,
                    )
                except InboxPersistenceError:
                    lost_lease.set()
                    logger.warning(
                        "IM inbox lease heartbeat failed record_id=%s integration_id=%s provider=%s attempt=%d "
                        "error_code=heartbeat_persistence_failure",
                        delivery.record_id,
                        delivery.integration_id,
                        delivery.event.provider.value,
                        delivery.attempt,
                    )
                    return
                if isinstance(result, LostLease):
                    lost_lease.set()
                    return

        thread = Thread(
            target=renew_until_stopped,
            name=f"im-inbox-heartbeat-{delivery.record_id}",
            daemon=True,
        )
        thread.start()
        try:
            decision = operation()
        finally:
            stop.set()
            thread.join()
        return HeartbeatExecution(decision=decision, lease_held=not lost_lease.is_set())
