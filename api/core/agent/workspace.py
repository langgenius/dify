"""Shared owner identity and errors for Agent Workspace lifecycle operations."""

from dataclasses import dataclass

from models.agent import AgentWorkspaceOwnerType


class AgentWorkspaceError(RuntimeError):
    pass


class AgentWorkspaceNotFoundError(AgentWorkspaceError):
    pass


class AgentWorkspaceBindingGenerationMismatchError(AgentWorkspaceError):
    pass


@dataclass(frozen=True, slots=True)
class WorkspaceOwnerScope:
    tenant_id: str
    app_id: str
    owner_type: AgentWorkspaceOwnerType
    owner_id: str
    owner_scope_key: str = "root"
