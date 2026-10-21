"""Transaction-local enforcement for deployment-wide Enterprise quotas."""

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.account import Account, Tenant
from models.model import DifySetup
from services.account_errors import SeatsLimitExceededError
from services.errors.workspace import WorkspacesLimitExceededError
from services.workspace.quota import DeploymentQuotaSnapshot


@dataclass(frozen=True, slots=True)
class DeploymentQuotaWriteGuard:
    session: Session
    snapshot: DeploymentQuotaSnapshot
    seats_delta: int
    workspaces_delta: int
    locked: bool

    def check(self) -> None:
        """Check usage after any transaction-local no-op decision."""
        if not self.locked:
            return

        if self.seats_delta > 0 and self.snapshot.seat_limit is not None:
            account_count = self.session.scalar(select(func.count()).select_from(Account)) or 0
            if max(self.snapshot.seat_usage, account_count) + self.seats_delta > self.snapshot.seat_limit:
                raise SeatsLimitExceededError("licensed seats limit exceeded")

        if self.workspaces_delta > 0 and self.snapshot.workspace_limit is not None:
            workspace_count = self.session.scalar(select(func.count()).select_from(Tenant)) or 0
            if (
                max(self.snapshot.workspace_usage, workspace_count) + self.workspaces_delta
                > self.snapshot.workspace_limit
            ):
                raise WorkspacesLimitExceededError()


def lock_deployment_quota(
    session: Session,
    snapshot: DeploymentQuotaSnapshot,
    *,
    seats_delta: int = 0,
    workspaces_delta: int = 0,
) -> DeploymentQuotaWriteGuard:
    """Acquire the global quota mutex before ordinary usage snapshots.

    Most callers use this as the transaction's first SQL. Workspace
    provisioning first locks its durable preparation row, then calls this
    before Tenant, Account, or membership reads. The locking read waits for an
    earlier quota writer to commit without establishing a MySQL repeatable-read
    snapshot. A later guard check therefore sees that commit. Setup
    bootstrapping has no marker row yet and is also serialized by its deployment
    setup lock.
    """
    seat_limited = seats_delta > 0 and snapshot.seat_limit is not None
    workspace_limited = workspaces_delta > 0 and snapshot.workspace_limit is not None
    if not seat_limited and not workspace_limited:
        return DeploymentQuotaWriteGuard(session, snapshot, seats_delta, workspaces_delta, False)

    setup = session.scalar(
        select(DifySetup)
        .order_by(DifySetup.version)
        .limit(1)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return DeploymentQuotaWriteGuard(session, snapshot, seats_delta, workspaces_delta, setup is not None)


def check_deployment_quota(
    session: Session,
    snapshot: DeploymentQuotaSnapshot,
    *,
    seats_delta: int = 0,
    workspaces_delta: int = 0,
) -> None:
    """Acquire the deployment quota mutex and immediately validate capacity."""
    lock_deployment_quota(
        session,
        snapshot,
        seats_delta=seats_delta,
        workspaces_delta=workspaces_delta,
    ).check()
