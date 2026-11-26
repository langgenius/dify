"""Tenant-scoped access to the graph and its collaborative history."""

from typing import cast
from uuid import uuid4

from sqlalchemy import CursorResult, Select, and_, select, update
from sqlalchemy.orm import Session, sessionmaker, undefer

from models.account import Account, AccountStatus, TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode, AppStatus
from models.workflow import Workflow, WorkflowLoroDraft

_HISTORY_OWNER = and_(WorkflowLoroDraft.workflow_id == Workflow.id, WorkflowLoroDraft.tenant_id == Workflow.tenant_id)


def read_draft_editor(
    sessions: sessionmaker[Session], *, app_id: str, tenant_id: str, account_id: str
) -> tuple[str | None, TenantAccountRole] | None:
    """Return the maintainer and current role for an active member of an editable App.

    The short read closes before RBAC and billing perform external I/O.
    """
    with sessions() as session:
        return (
            session.execute(
                select(App.maintainer, TenantAccountJoin.role)
                .join(TenantAccountJoin, TenantAccountJoin.tenant_id == App.tenant_id)
                .join(Account, Account.id == TenantAccountJoin.account_id)
                .where(
                    App.id == app_id,
                    App.tenant_id == tenant_id,
                    App.status == AppStatus.NORMAL,
                    App.mode.in_([AppMode.WORKFLOW, AppMode.ADVANCED_CHAT]),
                    Account.id == account_id,
                    Account.status == AccountStatus.ACTIVE,
                )
            )
            .tuples()
            .one_or_none()
        )


def read_draft_epoch(draft_query: Select[tuple[Workflow]], session: Session) -> tuple[Workflow, str | None] | None:
    """Read the graph and epoch together without fetching the snapshot."""
    stmt = (
        draft_query.outerjoin(WorkflowLoroDraft, _HISTORY_OWNER)
        .add_columns(WorkflowLoroDraft.epoch)
        .execution_options(populate_existing=True)
    )
    return session.execute(stmt).tuples().first()


def read_draft_checkpoint(
    draft_query: Select[tuple[Workflow]], session: Session
) -> tuple[Workflow, WorkflowLoroDraft | None] | None:
    """Read the graph and checkpoint from a single consistent statement."""
    stmt = (
        draft_query.outerjoin(WorkflowLoroDraft, _HISTORY_OWNER)
        .add_columns(WorkflowLoroDraft)
        .options(undefer(WorkflowLoroDraft.snapshot))
        .execution_options(populate_existing=True)
    )
    return session.execute(stmt).tuples().first()


def lock_draft_checkpoint(workflow: Workflow, session: Session) -> WorkflowLoroDraft:
    """After locking the owning draft, read the checkpoint or return an unpersisted seed."""
    stmt = (
        select(WorkflowLoroDraft)
        .where(WorkflowLoroDraft.workflow_id == workflow.id, WorkflowLoroDraft.tenant_id == workflow.tenant_id)
        .options(undefer(WorkflowLoroDraft.snapshot))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return session.scalar(stmt) or WorkflowLoroDraft(
        workflow_id=workflow.id, tenant_id=workflow.tenant_id, epoch=workflow.id
    )


def rotate_draft_epoch(workflow: Workflow, session: Session, *, create: bool) -> str | None:
    """Retire history under the owning draft lock, returning the epoch for post-commit notification.

    The replacement graph and epoch share the caller's transaction. When creation
    is disabled, only drafts with existing collaboration history are affected.
    """
    epoch = str(uuid4())
    result = cast(
        CursorResult,
        session.execute(
            update(WorkflowLoroDraft)
            .where(WorkflowLoroDraft.workflow_id == workflow.id, WorkflowLoroDraft.tenant_id == workflow.tenant_id)
            .values(epoch=epoch, snapshot=None)
        ),
    )
    if result.rowcount:
        return epoch
    if create:
        session.add(WorkflowLoroDraft(workflow_id=workflow.id, tenant_id=workflow.tenant_id, epoch=epoch))
        return epoch
    return None
