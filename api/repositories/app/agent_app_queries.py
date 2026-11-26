"""Session-scoped queries shared by Agent App persistence and legacy callers."""

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
