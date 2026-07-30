"""Transaction-oriented persistence ports for IM Control Plane invariants.

Implementations own CAS predicates, Integration row locks, eager loading,
revision-guarded apply, rollback, and append-only result persistence. Generic
table CRUD is intentionally absent.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMSyncRunId,
    IntegrationId,
    UtcTimestamp,
    WorkspaceId,
)

from .binding_resolution import BindingResolutionResult
from .integration import (
    ConfigurationTransition,
    IMIntegration,
    IntegrationDeletion,
    IntegrationRevisionToken,
    StaleRevision,
)
from .sync_reconciliation import IMSyncRun, ReconciliationPlan, ReconciliationSnapshot, SyncResultFact


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


@dataclass(frozen=True, slots=True)
class ApplyReconciliationResult:
    """Run and append-only facts returned after reconciliation apply."""

    status: ApplyReconciliationStatus
    run: IMSyncRun
    results: tuple[SyncResultFact, ...]


class IMControlPlaneRepository(Protocol):
    """Atomic persistence capabilities required by the IM domain."""

    def load_current_integration(self, workspace_id: WorkspaceId | None) -> IMIntegration | None:
        """Load the exact tenant or deployment-owned current configuration."""
        ...

    def create_integration(self, integration: IMIntegration) -> IMIntegration:
        """Create the first integration configuration for its owner scope."""
        ...

    def compare_and_swap_configuration(self, transition: ConfigurationTransition) -> IMIntegration | StaleRevision:
        """Atomically apply rotation or replacement and its invalidation plan."""
        ...

    def compare_and_swap_delete(self, deletion: IntegrationDeletion) -> None | StaleRevision:
        """Delete current configuration and current children under complete CAS."""
        ...

    def create_or_get_active_run(
        self,
        integration_revision: IntegrationRevisionToken,
        *,
        sync_run_id: IMSyncRunId,
        started_by_account_id: AccountId | None,
        now: UtcTimestamp,
    ) -> ActiveRunDecision:
        """Lock Integration and return at most one active run."""
        ...

    def load_reconciliation_snapshot(self, sync_run_id: IMSyncRunId) -> ReconciliationSnapshot:
        """Load current identities, bindings, and eligible Contact facts."""
        ...

    def apply_reconciliation(self, plan: ReconciliationPlan, *, now: UtcTimestamp) -> ApplyReconciliationResult:
        """Apply one plan using its persisted sync run capture as CAS authority."""
        ...

    def resolve_effective_binding(
        self,
        *,
        integration_id: IntegrationId,
        provider: IMProvider,
        workspace_id: WorkspaceId,
        contact_id: ContactId,
    ) -> BindingResolutionResult:
        """Load and resolve one credential-free effective binding snapshot."""
        ...

    def append_sync_results(self, results: tuple[SyncResultFact, ...]) -> None:
        """Append diagnostic result facts without changing current state."""
        ...


__all__ = [
    "ActiveRunDecision",
    "ActiveRunDecisionKind",
    "ApplyReconciliationResult",
    "ApplyReconciliationStatus",
    "IMControlPlaneRepository",
]
