"""Database repository for the workspace-member read model."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, TenantAccountJoin
from services.workspace_member_query_service import WorkspaceMemberQuery, WorkspaceMemberRecord


class WorkspaceMemberQueryRepository(WorkspaceMemberQuery):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def list_for_workspace(self, workspace_id: str) -> tuple[WorkspaceMemberRecord, ...]:
        stmt = (
            select(
                Account.id,
                Account.name,
                Account.email,
                Account.avatar,
                Account.last_login_at,
                Account.last_active_at,
                Account.created_at,
                Account.status,
                TenantAccountJoin.role,
            )
            .select_from(Account)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(TenantAccountJoin.tenant_id == workspace_id)
        )

        with self._session_factory() as session:
            rows = session.execute(stmt).all()
            records = tuple(
                WorkspaceMemberRecord(
                    id=account_id,
                    name=name,
                    email=email,
                    avatar=avatar,
                    last_login_at=last_login_at,
                    last_active_at=last_active_at,
                    created_at=created_at,
                    status=status.value,
                    legacy_role=legacy_role.value,
                )
                for (
                    account_id,
                    name,
                    email,
                    avatar,
                    last_login_at,
                    last_active_at,
                    created_at,
                    status,
                    legacy_role,
                ) in rows
            )

        return records
