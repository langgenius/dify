from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select

from core.agent.publish_visibility import workflow_callable_active_snapshot_filter
from core.db.session_factory import session_factory
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentScope,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)


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


class WorkflowAgentBindingResolver:
    """Resolve an owned binding without allowing unpublished roster snapshots to run."""

    def resolve(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
    ) -> WorkflowAgentBindingBundle:
        with session_factory.create_session() as session:
            binding = session.scalar(
                select(WorkflowAgentNodeBinding)
                .where(
                    WorkflowAgentNodeBinding.tenant_id == tenant_id,
                    WorkflowAgentNodeBinding.app_id == app_id,
                    WorkflowAgentNodeBinding.workflow_id == workflow_id,
                    WorkflowAgentNodeBinding.node_id == node_id,
                )
                .limit(1)
            )
            if binding is None:
                raise WorkflowAgentBindingError(
                    "agent_binding_not_found",
                    f"Workflow Agent binding not found for node {node_id}.",
                )
            if binding.agent_id is None:
                raise WorkflowAgentBindingError("agent_not_available", "Workflow Agent binding has no agent.")

            agent_stmt = select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.id == binding.agent_id,
            )
            if binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT:
                agent_stmt = agent_stmt.where(
                    Agent.scope == AgentScope.ROSTER,
                    workflow_callable_active_snapshot_filter(),
                )
            agent = session.scalar(agent_stmt.limit(1))
            if agent is None or agent.status == AgentStatus.ARCHIVED:
                raise WorkflowAgentBindingError(
                    "agent_not_available",
                    f"Agent {binding.agent_id} is not available or has not been published.",
                )

            snapshot_id = (
                agent.active_config_snapshot_id
                if binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
                else binding.current_snapshot_id
            )
            if snapshot_id is None:
                raise WorkflowAgentBindingError(
                    "agent_config_snapshot_not_found",
                    "Workflow Agent binding has no current config snapshot.",
                )

            snapshot = session.scalar(
                select(AgentConfigSnapshot)
                .where(
                    AgentConfigSnapshot.tenant_id == tenant_id,
                    AgentConfigSnapshot.agent_id == agent.id,
                    AgentConfigSnapshot.id == snapshot_id,
                )
                .limit(1)
            )
            if snapshot is None:
                raise WorkflowAgentBindingError(
                    "agent_config_snapshot_not_found",
                    f"Agent config snapshot {snapshot_id} not found.",
                )

            session.expunge(binding)
            session.expunge(agent)
            session.expunge(snapshot)
            return WorkflowAgentBindingBundle(binding=binding, agent=agent, snapshot=snapshot)
