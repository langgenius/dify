"""Owner-free values and persistence port for current IM Identities."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from pydantic import ConfigDict, JsonValue, NaiveDatetime, RootModel

from core.human_input_v2.shared import IMIdentityId, IMSyncRunId


class OpaqueProviderPayload(RootModel[dict[str, JsonValue]]):
    """Opaque Provider JSON retained only for persistence diagnostics."""

    model_config = ConfigDict(frozen=True, strict=True, validate_default=True)


@dataclass(frozen=True, slots=True)
class IMIdentity:
    """Current Provider user returned by a Channel-bound repository."""

    id: IMIdentityId
    provider_user_id: str
    display_name: str | None
    email: str | None
    last_seen_sync_run_id: IMSyncRunId
    last_seen_at: NaiveDatetime
    created_at: NaiveDatetime
    updated_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class IMIdentityObservation:
    """Provider facts accepted by one synchronization write."""

    provider_user_id: str
    display_name: str | None
    email: str | None
    raw_payload: OpaqueProviderPayload
    sync_run_id: IMSyncRunId
    observed_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class IMIdentityPage:
    """Immutable page returned by current Identity search."""

    items: tuple[IMIdentity, ...]
    page: int
    limit: int
    total: int


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

    def get(self, identity_id: IMIdentityId) -> IMIdentity | None:
        """Return an Identity current in the bound Channel, if present."""
        ...

    def get_by_provider_user_id(self, provider_user_id: str) -> IMIdentity | None:
        """Return the bound-Channel Identity for one Provider user ID."""
        ...

    def list_all(self) -> tuple[IMIdentity, ...]:
        """Return all current Identities in the bound Channel."""
        ...

    def search(self, *, keyword: str = "", page: int, limit: int) -> IMIdentityPage:
        """Search current bound-Channel Identities by safe profile facts."""
        ...

    def create(self, identity_id: IMIdentityId, observation: IMIdentityObservation) -> IMIdentity:
        """Create a current Identity from one Provider observation."""
        ...

    def update(self, identity_id: IMIdentityId, observation: IMIdentityObservation) -> IMIdentity:
        """Update a current bound-Channel Identity from one observation."""
        ...

    def delete(self, identity_id: IMIdentityId) -> IMIdentity:
        """Delete an unbound current Identity from the bound Channel."""
        ...


__all__ = [
    "IMIdentity",
    "IMIdentityAlreadyExistsError",
    "IMIdentityInUseError",
    "IMIdentityNotFoundError",
    "IMIdentityObservation",
    "IMIdentityPage",
    "IMIdentityRepository",
    "IMIdentityRepositoryError",
    "OpaqueProviderPayload",
]
