"""Framework-independent contracts for Agent App console use cases."""

from dataclasses import dataclass
from typing import TypedDict

from services.entities.app_entities import AgentAppPublicationCounts, AppRecord


class AgentReferencingWorkflow(TypedDict):
    """A published workflow app that references a roster Agent."""

    app_id: str
    app_name: str
    app_icon_type: str | None
    app_icon: str | None
    app_icon_background: str | None
    app_mode: str
    app_updated_at: int | None
    workflow_id: str
    workflow_version: str
    node_ids: list[str]


class AgentAppNotFoundError(Exception):
    pass


class AgentAppAccessNotReadyError(Exception):
    """The Agent has no published snapshot suitable for API access."""


class AgentAppNameConflictError(Exception):
    """Another Agent already uses the requested name."""


@dataclass(frozen=True, slots=True)
class AgentAppListItem:
    """A detached App projection and its active roster Agent, if still present."""

    app: AppRecord
    agent_id: str | None
    backing_app_id: str | None
    role: str | None
    debug_conversation_id: str | None
    active_config_is_published: bool
    reference_count: int | None
    published_references: list[AgentReferencingWorkflow]
    permission_keys: list[str]


@dataclass(frozen=True, slots=True)
class AgentAppListPage:
    """One page and publication counts computed before the publication filter."""

    page: int
    limit: int
    total: int
    has_more: bool
    publication_counts: AgentAppPublicationCounts
    data: list[AgentAppListItem]


@dataclass(frozen=True, slots=True)
class AgentApiAccess:
    """Committed, detached access state for a tenant-owned Agent App."""

    app_id: str
    access_ready: bool
    enabled: bool
    api_rpm: int
    api_rph: int
    api_key_count: int


@dataclass(frozen=True, slots=True)
class AgentApiAccessChange:
    """The resulting access state and whether the stored setting changed."""

    access: AgentApiAccess
    changed: bool


@dataclass(frozen=True, slots=True)
class AgentAppDetail:
    """Detached Agent identity, app presentation and current editor's Build conversation."""

    app: AppRecord
    agent_id: str
    app_id: str | None
    backing_app_id: str | None
    hidden_app_backed: bool
    role: str
    access_ready: bool
    should_mask_agent_mode: bool = False
    debug_conversation_id: str | None = None
    debug_conversation_message_count: int = 0


@dataclass(frozen=True, slots=True)
class AgentAppCopy:
    """Optional identity and icon overrides for a new private Agent App."""

    name: str | None
    description: str | None
    role: str | None
    icon_type: str | None
    icon: str | None
    icon_background: str | None


@dataclass(frozen=True, slots=True)
class AgentAppCopied:
    """The committed App plus the ID of the App whose access mode it inherits."""

    app: AppRecord
    source_app_id: str
