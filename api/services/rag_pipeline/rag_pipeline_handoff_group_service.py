from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, Protocol

from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from extensions.ext_redis import redis_client
from models.workflow_handoff import RagPipelineHandoffGroupIdentity, RagPipelineQueueKind
from repositories.rag_pipeline_handoff_group_repository import RagPipelineHandoffGroupRepository

logger = logging.getLogger(__name__)

_RELEASE_LOCK_SECONDS = 60
_RELEASE_MARKER_SECONDS = 7 * 24 * 60 * 60


class _RedisLock(Protocol):
    def acquire(self, blocking: bool = True) -> bool: ...

    def release(self) -> None: ...


class _RedisClient(Protocol):
    def get(self, name: str | bytes) -> Any: ...

    def set(
        self,
        name: str | bytes,
        value: Any,
        ex: int | None = None,
        px: int | None = None,
        nx: bool = False,
        xx: bool = False,
        keepttl: bool = False,
        get: bool = False,
        exat: int | None = None,
        pxat: int | None = None,
    ) -> Any: ...

    def lock(
        self,
        name: str,
        timeout: float | None = None,
        sleep: float = 0.1,
        blocking: bool = True,
        blocking_timeout: float | None = None,
        thread_local: bool = True,
    ) -> _RedisLock: ...


type RagPipelineBatchEnqueue = Callable[[str, str, str], None]


class RagPipelineHandoffGroupOutcome(StrEnum):
    MISSING = "missing"
    NOT_READY = "not_ready"
    LOCK_BUSY = "lock_busy"
    RELEASED = "released"
    ALREADY_RELEASED = "already_released"


@dataclass(frozen=True)
class RagPipelineHandoffGroupScanResult:
    scanned: int
    released: int
    not_ready: int
    lock_busy: int
    errors: int


