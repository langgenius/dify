"""Infrastructure-free IM synchronization and binding boundary.

This package depends on canonical Contact Directory facts and shared primitive
values. Provider clients, controllers, SQLAlchemy sessions, ORM records, and
provider transport payload types belong outside this boundary. The public API
hides sync matching and effective-binding priority behind domain decisions and
transaction-oriented ports.
"""

from importlib import import_module
from typing import TYPE_CHECKING

from .binding_commands import ContactIMBindingView, IMBindingCommandError, IMBindingCommandErrorCode
from .change_log import (
    IMBindingChangeSnapshot,
    IMIdentityChangeSnapshot,
    IMReconciliationChange,
    IMReconciliationOperation,
    IMReconciliationSnapshot,
    IMReconciliationSubjectKind,
)
from .records import IMBinding, IMIdentity, OpaqueProviderPayload

if TYPE_CHECKING:
    from .ports import (
        ActiveRunDecision,
        ActiveRunDecisionKind,
        ApplyReconciliationResult,
        ApplyReconciliationStatus,
        IMSyncRepository,
        ResolvedReconciliationWarning,
    )
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

# The legacy configuration aggregate was removed before its dependent sync
# owners migrate. Lazy exports keep adapter submodules importable without
# eagerly importing those retained owners or recreating Channel management.
_LAZY_EXPORT_MODULES = {
    "ActiveRunDecision": ".ports",
    "ActiveRunDecisionKind": ".ports",
    "ApplyReconciliationResult": ".ports",
    "ApplyReconciliationStatus": ".ports",
    "BlockedReconciliation": ".sync_reconciliation",
    "ContactEmailMatchState": ".sync_reconciliation",
    "CreateIMBinding": ".sync_reconciliation",
    "CurrentIMBindingState": ".sync_reconciliation",
    "CurrentIMIdentityState": ".sync_reconciliation",
    "DeleteIMBinding": ".sync_reconciliation",
    "ExistingIMIdentityRef": ".sync_reconciliation",
    "IMBindingMutation": ".sync_reconciliation",
    "IMIdentityDeletion": ".sync_reconciliation",
    "IMIdentityRef": ".sync_reconciliation",
    "IMIdentityUpsert": ".sync_reconciliation",
    "IMIdentityUpsertKind": ".sync_reconciliation",
    "IMSyncRepository": ".ports",
    "IMSyncRun": ".sync_records",
    "NewIMIdentityRef": ".sync_reconciliation",
    "PlanGenerationResult": ".sync_reconciliation",
    "PlannedReconciliationWarning": ".sync_reconciliation",
    "PlannedSyncResult": ".sync_reconciliation",
    "ReconciliationBlock": ".sync_reconciliation",
    "ReconciliationBlockCode": ".sync_reconciliation",
    "ReconciliationInput": ".sync_reconciliation",
    "ReconciliationPlan": ".sync_reconciliation",
    "ReconciliationReasonCode": ".sync_reconciliation",
    "ReconciliationRunRef": ".sync_reconciliation",
    "ReplaceIMBinding": ".sync_reconciliation",
    "ResolvedReconciliationWarning": ".ports",
    "SyncContactSnapshot": ".sync_records",
    "SyncIdentitySnapshot": ".sync_records",
    "SyncReconciler": ".sync_reconciliation",
    "SyncResultFact": ".sync_records",
    "SyncResultPage": ".sync_records",
    "SynchronizedIMIdentity": ".sync_records",
    "SynchronizedIMIdentityPage": ".sync_records",
}


def __getattr__(name: str) -> object:
    module_name = _LAZY_EXPORT_MODULES.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(module_name, __name__)
    return getattr(module, name)


__all__ = [
    "ActiveRunDecision",
    "ActiveRunDecisionKind",
    "ApplyReconciliationResult",
    "ApplyReconciliationStatus",
    "BlockedReconciliation",
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
