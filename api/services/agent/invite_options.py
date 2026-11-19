"""Agent invite-option visibility and query orchestration."""

from typing import Protocol

from machinery.context import RequestContext
from services.agent.invite_options_store import AgentInviteOptionsPage, AgentInviteOptionsStore


class AgentListVisibility(Protocol):
    def visible_ids(self, context: RequestContext) -> set[str] | None:
        """Return visible Agent ids, or None when visibility is unrestricted."""
        ...


class AgentInviteOptionsService:
    """Resolve caller visibility before querying Workflow-callable roster Agents."""

    def __init__(self, *, store: AgentInviteOptionsStore, visibility: AgentListVisibility) -> None:
        self._store = store
        self._visibility = visibility

    def list(
        self, context: RequestContext, *, page: int, limit: int, keyword: str | None, app_id: str | None
    ) -> AgentInviteOptionsPage:
        """Return an admitted tenant's visible invite options without retaining a session."""
        visible = self._visibility.visible_ids(context)
        return self._store.list_invite_options(
            context, page=page, limit=limit, keyword=keyword, app_id=app_id, accessible_agent_ids=visible
        )
