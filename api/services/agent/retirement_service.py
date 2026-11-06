"""Workflow-only Agent ownership retirement after product transactions commit."""

from __future__ import annotations

import logging
from collections.abc import Iterable

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
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
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.workspace_service import AgentWorkspaceService
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection
from tasks.remove_app_and_related_data_task import remove_app_and_related_data_task

logger = logging.getLogger(__name__)


class WorkflowAgentRetirementService:
    """Delete workflow-only Agent aggregates after their last Workflow owner is gone."""

    @classmethod
    def retire_unowned(
        cls,
        *,
        tenant_id: str,
        agent_ids: Iterable[str],
        account_id: str | None,
    ) -> None:
        """Retire unowned workflow-only Agents in an independent transaction.

        This method returns ``None``. It archives orphan Agents, retires their
        working resources, and deletes their hidden Apps before committing. It
        then publishes every hidden-App cleanup before publishing the Agent
        resource collector; database and task-publication errors propagate.

        Archived Agents, missing hidden App rows, and already-retired resources
        remain cleanup candidates. A retry can therefore publish duplicate
        cleanup tasks, which are expected to be idempotent.
        """

        candidates = tuple(sorted({agent_id for agent_id in agent_ids if agent_id}))
        if not candidates:
            return
        backing_app_ids: list[str] = []
        retired_bindings: list[str] = []
        retired_workspaces: list[str] = []
        retired_snapshots: list[str] = []
        try:
            with session_factory.create_session() as session:
                retired_agent_ids = cls.archive_unowned(
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
                    AgentWorkspaceService.retire_all_for_app(
                        session=session,
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
                            AgentWorkspaceService.retire_binding(
                                session=session,
                                tenant_id=tenant_id,
                                binding_id=binding.id,
                            )
                        retired_bindings.append(binding.id)
                    retired_snapshots.extend(
                        AgentHomeSnapshotService.retire_all_for_agent(
                            session=session,
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
                session.commit()
        except Exception:
            logger.exception(
                "Failed to retire unowned Workflow Agents",
                extra={
                    "tenant_id": tenant_id,
                    "agent_ids": candidates,
                },
            )
            raise

        for app_id in backing_app_ids:
            try:
                remove_app_and_related_data_task.delay(tenant_id=tenant_id, app_id=app_id)
            except Exception:
                logger.exception(
                    "Failed to enqueue hidden Agent App cleanup",
                    extra={"tenant_id": tenant_id, "app_id": app_id},
                )
                raise
        enqueue_agent_resource_collection(
            tenant_id=tenant_id,
            workspace_ids=retired_workspaces,
            binding_ids=retired_bindings,
            home_snapshot_ids=retired_snapshots,
            purge_agent_ids=retired_agent_ids,
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
        return {agent_id for agent_id in values if agent_id}


__all__ = ["WorkflowAgentRetirementService"]
