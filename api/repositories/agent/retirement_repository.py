"""Persist Agent retirement in one transaction and return post-commit cleanup work."""

from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.agent import (
    Agent,
    AgentScope,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    WorkflowAgentNodeBinding,
)
from models.model import App, AppMode
from models.workflow import Workflow
from repositories.agent.home_snapshot_repository import AgentHomeSnapshotRepository
from repositories.agent.runtime_repository import WorkflowAgentExecutionRepository
from repositories.agent_workspace_repository import AgentWorkspaceRepository


@dataclass(frozen=True)
class AgentRetirement:
    agent_ids: list[str]
    app_ids: list[str]
    workspace_ids: list[str]
    binding_ids: list[str]
    home_snapshot_ids: list[str]


class WorkflowAgentRetirementRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def retire(self, *, tenant_id: str, agent_ids: Iterable[str], account_id: str | None) -> AgentRetirement:
        candidates = tuple(sorted({agent_id for agent_id in agent_ids if agent_id}))
        if not candidates:
            return AgentRetirement([], [], [], [], [])
        backing_app_ids: list[str] = []
        retired_bindings: list[str] = []
        retired_workspaces: list[str] = []
        retired_snapshots: list[str] = []
        with self._sessions.begin() as session:
            retired_agent_ids = self.archive_unowned(
                session=session,
                tenant_id=tenant_id,
                agent_ids=candidates,
                account_id=account_id,
            )
            retired_agents = session.scalars(
                select(Agent).where(
                    Agent.tenant_id == tenant_id,
                    Agent.id.in_(retired_agent_ids),
                )
            ).all()
            backing_app_ids = sorted({agent.backing_app_id for agent in retired_agents if agent.backing_app_id})
            for app_id in backing_app_ids:
                AgentWorkspaceRepository(session=session).retire_all_for_app(
                    tenant_id=tenant_id,
                    app_id=app_id,
                )
                retired_workspaces.extend(
                    session.scalars(
                        select(AgentWorkspace.id).where(
                            AgentWorkspace.tenant_id == tenant_id,
                            AgentWorkspace.app_id == app_id,
                            AgentWorkspace.status == AgentWorkingResourceStatus.RETIRED,
                        )
                    ).all()
                )
            for agent_id in retired_agent_ids:
                bindings = session.scalars(
                    select(AgentWorkspaceBinding).where(
                        AgentWorkspaceBinding.tenant_id == tenant_id,
                        AgentWorkspaceBinding.agent_id == agent_id,
                    )
                ).all()
                for binding in bindings:
                    if binding.status == AgentWorkingResourceStatus.ACTIVE:
                        AgentWorkspaceRepository(session=session).retire_binding(
                            tenant_id=tenant_id,
                            binding_id=binding.id,
                        )
                    retired_bindings.append(binding.id)
                retired_snapshots.extend(
                    AgentHomeSnapshotRepository(session).retire_all_for_agent(
                        tenant_id=tenant_id,
                        agent_id=agent_id,
                    )
                )
            if backing_app_ids:
                session.execute(
                    delete(App).where(
                        App.tenant_id == tenant_id,
                        App.id.in_(backing_app_ids),
                        App.mode == AppMode.AGENT,
                    )
                )
        return AgentRetirement(
            retired_agent_ids, backing_app_ids, retired_workspaces, retired_bindings, retired_snapshots
        )

    @classmethod
    def archive_unowned(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent_ids: Iterable[str],
        account_id: str | None,
    ) -> list[str]:
        """Archive active orphans and return complete aggregate purge candidates."""
        candidates = tuple(sorted({agent_id for agent_id in agent_ids if agent_id}))
        if not candidates:
            return []
        agents = session.scalars(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.id.in_(candidates),
                Agent.scope == AgentScope.WORKFLOW_ONLY,
                Agent.status.in_((AgentStatus.ACTIVE, AgentStatus.ARCHIVED)),
            )
        ).all()
        retained_agent_ids = cls.retained_agent_ids(
            session=session,
            tenant_id=tenant_id,
            agent_ids=[agent.id for agent in agents],
        )
        now = naive_utc_now()
        cleanup_candidates: list[str] = []
        for agent in agents:
            if agent.id in retained_agent_ids:
                continue
            if agent.status == AgentStatus.ACTIVE:
                agent.status = AgentStatus.ARCHIVED
                agent.archived_by = account_id
                agent.archived_at = now
                agent.updated_by = account_id or agent.updated_by
                agent.updated_at = now
            cleanup_candidates.append(agent.id)
        session.flush()
        return cleanup_candidates

    @staticmethod
    def retained_agent_ids(
        *,
        session: Session,
        tenant_id: str,
        agent_ids: list[str],
    ) -> set[str]:
        """Return Agents that still have an exact persisted Workflow owner.

        The owner key is tenant, App, Workflow, and Workflow version. Draft and
        every published version, whether current or historical, count equally;
        the App's current-Workflow pointer is not part of ownership.
        """
        if not agent_ids:
            return set()
        values = session.scalars(
            select(WorkflowAgentNodeBinding.agent_id)
            .join(
                Workflow,
                (Workflow.tenant_id == WorkflowAgentNodeBinding.tenant_id)
                & (Workflow.app_id == WorkflowAgentNodeBinding.app_id)
                & (Workflow.id == WorkflowAgentNodeBinding.workflow_id)
                & (Workflow.version == WorkflowAgentNodeBinding.workflow_version),
            )
            .where(
                WorkflowAgentNodeBinding.tenant_id == tenant_id,
                WorkflowAgentNodeBinding.agent_id.in_(agent_ids),
            )
            .distinct()
        ).all()
        return {
            agent_id for agent_id in values if agent_id
        } | WorkflowAgentExecutionRepository.retained_execution_agent_ids(session, tenant_id, agent_ids)
