"""Dispatch durable knowledge-task intents without holding database sessions."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from libs.datetime_utils import naive_utc_now

from .contracts import KnowledgeTaskPublisher, KnowledgeTaskStore

logger = logging.getLogger(__name__)

EXECUTION_DISPATCH_RECOVERY_SECONDS = 900


@dataclass(frozen=True)
class KnowledgeTaskDispatchResult:
    claimed: int
    dispatched: int
    deferred: int


class KnowledgeTaskOutboxDispatcher:
    def __init__(
        self,
        *,
        store: KnowledgeTaskStore,
        publisher: KnowledgeTaskPublisher,
        clock: Callable[[], datetime] = naive_utc_now,
        lease_seconds: int = 300,
        execution_recovery_seconds: int = EXECUTION_DISPATCH_RECOVERY_SECONDS,
    ) -> None:
        self._store = store
        self._publisher = publisher
        self._clock = clock
        self._lease_seconds = lease_seconds
        self._execution_recovery_seconds = execution_recovery_seconds

    def dispatch_pending(self, *, limit: int) -> KnowledgeTaskDispatchResult:
        now = self._clock()
        intents = self._store.claim_pending(
            now=now,
            lease_expired_before=now - timedelta(seconds=self._lease_seconds),
            dispatched_expired_before=now - timedelta(seconds=self._execution_recovery_seconds),
            limit=limit,
        )
        dispatched = 0
        deferred = 0
        for intent in intents:
            try:
                self._publisher.publish(intent)
            except Exception as error:
                deferred += 1
                message = str(error)[:4000]
                retry_at = self._clock() + timedelta(seconds=min(300, 2 ** min(intent.attempts, 8)))
                updated = self._store.release_for_retry(
                    intent_id=intent.id,
                    claim_id=intent.claim_id,
                    available_at=retry_at,
                    error=message,
                )
                logger.exception(
                    "Failed to publish knowledge task intent %s (%s); pending state recorded=%s",
                    intent.id,
                    intent.kind,
                    updated,
                )
                continue
            updated = self._store.mark_dispatched(
                intent_id=intent.id,
                claim_id=intent.claim_id,
                dispatched_at=self._clock(),
            )
            if updated:
                dispatched += 1
            else:
                logger.warning("Lost claim while recording dispatched knowledge task intent %s", intent.id)
        return KnowledgeTaskDispatchResult(
            claimed=len(intents),
            dispatched=dispatched,
            deferred=deferred,
        )
