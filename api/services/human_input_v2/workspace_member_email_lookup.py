"""Read-only SQL adapter for migration-time workspace member Emails."""

from __future__ import annotations

from collections.abc import Callable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.human_input_v2.shared.values import NormalizedEmail, TenantId
from core.workflow.nodes.human_input_v2.migration import MemberEmailSnapshot, ResolvedMemberEmail
from models.account import Account, AccountStatus, TenantAccountJoin


class SQLAlchemyWorkspaceMemberEmailLookup:
    """Load one request-local Account Email snapshot within a workspace."""

    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory

    def find_member_emails(self, tenant_id: TenantId, account_ids: Sequence[str]) -> MemberEmailSnapshot:
        if not account_ids:
            return MemberEmailSnapshot()

        statement = (
            select(Account.id, Account.email)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(
                TenantAccountJoin.tenant_id == tenant_id,
                Account.id.in_(account_ids),
                Account.status == AccountStatus.ACTIVE,
            )
        )
        with self._session_factory() as session:
            with session.no_autoflush:
                rows = session.execute(statement).all()

        member_emails: list[ResolvedMemberEmail] = []
        for account_id, email in rows:
            try:
                member_emails.append(
                    ResolvedMemberEmail(
                        member_id=account_id,
                        email=NormalizedEmail(email),
                    )
                )
            except ValueError:
                continue
        return MemberEmailSnapshot(tuple(member_emails))
