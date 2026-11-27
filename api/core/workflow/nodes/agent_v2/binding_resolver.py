from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select

from core.agent.publish_visibility import workflow_callable_active_snapshot_filter
from core.db.session_factory import session_factory
from core.workflow.nodes.agent_v2.session_store import (
    WorkflowAgentWorkspaceStore,
    resolve_workflow_agent_workspace_owner_scope,
)
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
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
        binding_id: str | None = None,
        snapshot_id: str | None = None,
        conversation_id: str | None = None,
        workflow_run_id: str | None = None,
        node_execution_id: str | None = None,
        continue_agent_session: bool = True,
        session_generation: str = "",
        session_branch: str = "",
    ) -> WorkflowAgentBindingBundle:
        """Resolve an owned config generation within the frozen session policy.

        Pre: caller identity and policy came from the run graph or a persisted
        execution; explicit binding and snapshot must be supplied together.
        Post: Chatflow participants pin config only within their allowed
        conversation/run generation. Disabled runs never inherit a previous
        message's participant. Unavailable identities fail closed.
        """

        if (binding_id is None) != (snapshot_id is None):
            raise WorkflowAgentBindingError(
                "agent_binding_generation_invalid",
                "Workflow Agent binding and config snapshot must be pinned together.",
            )

        with session_factory.create_session() as session:
            binding_stmt = select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.tenant_id == tenant_id,
                WorkflowAgentNodeBinding.app_id == app_id,
                WorkflowAgentNodeBinding.workflow_id == workflow_id,
                WorkflowAgentNodeBinding.node_id == node_id,
            )
            if binding_id is not None:
                binding_stmt = binding_stmt.where(WorkflowAgentNodeBinding.id == binding_id)
            binding = session.scalar(binding_stmt.limit(1))
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

            # Keep the participant's config/Home generation within its allowed
            # lifetime, including sequential repeated executions in a disabled run.
            can_resolve_participant = (
                continue_agent_session or workflow_run_id is not None or node_execution_id is not None
            )
            if snapshot_id is None and conversation_id and can_resolve_participant:
                participant = WorkflowAgentWorkspaceStore.load_active_participant(
                    session=session,
                    scope=resolve_workflow_agent_workspace_owner_scope(
                        tenant_id=tenant_id,
                        app_id=app_id,
                        conversation_id=conversation_id,
                        workflow_run_id=workflow_run_id,
                        node_id=node_id,
                        workflow_agent_binding_id=binding.id,
                        node_execution_id=node_execution_id,
                        continue_agent_session=continue_agent_session,
                        session_generation=session_generation,
                        session_branch=session_branch,
                    ),
                    agent_id=agent.id,
                )
                if participant is not None:
                    if participant.agent_config_version_kind != AgentConfigVersionKind.SNAPSHOT:
                        raise WorkflowAgentBindingError(
                            "agent_binding_generation_invalid",
                            "Chatflow Agent participant must reference a config snapshot.",
                        )
                    snapshot_id = participant.agent_config_version_id

            effective_snapshot_id = (
                (
                    agent.active_config_snapshot_id
                    if binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
                    else binding.current_snapshot_id
                )
                if snapshot_id is None
                else snapshot_id
            )
            if effective_snapshot_id is None:
                raise WorkflowAgentBindingError(
                    "agent_config_snapshot_not_found",
                    "Workflow Agent binding has no current config snapshot.",
                )

            snapshot = session.scalar(
                select(AgentConfigSnapshot)
                .where(
                    AgentConfigSnapshot.tenant_id == tenant_id,
                    AgentConfigSnapshot.agent_id == agent.id,
                    AgentConfigSnapshot.id == effective_snapshot_id,
                )
                .limit(1)
            )
            if snapshot is None:
                raise WorkflowAgentBindingError(
                    "agent_config_snapshot_not_found",
                    f"Agent config snapshot {effective_snapshot_id} not found.",
                )

            session.expunge(binding)
            session.expunge(agent)
            session.expunge(snapshot)
            return WorkflowAgentBindingBundle(binding=binding, agent=agent, snapshot=snapshot)
