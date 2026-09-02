"""Channel-bound SQLAlchemy adapter stub for current IM Bindings."""

from __future__ import annotations

from collections.abc import Sequence
from typing import override

from pydantic import NaiveDatetime
from sqlalchemy.orm import Session

from core.human_input_v2.shared import AccountId, ContactId, IMBindingId, IMIdentityId, TenantId

from .im_binding_repository import IMBinding, IMBindingAssignment, IMBindingRepository
from .im_channel_repository import IMChannelId


class SQLAlchemyIMBindingRepository(IMBindingRepository):
    """Constructor-complete Binding adapter with intentionally absent SQL.

    The caller owns the supplied Session and its complete transaction, including
    commit and rollback. The caller also owns external locking, Provider I/O
    ordering, and task dispatch; this adapter must never perform those actions.
    """

    def __init__(self, session: Session, channel_id: IMChannelId) -> None:
        self._session = session
        self._channel_id = channel_id

    @override
    def get(self, binding_id: IMBindingId) -> IMBinding | None:
        raise NotImplementedError

    @override
    def list_all(self) -> tuple[IMBinding, ...]:
        raise NotImplementedError

    @override
    def create(
        self,
        assignment: IMBindingAssignment,
        *,
        bound_by_account_id: AccountId | None,
    ) -> IMBinding:
        raise NotImplementedError

    @override
    def replace(
        self,
        binding_id: IMBindingId,
        *,
        expected_identity_id: IMIdentityId,
        next_identity_id: IMIdentityId,
        bound_by_account_id: AccountId | None,
        updated_at: NaiveDatetime,
    ) -> IMBinding:
        raise NotImplementedError

    @override
    def delete(
        self,
        binding_id: IMBindingId,
        *,
        expected_identity_id: IMIdentityId,
    ) -> IMBinding:
        raise NotImplementedError

    @override
    def set_workspace_override(
        self,
        tenant_id: TenantId,
        assignment: IMBindingAssignment,
        *,
        bound_by_account_id: AccountId | None,
    ) -> IMBinding:
        raise NotImplementedError

    @override
    def reset_workspace_override(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> IMBinding | None:
        raise NotImplementedError

    @override
    def get_effective(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> IMBinding | None:
        raise NotImplementedError

    @override
    def get_effective_many(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> tuple[IMBinding, ...]:
        raise NotImplementedError


__all__ = ["SQLAlchemyIMBindingRepository"]
