"""Transaction-local enforcement for workspace membership quotas."""

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.account import Tenant, TenantAccountJoin, TenantStatus
from services.errors.workspace import WorkspaceNotFoundError
from services.workspace.quota import WorkspaceMemberQuotaSnapshot


@dataclass(frozen=True, slots=True)
class WorkspaceMembershipWriteGuard:
    """Tenant mutex and quota snapshot for one membership write transaction."""

    session: Session
    workspace: Tenant
    quota: WorkspaceMemberQuotaSnapshot

    def check_delta(self, delta: int) -> None:
        if delta <= 0:
            return
        committed_usage = (
            self.session.scalar(
                select(func.count())
                .select_from(TenantAccountJoin)
                .where(TenantAccountJoin.tenant_id == self.workspace.id)
            )
            or 0
        )
        self.quota.check(committed_usage=committed_usage, delta=delta)


def lock_workspace_membership(
    session: Session,
    *,
    workspace_id: str,
    quota: WorkspaceMemberQuotaSnapshot,
    require_active: bool = True,
) -> WorkspaceMembershipWriteGuard:
    """Acquire the Tenant mutex before any ordinary read establishes a MySQL snapshot."""
    conditions = [Tenant.id == workspace_id]
    if require_active:
        conditions.append(Tenant.status == TenantStatus.NORMAL)
    workspace = session.scalar(
        select(Tenant).where(*conditions).with_for_update().execution_options(populate_existing=True)
    )
    if workspace is None:
        raise WorkspaceNotFoundError()
    return WorkspaceMembershipWriteGuard(session=session, workspace=workspace, quota=quota)
