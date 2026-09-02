# Reference production placement:
# - Identity values: api/repositories/human_input_v2/im_identity_repository.py
# - Binding values: api/repositories/human_input_v2/im_binding_repository.py

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from pydantic import ConfigDict, JsonValue, NaiveDatetime, RootModel

from core.human_input_v2.shared import ContactId, IMBindingId, IMIdentityId, IMSyncRunId


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


class IMBindingKind(StrEnum):
    """Source of one current effective Binding."""

    DEFAULT = "default"
    WORKSPACE_OVERRIDE = "workspace_override"


@dataclass(frozen=True, slots=True)
class IMBinding:
    """Current Contact-to-IM-identity Binding."""

    id: IMBindingId
    kind: IMBindingKind
    contact_id: ContactId
    identity_id: IMIdentityId
    created_at: NaiveDatetime
    updated_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class IMBindingAssignment:
    """Requested Contact-to-Identity assignment.

    The candidate ID is consumed only when the operation creates a row.
    Updating an existing workspace override preserves its persisted ID.
    """

    new_binding_id: IMBindingId
    contact_id: ContactId
    identity_id: IMIdentityId
    assigned_at: NaiveDatetime


__all__ = [
    "IMBinding",
    "IMBindingAssignment",
    "IMBindingKind",
    "IMIdentity",
    "IMIdentityObservation",
    "IMIdentityPage",
    "OpaqueProviderPayload",
]
