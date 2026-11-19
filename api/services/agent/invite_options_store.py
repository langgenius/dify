"""Detached Agent directory records and persistence contract."""

from dataclasses import dataclass
from typing import Protocol

from machinery.context import RequestContext


@dataclass(frozen=True, slots=True)
class AgentInviteSnapshot:
    id: str
    agent_id: str | None
    version: int
    display_version: int | None
    snapshot_version: int | None
    summary: str | None
    version_note: str | None
    created_by: str | None
    created_at: int | None


@dataclass(frozen=True, slots=True)
class AgentInviteReference:
    app_id: str
    app_name: str
    app_icon_type: str | None
    app_icon: str | None
    app_icon_background: str | None
    app_mode: str
    app_updated_at: int | None
    workflow_id: str
    workflow_version: str
    node_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AgentInviteOption:
    id: str
    name: str
    description: str
    role: str
    icon_type: str | None
    icon: str | None
    icon_background: str | None
    agent_kind: str
    scope: str
    source: str
    app_id: str | None
    backing_app_id: str | None
    hidden_app_backed: bool
    workflow_id: str | None
    workflow_node_id: str | None
    active_config_snapshot_id: str | None
    active_config_snapshot: AgentInviteSnapshot | None
    active_config_is_published: bool
    status: str
    created_by: str | None
    updated_by: str | None
    archived_by: str | None
    archived_at: int | None
    created_at: int | None
    updated_at: int | None
    reference_count: int | None
    published_reference_count: int
    published_node_reference_count: int
    published_references: tuple[AgentInviteReference, ...]
    is_in_current_workflow: bool
    in_current_workflow_count: int
    existing_node_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AgentInviteOptionsPage:
    data: tuple[AgentInviteOption, ...]
    page: int
    limit: int
    total: int
    has_more: bool


class AgentInviteOptionsStore(Protocol):
    """Query callable Agents within the admitted tenant and visibility scope."""

    def list_invite_options(
        self,
        context: RequestContext,
        *,
        page: int,
        limit: int,
        keyword: str | None,
        app_id: str | None,
        accessible_agent_ids: set[str] | None,
    ) -> AgentInviteOptionsPage:
        """Return a validated, detached page after the read session closes."""
        ...
