# Reference production placement:
# - Identity repository: api/repositories/human_input_v2/im_identity_repository.py
# - Binding repository: api/repositories/human_input_v2/im_binding_repository.py
# - SQLAlchemy adapters: matching sqlalchemy_im_*_repository.py modules

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    TenantId,
)
from domain import (
    IMBinding,
    IMBindingAssignment,
    IMIdentity,
    IMIdentityObservation,
    IMIdentityPage,
)
from pydantic import NaiveDatetime
from repositories.human_input_v2.im_channel_repository import IMChannelId
from sqlalchemy.orm import Session


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


class SQLAlchemyIMIdentityRepository:
    """Reference constructor shape for the required Identity implementation.

    The Protocol above owns the public method signatures. The production class
    implements every method against the supplied Session and bound Channel.
    """

    def __init__(self, session: Session, channel_id: IMChannelId) -> None:
        self._session = session
        self._channel_id = channel_id


class SQLAlchemyIMBindingRepository:
    """Reference constructor shape for the required Binding implementation.

    The Protocol above owns the public method signatures. The production class
    implements every method against the supplied Session and bound Channel.
    """

    def __init__(self, session: Session, channel_id: IMChannelId) -> None:
        self._session = session
        self._channel_id = channel_id
