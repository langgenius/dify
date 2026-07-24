"""Infrastructure-free IM configuration, synchronization, and binding boundary.

This package depends on canonical Contact Directory facts and shared primitive
values. Provider clients, controllers, SQLAlchemy sessions, ORM records, and
provider transport payload types belong outside this boundary. The public API
hides configuration CAS, sync matching, and effective-binding priority behind
domain decisions and transaction-oriented ports.
"""

from .binding_resolution import (
    BindingResolutionKind,
    BindingResolutionResult,
    EffectiveBindingResolver,
    EffectiveIMBindingSnapshot,
)
from .integration import (
    ConfigurationTransition,
    ConfigurationTransitionKind,
    CurrentStateInvalidation,
    EncryptedCredentials,
    IMIntegration,
    IntegrationDeletion,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
    StaleRevision,
)
from .ports import (
    ActiveRunDecision,
    ActiveRunDecisionKind,
    ApplyReconciliationResult,
    ApplyReconciliationStatus,
    IMControlPlaneRepository,
)
from .records import IMBinding, IMIdentity, OpaqueProviderPayload
from .state import IMIntegrationState
from .sync_reconciliation import (
    IMSyncRun,
    MatchKind,
    ProviderDirectoryEntry,
    ReconciliationAction,
    ReconciliationPlan,
    ReconciliationSnapshot,
    SyncContactSnapshot,
    SyncIdentitySnapshot,
    SyncReconciler,
    SyncResultFact,
)

__all__ = [
    "ActiveRunDecision",
    "ActiveRunDecisionKind",
    "ApplyReconciliationResult",
    "ApplyReconciliationStatus",
    "BindingResolutionKind",
    "BindingResolutionResult",
    "ConfigurationTransition",
    "ConfigurationTransitionKind",
    "CurrentStateInvalidation",
    "EffectiveBindingResolver",
    "EffectiveIMBindingSnapshot",
    "EncryptedCredentials",
    "IMBinding",
    "IMControlPlaneRepository",
    "IMIdentity",
    "IMIntegration",
    "IMIntegrationState",
    "IMSyncRun",
    "IntegrationDeletion",
    "IntegrationRevisionToken",
    "MatchKind",
    "OpaqueProviderPayload",
    "ProviderDirectoryEntry",
    "ProviderTenantIdentity",
    "ReconciliationAction",
    "ReconciliationPlan",
    "ReconciliationSnapshot",
    "StaleRevision",
    "SyncContactSnapshot",
    "SyncIdentitySnapshot",
    "SyncReconciler",
    "SyncResultFact",
]
