"""Database repository for the workspace-member read model."""

from collections.abc import Sequence
from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, AccountStatus, TenantAccountJoin
from services.workspace_member_query_service import (
    WorkspaceInvitationRecord,
    WorkspaceMemberQuery,
    WorkspaceMemberRecord,
)


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

    @override
    def list_invited_accounts(
        self, invitations: Sequence[WorkspaceInvitationRecord]
    ) -> tuple[WorkspaceMemberRecord, ...]:
        invitations_by_account = {invitation.account_id: invitation for invitation in invitations}
        if not invitations_by_account:
            return ()

        stmt = select(Account).where(
            Account.id.in_(invitations_by_account),
            Account.status.in_((AccountStatus.PENDING, AccountStatus.ACTIVE)),
        )
        with self._session_factory() as session:
            accounts = session.scalars(stmt).all()
            return tuple(
                WorkspaceMemberRecord(
                    id=str(account.id),
                    name=account.name,
                    email=account.email,
                    avatar=account.avatar,
                    last_login_at=account.last_login_at,
                    last_active_at=account.last_active_at,
                    created_at=account.created_at,
                    status=AccountStatus.PENDING.value,
                    legacy_role=invitations_by_account[str(account.id)].legacy_role,
                )
                for account in accounts
                if account.email.casefold() == invitations_by_account[str(account.id)].email.casefold()
            )
