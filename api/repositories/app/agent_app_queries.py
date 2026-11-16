"""Session-scoped queries shared by Agent App persistence and legacy callers."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.agent import APP_BACKED_AGENT_SOURCES, Agent, AgentScope, AgentStatus
from models.enums import AppStatus
from models.model import App, AppMode


def get_app_backing_agent(session: Session, *, tenant_id: str, app_id: str) -> Agent | None:
    """Return the tenant's active roster Agent backing an App, or None without writing."""
    return session.scalar(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.app_id == app_id,
            Agent.scope == AgentScope.ROSTER,
            Agent.source.in_(APP_BACKED_AGENT_SOURCES),
            Agent.status == AgentStatus.ACTIVE,
        )
    )


def get_roster_agent_app(session: Session, *, tenant_id: str, agent_id: str) -> App | None:
    """Return the normal Agent App for an active app-backed roster Agent, or None.

    Both records must belong to the given tenant. The caller owns the Session
    and its transaction; this query never creates or changes either record.
    """
    agent = session.scalar(
        select(Agent)
        .where(
            Agent.tenant_id == tenant_id,
            Agent.id == agent_id,
            Agent.scope == AgentScope.ROSTER,
            Agent.source.in_(APP_BACKED_AGENT_SOURCES),
            Agent.app_id.is_not(None),
            Agent.status == AgentStatus.ACTIVE,
        )
        .limit(1)
    )
    if agent is None or agent.app_id is None:
        return None
    return session.scalar(
        select(App)
        .where(
            App.tenant_id == tenant_id,
            App.id == agent.app_id,
            App.mode == AppMode.AGENT,
            App.status == AppStatus.NORMAL,
        )
        .limit(1)
    )


def load_app_backing_agents_by_app_id(session: Session, *, tenant_id: str, app_ids: list[str]) -> dict[str, Agent]:
    """Return active app-backed Agents keyed by Agent App id."""
    if not app_ids:
        return {}
    agents = session.scalars(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.app_id.in_(app_ids),
            Agent.scope == AgentScope.ROSTER,
            Agent.source.in_(APP_BACKED_AGENT_SOURCES),
            Agent.status == AgentStatus.ACTIVE,
        )
    ).all()
    return {agent.app_id: agent for agent in agents if agent.app_id and agent.id}


def load_app_ids_for_agents(session: Session, *, tenant_id: str, agent_ids: Sequence[str]) -> list[str]:
    """Return active Agent App ids for the requested roster Agents."""
    if not agent_ids:
        return []
    app_ids = session.scalars(
        select(Agent.app_id).where(
            Agent.tenant_id == tenant_id,
            Agent.id.in_(agent_ids),
            Agent.app_id.is_not(None),
            Agent.scope == AgentScope.ROSTER,
            Agent.source.in_(APP_BACKED_AGENT_SOURCES),
            Agent.status == AgentStatus.ACTIVE,
        )
    ).all()
    return sorted({str(app_id) for app_id in app_ids if app_id})
