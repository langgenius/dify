"""Hard-delete archived Agent aggregates after external resources are collected."""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigRevision,
    AgentConfigSnapshot,
    AgentDebugConversation,
    AgentHomeSnapshot,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspaceBinding,
)


class AgentDeletionInvariantError(RuntimeError):
    """An archived Agent no longer satisfies the hard-deletion contract."""


class AgentDeletionService:
    """Delete archived Agent aggregates after their external resources are gone.

    The aggregate includes Agent-owned configuration, debug, Home, and Workspace
    Binding rows. Workflow-owned binding soft references are outside the
    aggregate and may remain dangling after deletion.
    """

    @classmethod
    def purge_archived_agents(cls, *, tenant_id: str, agent_ids: Iterable[str]) -> None:
        """Idempotently hard-delete eligible archived Agent aggregates.

        Missing targets are a no-op. Every stored target must be ``ARCHIVED``,
        have no ACTIVE Workspace Binding or Home Snapshot, and all dependent rows
        and Agents are deleted and committed in one transaction; an exception
        before commit leaves the transaction to roll back without a partial
        aggregate deletion.
        """
        candidates = tuple(sorted({agent_id for agent_id in agent_ids if agent_id}))
        if not candidates:
            return

        with session_factory.create_session() as session:
            agents = session.scalars(select(Agent).where(Agent.tenant_id == tenant_id, Agent.id.in_(candidates))).all()
            if not agents:
                return

            stored_ids = [agent.id for agent in agents]
            non_archived_ids = [agent.id for agent in agents if agent.status != AgentStatus.ARCHIVED]
            if non_archived_ids:
                raise AgentDeletionInvariantError(
                    f"Agents must be ARCHIVED before deletion: {', '.join(non_archived_ids)}"
                )

            active_binding_id = session.scalar(
                select(AgentWorkspaceBinding.id)
                .where(
                    AgentWorkspaceBinding.tenant_id == tenant_id,
                    AgentWorkspaceBinding.agent_id.in_(stored_ids),
                    AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
                )
                .limit(1)
            )
            if active_binding_id is not None:
                raise AgentDeletionInvariantError(f"Agent aggregate still has ACTIVE Binding {active_binding_id}")

            active_home_id = session.scalar(
                select(AgentHomeSnapshot.id)
                .where(
                    AgentHomeSnapshot.tenant_id == tenant_id,
                    AgentHomeSnapshot.agent_id.in_(stored_ids),
                    AgentHomeSnapshot.status == AgentWorkingResourceStatus.ACTIVE,
                )
                .limit(1)
            )
            if active_home_id is not None:
                raise AgentDeletionInvariantError(f"Agent aggregate still has ACTIVE Home Snapshot {active_home_id}")

            for model in (
                AgentDebugConversation,
                AgentConfigRevision,
                AgentConfigDraft,
                AgentConfigSnapshot,
                AgentHomeSnapshot,
                AgentWorkspaceBinding,
            ):
                session.execute(
                    delete(model).where(
                        model.tenant_id == tenant_id,
                        model.agent_id.in_(stored_ids),
                    )
                )
            session.execute(delete(Agent).where(Agent.tenant_id == tenant_id, Agent.id.in_(stored_ids)))
            session.commit()


__all__ = ["AgentDeletionInvariantError", "AgentDeletionService"]
