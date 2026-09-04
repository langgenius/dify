"""Transaction-oriented persistence ports for IM Control Plane invariants.

Implementations own CAS predicates, Integration row locks, eager loading,
revision-guarded apply, rollback, and append-only result persistence. Generic
table CRUD is intentionally absent.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pydantic import NaiveDatetime

from core.human_input_v2.entities import IMProvider, IMSyncResultType
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DirectoryScope,
    IMIdentityId,
    IMSyncRunId,
    IntegrationId,
)

from .sync_reconciliation import ReconciliationReasonCode
from .sync_records import (
    IMChannelRevision,
    IMSyncRun,
    StaleRevision,
    SynchronizedIMIdentityPage,
    SyncResultFact,
    SyncResultPage,
)


class ActiveRunDecisionKind(StrEnum):
    """Outcome of Integration-locked sync run creation."""

    # No active run existed and a new revision-bound synchronization run was committed.
    CREATED = "created"

    # An active run already exists, so the repository returns it instead of creating a duplicate.
    EXISTING_ACTIVE = "existing_active"

    # The captured Integration revision is no longer current and no new run may be created from it.
    STALE_REVISION = "stale_revision"


@dataclass(frozen=True, slots=True)
class ActiveRunDecision:
    """New or existing active run, or a stable stale-revision rejection."""

    kind: ActiveRunDecisionKind
    run: IMSyncRun | None
    stale_revision: StaleRevision | None = None


class ApplyReconciliationStatus(StrEnum):
    """Stable outcome of one idempotent revision-guarded apply."""

    # The plan was applied to current state and its append-only result facts were committed.
    APPLIED = "applied"

    # This completed run was applied earlier; persisted facts are returned for idempotent replay.
    ALREADY_APPLIED = "already_applied"

    # Integration configuration changed after capture, so the plan cannot mutate current state.
    STALE_REVISION = "stale_revision"

    LOCK_UNAVAILABLE = "lock_unavailable"
    LOCK_LOST = "lock_lost"
    PRECONDITION_FAILED = "precondition_failed"
    DIRECTORY_READ_FAILED = "directory_read_failed"
    PLAN_BLOCKED = "plan_blocked"
    UNEXPECTED_APPLY_FAILURE = "unexpected_apply_failure"


@dataclass(frozen=True, slots=True)
class ResolvedReconciliationWarning:
    warning_key: str
    reason: ReconciliationReasonCode
    identity_ids: tuple[IMIdentityId, ...]
    contact_ids: tuple[ContactId, ...]


@dataclass(frozen=True, slots=True)
class ApplyReconciliationResult:
    """Transport-neutral persisted outcome of one conditional plan apply."""

    status: ApplyReconciliationStatus
    sync_run_id: IMSyncRunId
    committed_at: NaiveDatetime | None
    result_count: int
    change_count: int
    warnings: tuple[ResolvedReconciliationWarning, ...]


class IMSyncRepository(Protocol):
    """Transport-neutral command and query persistence required by IM sync."""

    def create_or_get_active_run(
        self,
        channel_revision: IMChannelRevision,
        *,
        organization_scope: DirectoryScope,
        sync_run_id: IMSyncRunId,
        started_by_account_id: AccountId | None,
        now: NaiveDatetime,
    ) -> ActiveRunDecision:
        """Lock Integration and return at most one active run."""
        ...

    def load_sync_run(self, sync_run_id: IMSyncRunId) -> IMSyncRun | None:
        """Load one persisted run without acquiring the Organization write lock."""
        ...

    def load_latest_sync_run(self, integration_id: IntegrationId) -> IMSyncRun | None:
        """Load the latest run for one current Integration."""
        ...

    def page_sync_results(
        self,
        sync_run_id: IMSyncRunId,
        result_type: IMSyncResultType,
        *,
        page: int,
        limit: int,
    ) -> SyncResultPage:
        """Page one required product-result bucket for one exact run."""
        ...

    def search_identities(
        self,
        integration_id: IntegrationId,
        provider: IMProvider,
        *,
        keyword: str | None,
        page: int,
        limit: int,
    ) -> SynchronizedIMIdentityPage:
        """Search current identities without exposing raw payload or ORM state."""
        ...

    def append_sync_results(self, results: tuple[SyncResultFact, ...]) -> None:
        """Append diagnostic result facts without changing current state."""
        ...


__all__ = [
    "ActiveRunDecision",
    "ActiveRunDecisionKind",
    "ApplyReconciliationResult",
    "ApplyReconciliationStatus",
    "IMSyncRepository",
    "ResolvedReconciliationWarning",
]
