from uuid import UUID

from extensions.ext_database import db
from models.model import App
from services.agent.roster_service import AgentRosterService


def resolve_agent_app_model(*, tenant_id: str, agent_id: UUID) -> App:
    """Resolve the hidden Agent App backing an Agent Console resource."""
    return AgentRosterService(db.session).get_agent_app_model(tenant_id=tenant_id, agent_id=str(agent_id))
