"""Workflow-only Agent ownership retirement after product transactions commit."""

from __future__ import annotations

import logging
from collections.abc import Iterable

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from models.agent import (
    Agent,
    AgentScope,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspaceBinding,
    WorkflowAgentNodeBinding,
)
from models.enums import AppStatus
from models.model import App
from models.workflow import Workflow
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.workspace_service import AgentWorkspaceService

logger = logging.getLogger(__name__)


class WorkflowAgentRetirementService:
    """Archive workflow-only Agents once no effective binding owns them."""

    @classmethod
    def retire_unowned(
        cls,
        *,
        tenant_id: str,
        agent_ids: Iterable[str],
        account_id: str | None,
    ) -> tuple[list[str], list[str]]:
        """Re-check ownership, archive orphans, and commit their resource retirement."""

        candidates = tuple(sorted({agent_id for agent_id in agent_ids if agent_id}))
        if not candidates:
            return [], []
        retired_bindings: list[str] = []
        retired_snapshots: list[str] = []
        try:
            with session_factory.create_session() as session:
                retired_agent_ids = cls.archive_unowned(
                    session=session,
                    tenant_id=tenant_id,
                    agent_ids=candidates,
                    account_id=account_id,
                )
                for agent_id in retired_agent_ids:
                    bindings = session.scalars(
                        select(AgentWorkspaceBinding).where(
                            AgentWorkspaceBinding.tenant_id == tenant_id,
                            AgentWorkspaceBinding.agent_id == agent_id,
                            AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
                        )
                    ).all()
                    for binding in bindings:
                        binding_id = AgentWorkspaceService.retire_binding(
                            session=session,
                            tenant_id=tenant_id,
                            binding_id=binding.id,
                        )
                        if binding_id is not None:
                            retired_bindings.append(binding_id)
                    retired_snapshots.extend(
                        AgentHomeSnapshotService.retire_all_for_agent(
                            session=session,
                            tenant_id=tenant_id,
                            agent_id=agent_id,
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
            return [], []
        return retired_bindings, retired_snapshots

    @classmethod
    def archive_unowned(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent_ids: Iterable[str],
        account_id: str | None,
    ) -> list[str]:
        """Archive active orphans and return every orphan eligible for Home cleanup."""
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
        effective_agent_ids = cls._effective_agent_ids(
            session=session,
            tenant_id=tenant_id,
            agent_ids=[agent.id for agent in agents],
        )
        now = naive_utc_now()
        cleanup_candidates: list[str] = []
        for agent in agents:
            if agent.id in effective_agent_ids:
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
    def _effective_agent_ids(
        *,
        session: Session,
        tenant_id: str,
        agent_ids: list[str],
    ) -> set[str]:
        if not agent_ids:
            return set()
        values = session.scalars(
            select(WorkflowAgentNodeBinding.agent_id)
            .join(
                Workflow,
                Workflow.id == WorkflowAgentNodeBinding.workflow_id,
            )
            .join(App, App.id == WorkflowAgentNodeBinding.app_id)
            .where(
                WorkflowAgentNodeBinding.tenant_id == tenant_id,
                WorkflowAgentNodeBinding.agent_id.in_(agent_ids),
                Workflow.tenant_id == tenant_id,
                Workflow.app_id == WorkflowAgentNodeBinding.app_id,
                Workflow.version == WorkflowAgentNodeBinding.workflow_version,
                App.tenant_id == tenant_id,
                App.status == AppStatus.NORMAL,
                or_(
                    Workflow.version == Workflow.VERSION_DRAFT,
                    App.workflow_id == Workflow.id,
                ),
            )
            .distinct()
        ).all()
        return {agent_id for agent_id in values if agent_id}


__all__ = ["WorkflowAgentRetirementService"]
