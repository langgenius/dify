from uuid import UUID

from sqlalchemy.orm import Session

from models.model import App
from services.agent.roster_service import AgentRosterService


def resolve_agent_app_model(*, session: Session, tenant_id: str, agent_id: UUID) -> App:
    """Resolve a roster Agent's public Agent App."""
    return AgentRosterService(session).get_agent_app_model(tenant_id=tenant_id, agent_id=str(agent_id))


def resolve_agent_runtime_app_model(*, session: Session, tenant_id: str, agent_id: UUID) -> App:
    """Resolve the App that backs an Agent runtime surface.

    This accepts both roster Agent Apps and workflow-only inline Agents with a
    hidden backing App.
    """

    return AgentRosterService(session).get_agent_runtime_app_model(tenant_id=tenant_id, agent_id=str(agent_id))
