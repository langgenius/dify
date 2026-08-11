"""Planning stub for IM identity and IM binding reconciliation.

This file documents the intended transport-neutral API surface. It is not
imported by production code. Every value accepted by the planner is immutable,
and the planner performs no network, database, clock, random-ID, or logging I/O.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol, TypeAlias

from core.human_input_v2.entities import (
    IMProvider,
    IMSyncRemovalReason,
    IMSyncResultType,
)
from core.human_input_v2.im_integration import IntegrationRevisionToken
from core.human_input_v2.im_provider import Directory, DirectoryEntry, ProviderUserId
from core.human_input_v2.shared import (
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncRunId,
    NormalizedEmail,
    UtcTimestamp,
)


class IMIdentityUpsertKind(StrEnum):
    """Semantic identity outcome selected by the pure planner."""

    CREATE = "create"
    UPDATE = "update"
    REFRESH = "refresh"


class ReconciliationBlockCode(StrEnum):
    """Whole-plan input or current-state invariants that prevent safe apply."""

    DUPLICATE_PROVIDER_USER_ID = "duplicate_provider_user_id"
    DUPLICATE_CURRENT_IDENTITY = "duplicate_current_identity"
    INVALID_CURRENT_BINDING = "invalid_current_binding"
    INVALID_RECONCILED_BINDING_SET = "invalid_reconciled_binding_set"


class ReconciliationReasonCode(StrEnum):
    """Stable explanations for reconciliation changes and non-matches."""

    PROVIDER_USER_ID_MATCH = "provider_user_id_match"
    NORMALIZED_EMAIL_MATCH = "normalized_email_match"
    MISSING_EMAIL = "missing_email"
    NO_CONTACT_MATCH = "no_contact_match"
    AMBIGUOUS_CONTACT_EMAIL = "ambiguous_contact_email"
    AMBIGUOUS_PROVIDER_EMAIL = "ambiguous_provider_email"
    CONTACT_ALREADY_BOUND = "contact_already_bound"
    IDENTITY_ABSENT_FROM_DIRECTORY = "identity_absent_from_directory"
    BINDING_REPLACED = "binding_replaced"


@dataclass(frozen=True, slots=True)
class ReconciliationRunRef:
    """Immutable reconciliation namespace captured when a sync run starts."""

    #: Identifies the persisted sync run that owns this plan.
    sync_run_id: IMSyncRunId
    #: Guards apply against Integration replacement or reconfiguration.
    integration_revision: IntegrationRevisionToken
    #: Selects the ProviderUserId namespace used by all input identities.
    provider: IMProvider


@dataclass(frozen=True, slots=True)
class CurrentIMIdentityState:
    """Current persisted identity facts required by plan generation."""

    #: Stable Dify identifier of the current IM identity row.
    identity_id: IMIdentityId
    #: Provider identity key matched before email fallback.
    provider_user_id: ProviderUserId
    #: Current persisted display name used to detect profile changes.
    display_name: str | None
    #: Current persisted display email used to detect profile changes.
    email: str | None
    #: Current persisted comparison email.
    normalized_email: NormalizedEmail | None
    #: Last successful run that observed this identity.
    last_seen_sync_run_id: IMSyncRunId | None


@dataclass(frozen=True, slots=True)
class ContactEmailMatchState:
    """A scope-resolved Contact available for automatic email matching."""

    #: Stable Contact identifier selected by IM binding mutations.
    contact_id: ContactId
    #: Current Contact display name retained in result and change-log snapshots.
    display_name: str
    #: Current Contact display email retained in result and change-log snapshots.
    email: str | None
    #: Email comparison key prepared by the input loader.
    normalized_email: NormalizedEmail
    #: Optional current avatar reference retained in historical result snapshots.
    avatar_file_id: str | None


@dataclass(frozen=True, slots=True)
class CurrentIMBindingState:
    """Current Contact-to-IM-identity binding represented without persistence scope."""

    #: Stable current IM binding identifier used by replace or delete operations.
    binding_id: IMBindingId
    #: Current IM identity endpoint of the binding.
    identity_id: IMIdentityId
    #: Current Contact endpoint of the binding.
    contact_id: ContactId


@dataclass(frozen=True, slots=True)
class ReconciliationInput:
    """Complete immutable input loaded before the pure planner is invoked."""

    #: Captured run and Integration namespace for the generated plan.
    run: ReconciliationRunRef
    #: Complete Provider directory entries consumed without a planning-only copy.
    directory_entries: tuple[DirectoryEntry, ...]
    #: Complete unfiltered current identity snapshot for the run's Integration namespace.
    current_identities: tuple[CurrentIMIdentityState, ...]
    #: All current IM bindings that reference the supplied identities.
    current_bindings: tuple[CurrentIMBindingState, ...]
    #: Current binding IDs this sync run may preserve, replace, or remove.
    reconciled_binding_ids: frozenset[IMBindingId]
    #: Current Contacts available for automatic email matching.
    contacts_for_email_matching: tuple[ContactEmailMatchState, ...]


@dataclass(frozen=True, slots=True)
class ExistingIMIdentityRef:
    """Reference to an IM identity that already exists in current state."""

    #: Stable persisted identity identifier.
    identity_id: IMIdentityId


@dataclass(frozen=True, slots=True)
class NewIMIdentityRef:
    """Logical reference resolved after an IM identity create operation."""

    #: Natural key used by the executor to resolve the created identity ID.
    provider_user_id: ProviderUserId


IMIdentityRef: TypeAlias = ExistingIMIdentityRef | NewIMIdentityRef


@dataclass(frozen=True, slots=True)
class IMIdentityUpsert:
    """Create, update, or last-seen refresh for one Directory entry."""

    #: Deterministic run-local key used for change-log idempotency.
    operation_key: str
    #: Semantic identity outcome decided by the planner.
    kind: IMIdentityUpsertKind
    #: Existing or logical target resolved by the executor.
    identity_ref: IMIdentityRef
    #: Directory entry supplying the desired Provider identity and display profile.
    entry: DirectoryEntry
    #: Normalized email derived by the pure planner for persistence and matching.
    normalized_email: NormalizedEmail | None
    #: Expected current snapshot; absent only for create.
    before: CurrentIMIdentityState | None
    #: Deterministically ordered profile fields changed by this operation.
    changed_fields: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CreateIMBinding:
    """Create one IM binding between an identity and a Contact."""

    #: Deterministic run-local key used for change-log idempotency.
    operation_key: str
    #: Existing or newly created identity endpoint.
    identity_ref: IMIdentityRef
    #: Contact endpoint selected by unique email matching.
    contact_id: ContactId
    #: Business reason that authorized automatic creation.
    reason: ReconciliationReasonCode


@dataclass(frozen=True, slots=True)
class ReplaceIMBinding:
    """Move one existing IM binding from an identity absent from the Directory."""

    #: Deterministic run-local key used for change-log idempotency.
    operation_key: str
    #: Exact IM binding endpoints expected before replacement.
    before: CurrentIMBindingState
    #: Identity endpoint selected after replacement.
    next_identity_ref: IMIdentityRef
    #: Business reason that authorized replacement.
    reason: ReconciliationReasonCode
    #: Product-facing reason retained for the removed endpoint.
    removal_reason: IMSyncRemovalReason


@dataclass(frozen=True, slots=True)
class DeleteIMBinding:
    """Delete one current IM binding that references an absent identity."""

    #: Deterministic run-local key used for change-log idempotency.
    operation_key: str
    #: Exact IM binding endpoints expected before deletion.
    before: CurrentIMBindingState
    #: Business reason that required deletion.
    reason: ReconciliationReasonCode
    #: Product-facing stable removal classification.
    removal_reason: IMSyncRemovalReason


IMBindingMutation: TypeAlias = CreateIMBinding | ReplaceIMBinding | DeleteIMBinding


@dataclass(frozen=True, slots=True)
class IMIdentityDeletion:
    """Delete one IM identity only after every referencing binding is removed."""

    #: Deterministic run-local key used for change-log idempotency.
    operation_key: str
    #: Complete last-known identity snapshot required by the change log.
    before: CurrentIMIdentityState
    #: Business reason that required current identity deletion.
    reason: ReconciliationReasonCode


@dataclass(frozen=True, slots=True)
class PlannedSyncResult:
    """Product-facing sync-result record decided by the pure planner."""

    #: Deterministic run-local key used for result idempotency.
    operation_key: str
    #: Added, Not Matched, Removed, or Skipped product bucket.
    result_type: IMSyncResultType
    #: Provider entry associated with this result, when available.
    provider_user_id: ProviderUserId | None
    #: Current or logical identity referenced by this result, when available.
    identity_ref: IMIdentityRef | None
    #: Existing IM binding referenced by removed or skipped results.
    binding_id: IMBindingId | None
    #: Matched Contact referenced by added, removed, or skipped results.
    contact_id: ContactId | None
    #: Stable diagnostic reason retained even when the transport omits it.
    reason_code: str | None


@dataclass(frozen=True, slots=True)
class PlannedReconciliationWarning:
    """Pure structured warning data resolved by the executor before logging."""

    #: Deterministic run-local key used to correlate duplicate warning delivery.
    warning_key: str
    #: Stable reason that identifies the tolerated input-invariant violation.
    reason: ReconciliationReasonCode
    #: IM identity references affected by this collision group, in deterministic order.
    identity_refs: tuple[IMIdentityRef, ...]
    #: Contacts in this collision group, in deterministic identifier order.
    contact_ids: tuple[ContactId, ...]


@dataclass(frozen=True, slots=True)
class ReconciliationPlan:
    """Complete deterministic reconciliation plan consumed by the executor."""

    #: Run namespace that the executor must revalidate before apply.
    run: ReconciliationRunRef
    #: Phase one creates or refreshes an IM identity for every Directory entry.
    identity_upserts: tuple[IMIdentityUpsert, ...]
    #: Phase two reconciles persisted IM bindings.
    binding_mutations: tuple[IMBindingMutation, ...]
    #: Phase three removes identities absent from the directory.
    identity_deletions: tuple[IMIdentityDeletion, ...]
    #: Product-facing result facts committed with current state.
    sync_results: tuple[PlannedSyncResult, ...]
    #: Structured operational warnings emitted without performing logging I/O.
    warnings: tuple[PlannedReconciliationWarning, ...]


@dataclass(frozen=True, slots=True)
class ReconciliationBlock:
    """One stable whole-plan blocker produced without side effects."""

    #: Stable machine-readable classification of the invalid input or state.
    code: ReconciliationBlockCode
    #: Safe run-local identity or binding key that caused the blocker.
    subject_key: str | None
    #: Operator-safe explanation that contains no credentials or Provider raw payload.
    message: str


@dataclass(frozen=True, slots=True)
class BlockedReconciliation:
    """A plan-generation result containing all deterministic input blockers."""

    #: Run namespace for which plan generation was blocked.
    run: ReconciliationRunRef
    #: Deterministically ordered complete blocker set.
    blockers: tuple[ReconciliationBlock, ...]


PlanGenerationResult: TypeAlias = ReconciliationPlan | BlockedReconciliation


class ApplyReconciliationStatus(StrEnum):
    """Stable executor outcome for one run-bound plan."""

    APPLIED = "applied"
    ALREADY_APPLIED = "already_applied"
    LOCK_UNAVAILABLE = "lock_unavailable"
    LOCK_LOST = "lock_lost"
    STALE_REVISION = "stale_revision"
    PRECONDITION_FAILED = "precondition_failed"


@dataclass(frozen=True, slots=True)
class ResolvedReconciliationWarning:
    """Warning data with persistence identifiers resolved during plan execution."""

    #: Deterministic run-local key copied from the planned warning.
    warning_key: str
    #: Stable reason that identifies the tolerated input-invariant violation.
    reason: ReconciliationReasonCode
    #: Resolved affected IM identity identifiers, in deterministic order.
    identity_ids: tuple[IMIdentityId, ...]
    #: Contact identifiers in the collision group, in deterministic order.
    contact_ids: tuple[ContactId, ...]


@dataclass(frozen=True, slots=True)
class ApplyReconciliationResult:
    """Transport-neutral result returned by the atomic executor."""

    #: Applied, replayed, lock-failed, stale, or precondition-failed outcome.
    status: ApplyReconciliationStatus
    #: Persisted sync run whose terminal state was returned.
    sync_run_id: IMSyncRunId
    #: Commit time for applied or already-applied results.
    committed_at: UtcTimestamp | None
    #: Number of persisted product-facing sync result facts.
    result_count: int
    #: Number of persisted identity and binding change-log records.
    change_count: int
    #: Resolved operational warnings that the coordinator records outside the planner.
    warnings: tuple[ResolvedReconciliationWarning, ...]


class ReconciliationPlanner(Protocol):
    """Pure deterministic plan-generation boundary."""

    def generate_plan(
        self, reconciliation_input: ReconciliationInput
    ) -> PlanGenerationResult:
        """Return a complete plan or complete blockers without performing I/O."""
        ...


class ReconciliationInputLoader(Protocol):
    """Scope-aware database input boundary owned by the apply transaction."""

    def load_input(
        self, run: ReconciliationRunRef, directory: Directory
    ) -> ReconciliationInput:
        """Load stable facts while the coordinator blocks protected writers."""
        ...


class ReconciliationPlanExecutor(Protocol):
    """Atomic current-state, change-log, result, and run-state write boundary."""

    def apply_plan(
        self, plan: ReconciliationPlan, *, now: UtcTimestamp
    ) -> ApplyReconciliationResult:
        """Apply conditional writes without explicitly locking complete row sets."""
        ...


class IMContactSyncCoordinator(Protocol):
    """Application orchestration boundary shared by workspace and EE transports."""

    def reconcile_directory(
        self, run: ReconciliationRunRef, directory: Directory
    ) -> ApplyReconciliationResult:
        """Block protected writes, load input, generate a plan, and apply it."""
        ...
