"""Application service for Agent version history and restoration."""

from collections.abc import Callable

from machinery.context import RequestContext
from services.agent.version_store import (
    AgentVersionDetail,
    AgentVersionPlanRequiredError,
    AgentVersionRestored,
    AgentVersionStore,
    AgentVersionSummary,
)


class AgentVersionService:
    """Apply workspace eligibility before restoring a visible configuration version."""

    def __init__(self, *, store: AgentVersionStore, restore_allowed: Callable[[str], bool]) -> None:
        self._store = store
        self._restore_allowed = restore_allowed

    def list_versions(self, context: RequestContext, agent_id: str) -> list[AgentVersionSummary]:
        """Return visible versions belonging to the admitted workspace's Agent."""
        return self._store.list_versions(tenant_id=context.active_workspace_id, agent_id=agent_id)

    def get_version(self, context: RequestContext, agent_id: str, version_id: str) -> AgentVersionDetail:
        """Return the specified visible version and its revisions, or raise when unavailable."""
        return self._store.get_version(tenant_id=context.active_workspace_id, agent_id=agent_id, version_id=version_id)

    def restore_version(self, context: RequestContext, agent_id: str, version_id: str) -> AgentVersionRestored:
        """Check the workspace plan, then atomically restore a visible version to its shared draft."""
        if not self._restore_allowed(context.active_workspace_id):
            raise AgentVersionPlanRequiredError
        return self._store.restore_version(
            tenant_id=context.active_workspace_id,
            agent_id=agent_id,
            version_id=version_id,
            account_id=context.account_id,
        )
