"""Deployment-wide quota contracts shared by account and workspace use cases."""

from dataclasses import dataclass
from typing import Protocol

from services.errors.workspace import WorkspaceInvitationQuotaError, WorkspaceMemberLicenseQuotaError


@dataclass(frozen=True, slots=True)
class DeploymentQuotaSnapshot:
    """An immutable Enterprise limit snapshot obtained before a write transaction."""

    seat_limit: int | None
    seat_usage: int
    workspace_limit: int | None
    workspace_usage: int


class DeploymentQuotaGateway(Protocol):
    def snapshot(self) -> DeploymentQuotaSnapshot: ...


@dataclass(frozen=True, slots=True)
class WorkspaceMemberQuotaSnapshot:
    """Workspace member limits fetched before opening a membership transaction."""

    plan_limit: int | None
    plan_usage: int
    license_limit: int | None
    license_usage: int

    def check(self, *, committed_usage: int, delta: int) -> None:
        """Validate a positive membership delta against conservative current usage."""
        if delta <= 0:
            return
        if self.plan_limit is not None and max(self.plan_usage, committed_usage) + delta > self.plan_limit:
            raise WorkspaceInvitationQuotaError()
        if self.license_limit is not None and max(self.license_usage, committed_usage) + delta > self.license_limit:
            raise WorkspaceMemberLicenseQuotaError()


class WorkspaceMemberQuotaGateway(Protocol):
    def snapshot(self, workspace_id: str) -> WorkspaceMemberQuotaSnapshot: ...
