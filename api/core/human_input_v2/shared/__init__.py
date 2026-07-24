"""Stable Human Input v2 values shared across domain contexts.

This package contains infrastructure-free values only. Feature-specific ownership
and lifecycle rules belong to their bounded context rather than this package.
"""

from .values import (
    AccountId,
    ContactId,
    DeploymentScope,
    DirectoryScope,
    NormalizedEmail,
    PlatformEntryId,
    UtcTimestamp,
    WorkspaceId,
    WorkspaceScope,
)

__all__ = [
    "AccountId",
    "ContactId",
    "DeploymentScope",
    "DirectoryScope",
    "NormalizedEmail",
    "PlatformEntryId",
    "UtcTimestamp",
    "WorkspaceId",
    "WorkspaceScope",
]
