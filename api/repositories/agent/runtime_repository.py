"""Detached Agent runtime reads and execution-owned configuration references."""

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.agent.publish_visibility import workflow_callable_active_snapshot_filter
from enums.agent import WorkflowAgentBindingType
from graphon.enums import WorkflowExecutionStatus
from models.agent import (
    WORKFLOW_EXECUTION_BINDING_VERSION,
    Agent,
    AgentConfigVersionKind,
    AgentScope,
    AgentStatus,
    WorkflowAgentNodeBinding,
)
from models.agent_runtime_contracts import WorkflowAgentBindingBundle, WorkflowAgentBindingError
from models.workflow import WorkflowRun
from repositories.agent.config_repository import AgentConfigRepository


def execution_binding_join():
    return (
        (WorkflowAgentNodeBinding.workflow_version == WORKFLOW_EXECUTION_BINDING_VERSION)
        & (WorkflowAgentNodeBinding.tenant_id == WorkflowRun.tenant_id)
        & (WorkflowAgentNodeBinding.app_id == WorkflowRun.app_id)
        & (WorkflowAgentNodeBinding.workflow_id == WorkflowRun.id)
    )


def find_owned_workflow_binding(
    session: Session, *, tenant_id: str, app_id: str, workflow_id: str, node_id: str, binding_id: str | None = None
) -> WorkflowAgentNodeBinding | None:
    query = select(WorkflowAgentNodeBinding).where(
        WorkflowAgentNodeBinding.tenant_id == tenant_id,
        WorkflowAgentNodeBinding.app_id == app_id,
        WorkflowAgentNodeBinding.workflow_id == workflow_id,
        WorkflowAgentNodeBinding.node_id == node_id,
        WorkflowAgentNodeBinding.workflow_version != WORKFLOW_EXECUTION_BINDING_VERSION,
    )
    if binding_id is not None:
        query = query.where(WorkflowAgentNodeBinding.id == binding_id)
    return session.scalar(query.limit(1))


class WorkflowAgentExecutionRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def finished_agent_ids(self, *, tenant_id: str, app_id: str, workflow_id: str, execution_id: str) -> set[str]:
        """Read retryable cleanup candidates only after the execution has ended."""
        with self._sessions() as session:
            return {
                agent_id
                for agent_id in session.scalars(
                    select(WorkflowAgentNodeBinding.agent_id)
                    .join(WorkflowRun, execution_binding_join())
                    .where(
                        WorkflowRun.id == execution_id,
                        WorkflowAgentNodeBinding.agent_id.is_not(None),
                        WorkflowRun.tenant_id == tenant_id,
                        WorkflowRun.app_id == app_id,
                        WorkflowRun.workflow_id == workflow_id,
                        WorkflowRun.status.not_in((WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.PAUSED)),
                    )
                )
                if agent_id is not None
            }

    @staticmethod
    def retained_execution_agent_ids(session: Session, tenant_id: str, agent_ids: list[str]) -> set[str]:
        if not agent_ids:
            return set()
        return {
            agent_id
            for agent_id in session.scalars(
                select(WorkflowAgentNodeBinding.agent_id)
                .join(WorkflowRun, execution_binding_join())
                .where(
                    WorkflowAgentNodeBinding.tenant_id == tenant_id,
                    WorkflowAgentNodeBinding.agent_id.in_(agent_ids),
                    WorkflowRun.status.in_((WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.PAUSED)),
                )
                .distinct()
            )
            if agent_id is not None
        }


class WorkflowAgentBindingResolver:
    """Resolve an owned binding without allowing unpublished roster snapshots to run."""

    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

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
    ) -> WorkflowAgentBindingBundle:
        """Resolve the generation pinned by an execution or a Chatflow conversation participant."""

        if (binding_id is None) != (snapshot_id is None):
            raise WorkflowAgentBindingError(
                "agent_binding_generation_invalid",
                "Workflow Agent binding and config snapshot must be pinned together.",
            )

        with self._sessions() as session:
            pinned_binding = None
            if workflow_run_id is not None:
                run = session.scalar(
                    select(WorkflowRun).where(
                        WorkflowRun.id == workflow_run_id,
                        WorkflowRun.tenant_id == tenant_id,
                        WorkflowRun.app_id == app_id,
                        WorkflowRun.workflow_id == workflow_id,
                    )
                )
                snapshot_data = run.graph_dict.get("_agent_bindings", {}) if run is not None else {}
                if snapshot_data.get("execution_id") == workflow_run_id:
                    data = snapshot_data.get("bindings", {}).get(node_id)
                    if data is None or (data["tenant_id"], data["app_id"], data["workflow_id"], data["node_id"]) != (
                        tenant_id,
                        app_id,
                        workflow_id,
                        node_id,
                    ):
                        raise WorkflowAgentBindingError("agent_binding_not_found", "Pinned Agent binding is missing.")
                    pinned_binding = WorkflowAgentNodeBinding(**data)
                    if binding_id is not None and (binding_id, snapshot_id) != (
                        pinned_binding.id,
                        pinned_binding.current_snapshot_id,
                    ):
                        raise WorkflowAgentBindingError(
                            "agent_binding_generation_invalid", "Pinned Agent generation differs."
                        )
                    snapshot_id = pinned_binding.current_snapshot_id
            binding = pinned_binding or find_owned_workflow_binding(
                session,
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                node_id=node_id,
                binding_id=binding_id,
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

            # A new node execution in the same conversation must keep its participant's
            # config/Home generation even after the roster Agent publishes a new version.
            if snapshot_id is None and conversation_id:
                from core.workflow.nodes.agent_v2.session_store import (
                    WorkflowAgentWorkspaceStore,
                    resolve_workflow_agent_workspace_owner_scope,
                )

                participant = WorkflowAgentWorkspaceStore.load_active_participant(
                    session=session,
                    scope=resolve_workflow_agent_workspace_owner_scope(
                        tenant_id=tenant_id,
                        app_id=app_id,
                        conversation_id=conversation_id,
                        workflow_run_id=None,
                        node_id=node_id,
                        workflow_agent_binding_id=binding.id,
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

            snapshot = AgentConfigRepository.get_snapshot(
                session=session, tenant_id=tenant_id, agent_id=agent.id, version_id=effective_snapshot_id
            )
            if snapshot is None:
                raise WorkflowAgentBindingError(
                    "agent_config_snapshot_not_found",
                    f"Agent config snapshot {effective_snapshot_id} not found.",
                )

            if pinned_binding is None:
                session.expunge(binding)
            session.expunge(agent)
            session.expunge(snapshot)
            return WorkflowAgentBindingBundle(binding=binding, agent=agent, snapshot=snapshot)
