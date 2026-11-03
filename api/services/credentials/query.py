"""Consumer-owned credential snapshots, lists, and visibility contracts."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from core.plugin.entities.plugin_daemon import CredentialType

if TYPE_CHECKING:
    from services.workflow_ref_service import WorkflowRef


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
class WorkflowToolCredentialMetadata(ToolCredentialMetadata):
    """An explicit stored node binding, rechecked before credential reads and refresh.

    The repository verifies the exact node, provider, action and credential.
    Native reads and refreshes recheck this binding; defaults cannot be borrowed.
    """

    workflow_ref: WorkflowRef
    node_id: str
    action: str


@dataclass(frozen=True, slots=True)
class ToolCredentialSnapshot:
    """Stored credentials for a tenant- and provider-scoped invocation."""

    id: str
    credential_type: str
    credentials: Mapping[str, object]


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

    def resolve_workflow_tool_credential_metadata(
        self,
        *,
        workflow_ref: WorkflowRef,
        node_id: str,
        provider: str,
        action: str,
        credential_id: str,
    ) -> WorkflowToolCredentialMetadata | None:
        """Resolve only an explicit plugin credential bound to the saved draft node.

        Verify the complete tenant/app/workflow/node/provider/action/credential
        chain in one short read. Return metadata and the saved node identity for
        a conditional native read/refresh, never values or a workspace default.
        Missing, foreign or mismatched bindings return None; SQL errors propagate.
        """
        ...

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
