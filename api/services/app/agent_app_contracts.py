"""Framework-independent contracts for Agent App console use cases."""

from dataclasses import dataclass
from typing import Literal, TypedDict

from dify_agent.layers.execution_context import DifyExecutionContextAgentConfigVersionKind
from pydantic import BaseModel

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


@dataclass(frozen=True, slots=True)
class AgentSandboxCaller:
    agent_id: str
    caller_type: Literal["conversation", "build_draft"]
    caller_id: str


@dataclass(frozen=True, slots=True)
class WorkflowSandboxCaller:
    app_id: str
    workflow_run_id: str
    node_id: str
    node_execution_id: str


type SandboxCaller = AgentSandboxCaller | WorkflowSandboxCaller


@dataclass(frozen=True, slots=True)
class AgentSandboxBinding:
    """Detached binding values safe to use after the repository closes its session."""

    app_id: str
    backend_binding_ref: str
    agent_id: str
    agent_config_version_id: str
    agent_config_version_kind: DifyExecutionContextAgentConfigVersionKind


class AgentSandboxInfo(BaseModel):
    workspace_cwd: str


class AgentSandboxDownload(BaseModel):
    url: str


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


class WorkflowSandboxAppNotFoundError(Exception):
    pass


class AgentSandboxBindingNotFoundError(Exception):
    pass


class AgentSandboxUnavailableError(Exception):
    pass


class AgentSandboxDownloadUnavailableError(Exception):
    pass
