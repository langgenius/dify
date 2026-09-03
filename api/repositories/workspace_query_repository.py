"""Database repository for the workspace-list read model."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant, TenantAccountJoin, TenantStatus
from services.account_login_service import ConsoleAuthWorkspaceQuery
from services.account_ports import AccountWorkspaceMembershipQuery
from services.oauth_device_application_service import DeviceWorkspaceQuery
from services.oauth_device_contracts import DeviceWorkspace
from services.workspace_query_service import WorkspaceQuery, WorkspaceRecord


class WorkspaceQueryRepository(
    WorkspaceQuery,
    AccountWorkspaceMembershipQuery,
    ConsoleAuthWorkspaceQuery,
    DeviceWorkspaceQuery,
):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def list_for_account(self, account_id: str) -> tuple[WorkspaceRecord, ...]:
        stmt = (
            select(
                Tenant.id,
                Tenant.name,
                Tenant.status,
                Tenant.created_at,
                TenantAccountJoin.last_opened_at,
            )
            .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
            .where(
                TenantAccountJoin.account_id == account_id,
                Tenant.status == TenantStatus.NORMAL,
            )
            .order_by(Tenant.created_at.asc())
        )

        with self._session_factory() as session:
            rows = session.execute(stmt).all()
            return tuple(
                WorkspaceRecord(
                    id=workspace_id,
                    name=name,
                    status=status.value,
                    created_at=created_at,
                    last_opened_at=last_opened_at,
                )
                for workspace_id, name, status, created_at, last_opened_at in rows
            )

    @override
    def list_ids_for_account(self, account_id: str) -> tuple[str, ...]:
        stmt = select(TenantAccountJoin.tenant_id).where(TenantAccountJoin.account_id == account_id)
        with self._session_factory() as session:
            return tuple(session.scalars(stmt).all())

    @override
    def list_for_device_flow(self, account_id: str) -> tuple[DeviceWorkspace, ...]:
        stmt = (
            select(
                Tenant.id,
                Tenant.name,
                TenantAccountJoin.role,
                TenantAccountJoin.current,
            )
            .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
            .where(TenantAccountJoin.account_id == account_id)
            .order_by(Tenant.created_at.asc())
        )
        with self._session_factory() as session:
            rows = session.execute(stmt).all()
            return tuple(
                DeviceWorkspace(
                    id=workspace_id,
                    name=name,
                    role=role.value,
                    current=current,
                )
                for workspace_id, name, role, current in rows
            )

    @override
    def has_active_for_account(self, account_id: str) -> bool:
        stmt = (
            select(Tenant.id)
            .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
            .where(
                TenantAccountJoin.account_id == account_id,
                Tenant.status == TenantStatus.NORMAL,
            )
            .limit(1)
        )
        with self._session_factory() as session:
            return session.scalar(stmt) is not None

    @override
    def has_active_membership(self, account_id: str) -> bool:
        return self.has_active_for_account(account_id)
