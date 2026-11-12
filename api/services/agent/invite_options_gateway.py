"""Session-owning adapter for the existing roster invite query."""

from pydantic import TypeAdapter
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from services.agent.invite_options import AgentInviteOptionsPage
from services.agent.roster_service import AgentRosterService

_PAGE_ADAPTER = TypeAdapter(AgentInviteOptionsPage)


class AgentInviteOptionsGateway:
    """Convert the legacy roster serializer into validated, detached directory results."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def list_invite_options(
        self,
        context: RequestContext,
        *,
        page: int,
        limit: int,
        keyword: str | None,
        app_id: str | None,
        accessible_agent_ids: set[str] | None,
    ) -> AgentInviteOptionsPage:
        """Validate the tenant-scoped result before closing the read session."""
        with self._session_factory() as session:
            result = AgentRosterService(session).list_invite_options(
                tenant_id=context.active_workspace_id,
                page=page,
                limit=limit,
                keyword=keyword,
                app_id=app_id,
                accessible_agent_ids=sorted(accessible_agent_ids) if accessible_agent_ids is not None else None,
            )
            return _PAGE_ADAPTER.validate_python(result)
