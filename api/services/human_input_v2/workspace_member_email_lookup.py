"""Read-only SQL adapter for migration-time workspace member Emails."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from types import MappingProxyType

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.human_input_v2.shared.values import NormalizedEmail
from models.account import Account, AccountStatus, TenantAccountJoin


class SQLAlchemyWorkspaceMemberEmailLookup:
    """Load one request-local Account Email snapshot within a workspace."""

    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory

    def find_member_emails(self, workspace_id: str, account_ids: Sequence[str]) -> Mapping[str, str]:
        if not account_ids:
            return MappingProxyType({})

        statement = (
            select(Account.id, Account.email)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(
                TenantAccountJoin.tenant_id == workspace_id,
                Account.id.in_(account_ids),
                Account.status == AccountStatus.ACTIVE,
            )
        )
        with self._session_factory() as session:
            with session.no_autoflush:
                rows = session.execute(statement).all()

        member_emails: dict[str, str] = {}
        for account_id, email in rows:
            try:
                member_emails[account_id] = str(NormalizedEmail(email))
            except ValueError:
                continue
        return MappingProxyType(member_emails)
