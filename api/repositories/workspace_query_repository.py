"""Database repository for the workspace-list read model."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant, TenantAccountJoin, TenantStatus
from services.account_ports import AccountWorkspaceMembershipQuery
from services.workspace_query_service import WorkspaceQuery, WorkspaceRecord


class WorkspaceQueryRepository(WorkspaceQuery, AccountWorkspaceMembershipQuery):
    def __init__(self, client: sessionmaker[Session]) -> None:
        self._client = client

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

        with self._client() as session:
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
        with self._client() as session:
            return tuple(session.scalars(stmt).all())
