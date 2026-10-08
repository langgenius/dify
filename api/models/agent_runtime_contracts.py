"""Detached Workflow Agent runtime bindings and their caller-supplied lookup port."""

from dataclasses import dataclass
from typing import Any, Protocol

from enums.agent import WorkflowAgentBindingType
from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentStatus, WorkflowAgentNodeBinding
from models.agent_config_entities import AgentPackageMetadata, AgentSoulConfig, WorkflowNodeJobConfig


class WorkflowAgentBindingError(Exception):
    error_code: str

    def __init__(self, error_code: str, message: str) -> None:
        self.error_code = error_code
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class WorkflowAgentBindingBundle:
    binding: WorkflowAgentNodeBinding
    agent: Agent
    snapshot: AgentConfigSnapshot


class WorkflowAgentRuntimeBindings(Protocol):
    """Detached runtime binding lookup supplied by the execution's database owner."""

    def resolve(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
        binding_id: str | None = None,
        snapshot_id: str | None = None,
        conversation_id: str | None = None,
        workflow_run_id: str | None = None,
    ) -> WorkflowAgentBindingBundle: ...


@dataclass(frozen=True)
class AgentRecord:
    id: str
    tenant_id: str
    scope: AgentScope
    status: AgentStatus
    app_id: str | None
    workflow_id: str | None
    workflow_node_id: str | None
    active_config_snapshot_id: str | None
    metadata: AgentPackageMetadata


@dataclass(frozen=True)
class AgentSnapshotRecord:
    id: str
    agent_id: str
    config: AgentSoulConfig

    @property
    def config_snapshot_dict(self) -> dict[str, Any]:
        return self.config.model_dump(mode="python")


@dataclass(frozen=True)
class WorkflowBindingRecord:
    tenant_id: str
    app_id: str
    workflow_id: str
    workflow_version: str
    node_id: str
    binding_type: WorkflowAgentBindingType
    agent_id: str | None
    current_snapshot_id: str | None
    node_job_config: WorkflowNodeJobConfig
    created_by: str | None
    updated_by: str | None

    @property
    def node_job_config_dict(self) -> dict[str, Any]:
        return self.node_job_config.model_dump(mode="python")
