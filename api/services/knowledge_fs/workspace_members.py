"""Shared workspace membership validation for KnowledgeFS access mutations."""

from collections.abc import Sequence
from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.orm import Session

from models import TenantAccountJoin


class KnowledgeFSControlPlaneInvariantError(RuntimeError):
    """Required authorization revision state is absent or inconsistent."""


class KnowledgeFSWorkspaceMemberPort(Protocol):
    def are_active_members(self, *, session: Session, tenant_id: str, account_ids: Sequence[str]) -> bool: ...


class SQLKnowledgeFSWorkspaceMemberPort:
    def are_active_members(self, *, session: Session, tenant_id: str, account_ids: Sequence[str]) -> bool:
        unique_ids = frozenset(account_ids)
        if not unique_ids:
            return True
        found = frozenset(
            session.scalars(
                sa.select(TenantAccountJoin.account_id).where(
                    TenantAccountJoin.tenant_id == tenant_id,
                    TenantAccountJoin.account_id.in_(unique_ids),
                )
            )
        )
        return found == unique_ids


def validate_member_account_ids(*, owner_account_id: str, account_ids: Sequence[str]) -> None:
    if len(set(account_ids)) != len(account_ids) or owner_account_id in account_ids:
        raise KnowledgeFSControlPlaneInvariantError("Member bindings must be unique and exclude the owner")
