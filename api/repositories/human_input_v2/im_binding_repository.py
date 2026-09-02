"""Owner-free values and persistence port for current IM Bindings."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pydantic import NaiveDatetime

from core.human_input_v2.shared import AccountId, ContactId, IMBindingId, IMIdentityId, TenantId


class IMBindingKind(StrEnum):
    """Persistence kind that produced one current Binding."""

    DEFAULT = "default"
    WORKSPACE_OVERRIDE = "workspace_override"


@dataclass(frozen=True, slots=True)
class IMBinding:
    """Current owner-free Contact-to-IM-identity Binding."""

    id: IMBindingId
    kind: IMBindingKind
    contact_id: ContactId
    identity_id: IMIdentityId
    created_at: NaiveDatetime
    updated_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class IMBindingAssignment:
    """Requested Contact-to-Identity assignment.

    The candidate ID is consumed only when an operation creates a row. Updating
    an existing workspace override preserves its persisted ID and creation time.
    """

    new_binding_id: IMBindingId
    contact_id: ContactId
    identity_id: IMIdentityId
    assigned_at: NaiveDatetime


class IMBindingRepositoryError(Exception):
    """Root error for expected IM Binding persistence failures."""


class IMBindingConflictError(IMBindingRepositoryError):
    """The Contact or Identity is already assigned to another endpoint."""


class IMBindingIdentityNotFoundError(IMBindingRepositoryError):
    """The requested Identity is not current in the bound Channel."""


class StaleIMBindingWriteError(IMBindingRepositoryError):
    """An exact Binding write no longer matches current state."""


class IMBindingRepository(Protocol):
    """Read and write current Bindings for one already-bound IM Channel."""

    def get(self, binding_id: IMBindingId) -> IMBinding | None:
        """Return a default Binding current in the bound Channel, if present."""
        ...

    def list_all(self) -> tuple[IMBinding, ...]:
        """Return all default Bindings in the bound Channel."""
        ...

    def create(
        self,
        assignment: IMBindingAssignment,
        *,
        bound_by_account_id: AccountId | None,
    ) -> IMBinding:
        """Create an idempotent default Binding in the bound Channel."""
        ...

    def replace(
        self,
        binding_id: IMBindingId,
        *,
        expected_identity_id: IMIdentityId,
        next_identity_id: IMIdentityId,
        bound_by_account_id: AccountId | None,
        updated_at: NaiveDatetime,
    ) -> IMBinding:
        """Replace one exact default Binding in the bound Channel."""
        ...

    def delete(
        self,
        binding_id: IMBindingId,
        *,
        expected_identity_id: IMIdentityId,
    ) -> IMBinding:
        """Delete one exact default Binding in the bound Channel."""
        ...

    def set_workspace_override(
        self,
        tenant_id: TenantId,
        assignment: IMBindingAssignment,
        *,
        bound_by_account_id: AccountId | None,
    ) -> IMBinding:
        """Create or update one target workspace override."""
        ...

    def reset_workspace_override(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> IMBinding | None:
        """Idempotently remove one target workspace override."""
        ...

    def get_effective(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> IMBinding | None:
        """Return the override-first effective Binding for one Contact."""
        ...

    def get_effective_many(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> tuple[IMBinding, ...]:
        """Return at most one override-first effective Binding per Contact."""
        ...


__all__ = [
    "IMBinding",
    "IMBindingAssignment",
    "IMBindingConflictError",
    "IMBindingIdentityNotFoundError",
    "IMBindingKind",
    "IMBindingRepository",
    "IMBindingRepositoryError",
    "StaleIMBindingWriteError",
]
