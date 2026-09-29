"""Framework-independent contracts for Agent App console use cases."""

from dataclasses import dataclass
from typing import Literal, TypedDict

from dify_agent.layers.execution_context import DifyExecutionContextAgentConfigVersionKind
from pydantic import BaseModel


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


class WorkflowSandboxAppNotFoundError(Exception):
    pass


class AgentSandboxBindingNotFoundError(Exception):
    pass


class AgentSandboxUnavailableError(Exception):
    pass


class AgentSandboxDownloadUnavailableError(Exception):
    pass