class RagPipelineHandoffGroupService:
    """Release one tenant slot after every handed-off run in a sealed batch ends."""

    def __init__(
        self,
        *,
        repository: RagPipelineHandoffGroupRepository,
        regular_enqueue: RagPipelineBatchEnqueue,
        priority_enqueue: RagPipelineBatchEnqueue,
        redis: _RedisClient = redis_client,
    ) -> None:
        self._repository = repository
        self._regular_enqueue = regular_enqueue
        self._priority_enqueue = priority_enqueue
        self._redis = redis

    def seal_group(self, *, identity: RagPipelineHandoffGroupIdentity, sealed_at: datetime) -> int:
        return self._repository.seal_group(identity=identity, sealed_at=sealed_at)

    def reconcile_group(
        self, *, identity: RagPipelineHandoffGroupIdentity, now: datetime
    ) -> RagPipelineHandoffGroupOutcome:
        # Document repair is database-only and remains retryable even when the
        # tenant-slot Redis lock is contended or unavailable.
        self._repository.mark_failed_documents(identity=identity, marked_at=now)
        snapshot = self._repository.get_group(identity)
        if snapshot is None:
            return RagPipelineHandoffGroupOutcome.MISSING
        if snapshot.released_at is not None:
            return RagPipelineHandoffGroupOutcome.ALREADY_RELEASED
        if snapshot.sealed_at is None:
            return RagPipelineHandoffGroupOutcome.NOT_READY
        if snapshot.has_running_workflow_runs:
            if snapshot.tenant_isolated:
                TenantIsolatedTaskQueue(identity.tenant_id, "pipeline").set_task_waiting_time(
                    ttl=_RELEASE_MARKER_SECONDS
                )
            return RagPipelineHandoffGroupOutcome.NOT_READY

        if not snapshot.tenant_isolated:
            marked = self._repository.mark_released_once(identity=identity, released_at=now)
            return (
                RagPipelineHandoffGroupOutcome.RELEASED if marked else RagPipelineHandoffGroupOutcome.ALREADY_RELEASED
            )

        lock = self._redis.lock(
            self._release_lock_key(identity),
            timeout=_RELEASE_LOCK_SECONDS,
            blocking_timeout=0,
        )
        if not lock.acquire(blocking=False):
            return RagPipelineHandoffGroupOutcome.LOCK_BUSY
        try:
            snapshot = self._repository.get_group(identity)
            if snapshot is None:
                return RagPipelineHandoffGroupOutcome.MISSING
            if snapshot.released_at is not None:
                return RagPipelineHandoffGroupOutcome.ALREADY_RELEASED
            if snapshot.sealed_at is None or snapshot.has_running_workflow_runs:
                return RagPipelineHandoffGroupOutcome.NOT_READY

            marker_key = self._release_marker_key(identity)
            if not self._redis.get(marker_key):
                self._release_tenant_slot(identity, claim_key=self._release_claim_key(identity))
                # If the database CAS transiently fails, the next scanner pass
                # observes this marker and skips the non-transactional queue
                # side effect before retrying the durable success marker.
                self._redis.set(marker_key, "1", ex=_RELEASE_MARKER_SECONDS)

            marked = self._repository.mark_released_once(identity=identity, released_at=now)
            if marked:
                return RagPipelineHandoffGroupOutcome.RELEASED
            refreshed = self._repository.get_group(identity)
            if refreshed is not None and refreshed.released_at is not None:
                return RagPipelineHandoffGroupOutcome.ALREADY_RELEASED
            raise RuntimeError(f"Failed to persist RAG tenant-slot release marker: {identity}")
        finally:
            try:
                lock.release()
            except Exception:
                logger.warning("Failed to release RAG handoff group Redis lock", exc_info=True)

    def scan(self, *, now: datetime, limit: int) -> RagPipelineHandoffGroupScanResult:
        identities = self._repository.list_reconcilable_groups(limit=limit)
        released = 0
        not_ready = 0
        lock_busy = 0
        errors = 0
        for identity in identities:
            try:
                if self._redis.get(self.batch_heartbeat_key(identity)):
                    not_ready += 1
                    continue
                # Unsealed rows are returned only after the uploaded source
                # batch owner heartbeat expires (or normal finalization clears
                # it). This repairs both worker loss and a transient seal loss.
                self._repository.seal_group(identity=identity, sealed_at=now)
                outcome = self.reconcile_group(identity=identity, now=now)
            except Exception:
                errors += 1
                logger.exception("Failed to reconcile RAG handoff group: %s", identity)
                continue
            if outcome == RagPipelineHandoffGroupOutcome.RELEASED:
                released += 1
            elif outcome == RagPipelineHandoffGroupOutcome.NOT_READY:
                not_ready += 1
            elif outcome == RagPipelineHandoffGroupOutcome.LOCK_BUSY:
                lock_busy += 1
        return RagPipelineHandoffGroupScanResult(
            scanned=len(identities),
            released=released,
            not_ready=not_ready,
            lock_busy=lock_busy,
            errors=errors,
        )

    def _release_tenant_slot(self, identity: RagPipelineHandoffGroupIdentity, *, claim_key: str) -> None:
        queue = TenantIsolatedTaskQueue(identity.tenant_id, "pipeline")
        # The Redis claim is durable before Celery dispatch. A scanner retry
        # receives this same item instead of consuming an additional slot.
        has_next, raw_file_id = queue.claim_task_once(claim_key=claim_key, ttl=_RELEASE_MARKER_SECONDS)
        if not has_next:
            return

        enqueue = (
            self._regular_enqueue if identity.queue_kind == RagPipelineQueueKind.REGULAR else self._priority_enqueue
        )
        if isinstance(raw_file_id, dict):
            file_id = raw_file_id.get("file_id")
        else:
            file_id = raw_file_id.decode("utf-8") if isinstance(raw_file_id, bytes) else raw_file_id
        if not isinstance(file_id, str) or not file_id:
            raise ValueError(f"Invalid queued RAG pipeline source batch: {raw_file_id!r}")
        enqueue(file_id, identity.tenant_id, self._dispatch_token(identity, file_id=file_id))

    @staticmethod
    def _identity_digest(identity: RagPipelineHandoffGroupIdentity) -> str:
        value = f"{identity.source_batch_id}:{identity.tenant_id}:{identity.queue_kind.value}"
        return hashlib.sha256(value.encode()).hexdigest()

    @classmethod
    def _release_lock_key(cls, identity: RagPipelineHandoffGroupIdentity) -> str:
        # Slot ownership is tenant-wide across regular and priority lanes.
        tenant_digest = hashlib.sha256(identity.tenant_id.encode()).hexdigest()
        return f"rag_pipeline_handoff_release_lock:{tenant_digest}"

    @classmethod
    def _release_marker_key(cls, identity: RagPipelineHandoffGroupIdentity) -> str:
        return f"rag_pipeline_handoff_released:{cls._identity_digest(identity)}"

    @classmethod
    def _release_claim_key(cls, identity: RagPipelineHandoffGroupIdentity) -> str:
        return f"rag_pipeline_handoff_release_claim:{cls._identity_digest(identity)}"

    @classmethod
    def _dispatch_token(cls, identity: RagPipelineHandoffGroupIdentity, *, file_id: str) -> str:
        value = f"{cls._identity_digest(identity)}:{file_id}"
        return f"rag-pipeline-handoff:{hashlib.sha256(value.encode()).hexdigest()}"

    @classmethod
    def batch_heartbeat_key(cls, identity: RagPipelineHandoffGroupIdentity) -> str:
        return f"rag_pipeline_handoff_batch_heartbeat:{cls._identity_digest(identity)}"


__all__ = [
    "RagPipelineBatchEnqueue",
    "RagPipelineHandoffGroupOutcome",
    "RagPipelineHandoffGroupScanResult",
    "RagPipelineHandoffGroupService",
]
