# Reference production placement:
# - Identity repository: api/repositories/human_input_v2/im_identity_repository.py
# - Binding repository: api/repositories/human_input_v2/im_binding_repository.py
# - SQLAlchemy adapters: matching sqlalchemy_im_*_repository.py modules

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol, override

from pydantic import NaiveDatetime
from sqlalchemy.orm import Session

from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    TenantId,
)
from repositories.human_input_v2.im_channel_repository import IMChannelId

from domain import (
    IMBinding,
    IMBindingAssignment,
    IMIdentity,
    IMIdentityObservation,
    IMIdentityPage,
)


class IMIdentityRepositoryError(Exception):
    """Root error for expected IM Identity persistence failures."""


class IMIdentityAlreadyExistsError(IMIdentityRepositoryError):
    """The Provider user already has a current Identity in the bound Channel."""


class IMIdentityNotFoundError(IMIdentityRepositoryError):
    """The requested Identity is not current in the bound Channel."""


class IMIdentityInUseError(IMIdentityRepositoryError):
    """A current Binding still references the requested Identity."""


class IMIdentityRepository(Protocol):
    """Read and write current Identities for one already-bound IM Channel."""

    def get(self, identity_id: IMIdentityId) -> IMIdentity | None: ...

    def get_by_provider_user_id(self, provider_user_id: str) -> IMIdentity | None: ...

    def list_all(self) -> tuple[IMIdentity, ...]: ...

    def search(self, *, keyword: str = "", page: int, limit: int) -> IMIdentityPage: ...

    def create(
        self, identity_id: IMIdentityId, observation: IMIdentityObservation
    ) -> IMIdentity: ...

    def update(
        self, identity_id: IMIdentityId, observation: IMIdentityObservation
    ) -> IMIdentity: ...

    def delete(self, identity_id: IMIdentityId) -> IMIdentity: ...


class IMBindingRepositoryError(Exception):
    """Root error for expected IM Binding persistence failures."""


class IMBindingConflictError(IMBindingRepositoryError):
    """The Contact or Identity is already assigned differently."""


class IMBindingIdentityNotFoundError(IMBindingRepositoryError):
    """The requested Identity is not current in the bound Channel."""


class StaleIMBindingWriteError(IMBindingRepositoryError):
    """An exact Binding write no longer matches current state."""


class IMBindingRepository(Protocol):
    """Read and write default and workspace-overridden Bindings for one Channel."""

    def get(self, binding_id: IMBindingId) -> IMBinding | None: ...

    def list_all(self) -> tuple[IMBinding, ...]: ...

    def create(
        self,
        assignment: IMBindingAssignment,
        *,
        bound_by_account_id: AccountId | None,
    ) -> IMBinding: ...

    def replace(
        self,
        binding_id: IMBindingId,
        *,
        expected_identity_id: IMIdentityId,
        next_identity_id: IMIdentityId,
        bound_by_account_id: AccountId | None,
        updated_at: NaiveDatetime,
    ) -> IMBinding: ...

    def delete(
        self,
        binding_id: IMBindingId,
        *,
        expected_identity_id: IMIdentityId,
    ) -> IMBinding: ...

    def set_workspace_override(
        self,
        tenant_id: TenantId,
        assignment: IMBindingAssignment,
        *,
        bound_by_account_id: AccountId | None,
    ) -> IMBinding: ...

    def reset_workspace_override(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> IMBinding | None: ...

    def get_effective(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> IMBinding | None: ...

    def get_effective_many(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> tuple[IMBinding, ...]: ...


class SQLAlchemyIMIdentityRepository(IMIdentityRepository):
    """Constructor-complete Identity adapter with intentionally absent SQL.

    The caller owns the supplied Session and its complete transaction, including
    commit and rollback. The caller also owns external locking, Provider I/O
    ordering, and task dispatch; this adapter must never perform those actions.
    """

    def __init__(self, session: Session, channel_id: IMChannelId) -> None:
        self._session = session
        self._channel_id = channel_id

    @override
    def get(self, identity_id: IMIdentityId) -> IMIdentity | None:
        raise NotImplementedError

    @override
    def get_by_provider_user_id(self, provider_user_id: str) -> IMIdentity | None:
        raise NotImplementedError

    @override
    def list_all(self) -> tuple[IMIdentity, ...]:
        raise NotImplementedError

    @override
    def search(self, *, keyword: str = "", page: int, limit: int) -> IMIdentityPage:
        raise NotImplementedError

    @override
    def create(
        self, identity_id: IMIdentityId, observation: IMIdentityObservation
    ) -> IMIdentity:
        raise NotImplementedError

    @override
    def update(
        self, identity_id: IMIdentityId, observation: IMIdentityObservation
    ) -> IMIdentity:
        raise NotImplementedError

    @override
    def delete(self, identity_id: IMIdentityId) -> IMIdentity:
        raise NotImplementedError


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


__all__ = [
    "IMBindingConflictError",
    "IMBindingIdentityNotFoundError",
    "IMBindingRepository",
    "IMBindingRepositoryError",
    "IMIdentityAlreadyExistsError",
    "IMIdentityInUseError",
    "IMIdentityNotFoundError",
    "IMIdentityRepository",
    "IMIdentityRepositoryError",
    "SQLAlchemyIMBindingRepository",
    "SQLAlchemyIMIdentityRepository",
    "StaleIMBindingWriteError",
]
