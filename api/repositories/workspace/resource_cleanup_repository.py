"""Tenant-scoped Agent persistence for workspace resource cleanup.

Each method owns its session and transaction; the caller orchestrates the order.

TODO: Move these methods to Agent, Agent Workspace and Skill repositories once
those domains own sessionmaker-based persistence, then remove this module.
"""

from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.agent import Agent, AgentStatus, AgentWorkspace, AgentWorkspaceBinding, WorkflowAgentNodeBinding
from models.skill import AgentSkillBinding, AgentSkillBindingSnapshot


@dataclass(frozen=True, slots=True)
class ArchivedAgents:
    agent_ids: list[str]
    backing_app_ids: list[str]


class WorkspaceResourceCleanupRepository:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def archive_agents(self, tenant_id: str) -> ArchivedAgents:
        """Archive every tenant Agent, including archived and backing-App-less ones, for repeated cleanup."""
        with self._session_factory.begin() as session:
            agents = session.scalars(select(Agent).where(Agent.tenant_id == tenant_id)).all()
            now = naive_utc_now()
            for agent in agents:
                if agent.status != AgentStatus.ARCHIVED:
                    agent.status = AgentStatus.ARCHIVED
                    agent.archived_at = now
                    agent.updated_at = now
            return ArchivedAgents(
                agent_ids=[agent.id for agent in agents],
                backing_app_ids=sorted({agent.backing_app_id for agent in agents if agent.backing_app_id}),
            )

    def list_agent_workspace_ids(self, tenant_id: str) -> list[str]:
        with self._session_factory() as session:
            return list(session.scalars(select(AgentWorkspace.id).where(AgentWorkspace.tenant_id == tenant_id)).all())

    def list_agent_workspace_binding_ids(self, tenant_id: str) -> list[str]:
        with self._session_factory() as session:
            return list(
                session.scalars(
                    select(AgentWorkspaceBinding.id).where(AgentWorkspaceBinding.tenant_id == tenant_id)
                ).all()
            )

    def delete_agent_bindings(self, tenant_id: str) -> None:
        with self._session_factory.begin() as session:
            session.execute(delete(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.tenant_id == tenant_id))
            session.execute(delete(AgentSkillBinding).where(AgentSkillBinding.tenant_id == tenant_id))
            session.execute(delete(AgentSkillBindingSnapshot).where(AgentSkillBindingSnapshot.tenant_id == tenant_id))
