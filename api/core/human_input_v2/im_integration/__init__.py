"""Infrastructure-free IM configuration, synchronization, and binding boundary.

This package depends on canonical Contact Directory facts and shared primitive
values. Provider clients, controllers, SQLAlchemy sessions, ORM records, and
provider transport payload types belong outside this boundary. The public API
hides configuration CAS, sync matching, and effective-binding priority behind
domain decisions and transaction-oriented ports.
"""

from .binding_commands import ContactIMBindingView, IMBindingCommandError, IMBindingCommandErrorCode
from .change_log import (
    IMBindingChangeSnapshot,
    IMIdentityChangeSnapshot,
    IMReconciliationChange,
    IMReconciliationOperation,
    IMReconciliationSnapshot,
    IMReconciliationSubjectKind,
)
from .management import (
    ConfirmedIMConfiguration,
    IMProviderConfigurationFailureKind,
    IMProviderConfigurationPort,
    IMProviderTestResult,
)
from .ports import (
    ActiveRunDecision,
    ActiveRunDecisionKind,
    ApplyReconciliationResult,
    ApplyReconciliationStatus,
    IMSyncRepository,
    ResolvedReconciliationWarning,
)
from .records import IMBinding, IMIdentity, OpaqueProviderPayload
from .sync_reconciliation import (
    BlockedReconciliation,
    ContactEmailMatchState,
    CreateIMBinding,
    CurrentIMBindingState,
    CurrentIMIdentityState,
    DeleteIMBinding,
    ExistingIMIdentityRef,
    IMBindingMutation,
    IMIdentityDeletion,
    IMIdentityRef,
    IMIdentityUpsert,
    IMIdentityUpsertKind,
    NewIMIdentityRef,
    PlanGenerationResult,
    PlannedReconciliationWarning,
    PlannedSyncResult,
    ReconciliationBlock,
    ReconciliationBlockCode,
    ReconciliationInput,
    ReconciliationPlan,
    ReconciliationReasonCode,
    ReconciliationRunRef,
    ReplaceIMBinding,
    SyncReconciler,
)
from .sync_records import (
    IMSyncRun,
    SyncContactSnapshot,
    SynchronizedIMIdentity,
    SynchronizedIMIdentityPage,
    SyncIdentitySnapshot,
    SyncResultFact,
    SyncResultPage,
)

__all__ = [
    "ActiveRunDecision",
    "ActiveRunDecisionKind",
    "ApplyReconciliationResult",
    "ApplyReconciliationStatus",
    "BlockedReconciliation",
    "ConfirmedIMConfiguration",
    "ContactEmailMatchState",
    "ContactIMBindingView",
    "CreateIMBinding",
    "CurrentIMBindingState",
    "CurrentIMIdentityState",
    "DeleteIMBinding",
    "ExistingIMIdentityRef",
    "IMBinding",
    "IMBindingChangeSnapshot",
    "IMBindingCommandError",
    "IMBindingCommandErrorCode",
    "IMBindingMutation",
    "IMIdentity",
    "IMIdentityChangeSnapshot",
    "IMIdentityDeletion",
    "IMIdentityRef",
    "IMIdentityUpsert",
    "IMIdentityUpsertKind",
    "IMProviderConfigurationFailureKind",
    "IMProviderConfigurationPort",
    "IMProviderTestResult",
    "IMReconciliationChange",
    "IMReconciliationOperation",
    "IMReconciliationSnapshot",
    "IMReconciliationSubjectKind",
    "IMSyncRepository",
    "IMSyncRun",
    "NewIMIdentityRef",
    "OpaqueProviderPayload",
    "PlanGenerationResult",
    "PlannedReconciliationWarning",
    "PlannedSyncResult",
    "ReconciliationBlock",
    "ReconciliationBlockCode",
    "ReconciliationInput",
    "ReconciliationPlan",
    "ReconciliationReasonCode",
    "ReconciliationRunRef",
    "ReplaceIMBinding",
    "ResolvedReconciliationWarning",
    "SyncContactSnapshot",
    "SyncIdentitySnapshot",
    "SyncReconciler",
    "SyncResultFact",
    "SyncResultPage",
    "SynchronizedIMIdentity",
    "SynchronizedIMIdentityPage",
]
