"""Tenant-scoped persistence for workspace resource cleanup.

The caller owns the session and transaction; this repository never commits.
"""

from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from models import App, Dataset
from models.agent import Agent, AgentHomeSnapshot, AgentWorkspace, AgentWorkspaceBinding, WorkflowAgentNodeBinding
from models.skill import AgentSkillBinding, AgentSkillBindingSnapshot


class WorkspaceResourceCleanupRepository:
    def __init__(self, *, session: Session) -> None:
        self._session = session

    def list_app_ids(self, tenant_id: str) -> Sequence[str]:
        return self._session.scalars(select(App.id).where(App.tenant_id == tenant_id)).all()

    def list_dataset_ids(self, tenant_id: str) -> Sequence[str]:
        return self._session.scalars(select(Dataset.id).where(Dataset.tenant_id == tenant_id)).all()

    def get_app(self, tenant_id: str, app_id: str) -> App | None:
        return self._session.scalar(select(App).where(App.tenant_id == tenant_id, App.id == app_id))

    def get_dataset(self, tenant_id: str, dataset_id: str) -> Dataset | None:
        return self._session.scalar(select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id))

    def delete_dataset(self, dataset: Dataset) -> None:
        self._session.delete(dataset)

    def list_agents(self, tenant_id: str) -> Sequence[Agent]:
        """Include archived agents and agents without a backing App for repeated cleanup."""
        return self._session.scalars(select(Agent).where(Agent.tenant_id == tenant_id)).all()

    def list_workspace_bindings(self, tenant_id: str) -> Sequence[AgentWorkspaceBinding]:
        return self._session.scalars(
            select(AgentWorkspaceBinding).where(AgentWorkspaceBinding.tenant_id == tenant_id)
        ).all()

    def list_workspaces(self, tenant_id: str) -> Sequence[AgentWorkspace]:
        return self._session.scalars(select(AgentWorkspace).where(AgentWorkspace.tenant_id == tenant_id)).all()

    def list_home_snapshots(self, tenant_id: str) -> Sequence[AgentHomeSnapshot]:
        """Include orphan snapshots whose Agent row is already gone."""
        return self._session.scalars(select(AgentHomeSnapshot).where(AgentHomeSnapshot.tenant_id == tenant_id)).all()

    def delete_agent_bindings(self, tenant_id: str) -> None:
        self._session.execute(delete(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.tenant_id == tenant_id))
        self._session.execute(delete(AgentSkillBinding).where(AgentSkillBinding.tenant_id == tenant_id))
        self._session.execute(delete(AgentSkillBindingSnapshot).where(AgentSkillBindingSnapshot.tenant_id == tenant_id))
