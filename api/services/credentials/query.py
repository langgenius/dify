"""Consumer-owned read contracts for credential lists and their visibility policy."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from core.plugin.entities.plugin_daemon import CredentialType


@dataclass(frozen=True, slots=True)
class ModelCredentialRecord:
    id: str
    name: str


@dataclass(frozen=True, slots=True)
class DatasourceCredentialListItem:
    id: str
    name: str
    auth_type: str
    encrypted_credentials: Mapping[str, object]
    avatar_url: str | None
    is_default: bool


@dataclass(frozen=True, slots=True)
class ToolCredentialRecord:
    id: str
    name: str
    provider: str
    credential_type: CredentialType
    credentials: Mapping[str, object]
    is_default: bool
    visibility: str
    created_by: str
    partial_member_ids: tuple[str, ...]
    from_other_member: bool


@dataclass(frozen=True, slots=True)
class ToolCredentialMetadata:
    """Detached identity of an actor-visible native selection; no credential values."""

    id: str
    provider: str


@dataclass(frozen=True, slots=True)
class TriggerSubscriptionRecord:
    id: str
    name: str
    provider: str
    credential_type: CredentialType
    credentials: Mapping[str, object]
    endpoint_id: str
    parameters: Mapping[str, object]
    properties: Mapping[str, object]
    workflows_in_use: int


class CredentialQuery(Protocol):
    """Return loaded values; implementations own SQL and short read sessions.

    An absent actor is reserved for trusted internal callers. Account-scoped
    callers must supply their actor ID; administrator roles do not bypass it.
    Metadata discovery is narrower: without an actor it sees only team-shared
    credentials, never personal or partially shared credentials.
    """

    def list_visible_tool_provider_ids(self, *, workspace_id: str, actor_id: str | None) -> set[str]:
        """Return provider IDs only, without loading credential values."""
        ...

    def resolve_tool_credential_metadata(
        self,
        *,
        workspace_id: str,
        provider: str,
        legacy_provider: str | None,
        actor_id: str | None,
        credential_id: str | None,
    ) -> ToolCredentialMetadata | None:
        """Select the exact ID, or native default/oldest, then apply visibility.

        ``legacy_provider`` is the installed plugin's native short-name fallback;
        ``None`` means a hardcoded provider with exact-name selection. An absent
        credential ID selects the actual native row before actor filtering, so
        another visible credential cannot replace a hidden default. Ambiguous
        default/creation-time ties are unavailable; callers can select an exact
        authorized ID. An absent
        actor sees only team-shared metadata. ``None`` result means unavailable;
        query failures propagate and consumers must refuse uncertainty.
        """
        ...

    def list_models(
        self, *, workspace_id: str, provider: str, actor_id: str | None
    ) -> Sequence[ModelCredentialRecord]: ...

    def list_datasources(
        self, *, workspace_id: str, provider: str, plugin_id: str, actor_id: str | None
    ) -> Sequence[DatasourceCredentialListItem]: ...

    def list_tools(
        self,
        *,
        workspace_id: str,
        provider: str,
        actor_id: str | None,
        include_credential_ids: Sequence[str] = (),
    ) -> Sequence[ToolCredentialRecord]: ...

    def list_trigger_subscriptions(
        self, *, workspace_id: str, provider: str, actor_id: str | None
    ) -> Sequence[TriggerSubscriptionRecord]: ...
