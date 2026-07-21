"""Workflow-only Agent ownership retirement.

Replacement paths submit candidate Agent IDs after their database transaction
commits. The retirement task then checks the current draft and current
published workflow bindings before archiving anything.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

from sqlalchemy import event, or_, select
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.agent import Agent, AgentScope, AgentStatus, WorkflowAgentNodeBinding
from models.enums import AppStatus
from models.model import App
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class WorkflowAgentRetirementService:
    """Archive workflow-only Agents once no effective binding owns them."""

    @classmethod
    def schedule_after_commit(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent_ids: Iterable[str],
        account_id: str | None,
    ) -> None:
        candidates = tuple(sorted({agent_id for agent_id in agent_ids if agent_id}))
        if not candidates:
            return
        state = {"rolled_back": False}

        def cancel(_session: Session) -> None:
            state["rolled_back"] = True

        def dispatch(_session: Session) -> None:
            if state["rolled_back"]:
                return
            from tasks.agent_backend_session_cleanup_task import retire_workflow_agents_if_unowned

            try:
                retire_workflow_agents_if_unowned.delay(
                    tenant_id=tenant_id,
                    agent_ids=list(candidates),
                    account_id=account_id,
                )
            except Exception:
                logger.exception(
                    "Failed to enqueue workflow Agent retirement: tenant_id=%s agent_ids=%s",
                    tenant_id,
                    candidates,
                )

        event.listen(session, "after_rollback", cancel, once=True)
        event.listen(session, "after_commit", dispatch, once=True)

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
