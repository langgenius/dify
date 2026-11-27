"""Caller locators, detached bindings and results for Agent Sandbox file access."""

from dataclasses import dataclass
from typing import Literal

from dify_agent.layers.execution_context import DifyExecutionContextAgentConfigVersionKind
from pydantic import BaseModel


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


class WorkflowSandboxAppNotFoundError(Exception):
    pass


class AgentSandboxBindingNotFoundError(Exception):
    pass


class AgentSandboxUnavailableError(Exception):
    pass


class AgentSandboxDownloadUnavailableError(Exception):
    pass
