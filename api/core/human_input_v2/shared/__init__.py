"""Stable Human Input v2 values shared across domain contexts.

This package contains infrastructure-free values only. Feature-specific ownership
and lifecycle rules belong to their bounded context rather than this package.
"""

from .values import (
    AccountId,
    ContactId,
    DeploymentScope,
    DirectoryScope,
    EmailProviderId,
    IMBindingId,
    IMIdentityId,
    IMReconciliationChangeId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
    PlatformEntryId,
    TenantId,
    WorkspaceScope,
)

__all__ = [
    "AccountId",
    "ContactId",
    "DeploymentScope",
    "DirectoryScope",
    "EmailProviderId",
    "IMBindingId",
    "IMIdentityId",
    "IMReconciliationChangeId",
    "IMSyncResultId",
    "IMSyncRunId",
    "IntegrationId",
    "NormalizedEmail",
    "PlatformEntryId",
    "TenantId",
    "WorkspaceScope",
]
