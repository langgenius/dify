"""Frozen BYOA retention orchestration; expiration never proves remote termination.

Revocation/tombstones commit before storage I/O. Cleanup retries keep working
after parent deletion. Context reservations outlive individual log bodies and
contain no credentials; only their owning lifecycle removes them.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, Protocol

from services.external_agents.observability import aware_utc

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ExternalDeletionScope:
    tenant_id: str
    kind: Literal["tenant", "app", "workflow_run", "message", "invocation", "conversation", "context_slot"]
    owner_id: str


@dataclass(frozen=True, slots=True)
class TestFileCleanup:
    lease_id: str
    tenant_id: str
    file_id: str
    temporary_copy: bool
    storage_key: str | None = None


@dataclass(frozen=True, slots=True)
class ExternalCleanupResult:
    expired_invocations: int
    reclaimed_credentials: int
    released_file_leases: int
    files_pending_retry: int
    stopped_tracking_commands: int


class ExternalRetentionStore(Protocol):
    def expire_records(self, *, now: datetime, limit: int) -> int:
        """Lock/fence expired parent-owned bodies, stop exports, preserve context markers."""
        ...

    def delete_scope(self, *, scope: ExternalDeletionScope, now: datetime) -> int:
        """Commit a tombstone and revoke matching data before any cleanup effects.

        Asset deletion is deliberately not a cascading scope. App/conversation/
        workspace/full slot lifecycle may remove minimal context markers; run or
        message deletion cannot make an existing conversation slot free.
        """
        ...

    def leave_test_page(self, *, tenant_id: str, actor_id: str, page_session_id: str, now: datetime) -> int:
        """Revoke test-only file references; submitted input leases survive to Task/TTL."""
        ...

    def file_cleanup_candidates(self, *, now: datetime, limit: int) -> tuple[TestFileCleanup, ...]:
        """Revoke expired leases first; already-revoked unfinished leases remain retryable."""
        ...

    def complete_file_cleanup(self, candidate: TestFileCleanup) -> bool:
        """Remove the exact revoked lease; False retains an unresolved write intent."""
        ...

    def reclaim_credentials(self, *, now: datetime, limit: int) -> int:
        """Clear obsolete encrypted secrets only after legitimate I/O leases drain."""
        ...

    def stop_expired_tracking(self, *, now: datetime, limit: int) -> int:
        """Stop expired/budget-exhausted background reads without releasing context Busy."""
        ...


class TemporaryTestFileRemover(Protocol):
    def remove(self, *, tenant_id: str, file_id: str, storage_key: str | None) -> None:
        """Delete only an authorized temporary copy using existing storage ownership."""
        ...


def tracking_cutoff(
    *, local_wait_ended_at: datetime, retention_expires_at: datetime | None, test_expires_at: datetime | None
) -> datetime:
    """Return fixed local-end+24h clamped by parent retention; receipts cannot renew it."""
    candidates = [aware_utc(local_wait_ended_at) + timedelta(hours=24)]
    candidates += [aware_utc(value) for value in (retention_expires_at, test_expires_at) if value is not None]
    return min(candidates)


class ExternalRetentionService:
    def __init__(self, *, store: ExternalRetentionStore, files: TemporaryTestFileRemover) -> None:
        self._store, self._files = store, files

    def delete_scope(self, scope: ExternalDeletionScope, *, now: datetime) -> int:
        """Fence a trusted parent lifecycle event; no external Agent/provider deletion occurs."""
        return self._store.delete_scope(scope=scope, now=now)

    def leave_test_page(self, *, tenant_id: str, actor_id: str, page_session_id: str, now: datetime) -> int:
        """Consume the authenticated Test API's leave event, never a panel-close event."""
        return self._store.leave_test_page(
            tenant_id=tenant_id, actor_id=actor_id, page_session_id=page_session_id, now=now
        )

    def sweep(self, *, now: datetime, limit: int = 100) -> ExternalCleanupResult:
        """Run a bounded idempotent cleanup batch, including previously failed storage deletes.

        Parent logical retention owns production data; native exporter seven-day
        spool cleanup is not used. Storage failures retain revoked leases for
        retry and cannot rematerialize files or free unresolved context slots.
        """
        expired = self._store.expire_records(now=now, limit=limit)
        stopped = self._store.stop_expired_tracking(now=now, limit=limit)
        candidates = self._store.file_cleanup_candidates(now=now, limit=limit)
        completed = 0
        for candidate in candidates:
            try:
                if candidate.temporary_copy:
                    self._files.remove(
                        tenant_id=candidate.tenant_id, file_id=candidate.file_id, storage_key=candidate.storage_key
                    )
                completed += int(self._store.complete_file_cleanup(candidate))
            except Exception:
                # Failures may include private file locations. The revoked lease
                # itself is the retry intent; never log exception payload text.
                logger.warning(
                    "Temporary test-file cleanup deferred: tenant_id=%s lease_id=%s",
                    candidate.tenant_id,
                    candidate.lease_id,
                )
        reclaimed = self._store.reclaim_credentials(now=now, limit=limit)
        return ExternalCleanupResult(expired, reclaimed, completed, len(candidates) - completed, stopped)
