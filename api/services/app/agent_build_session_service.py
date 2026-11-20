"""Manage an account's Agent Build conversation and draft."""

from typing import Protocol

from machinery.context import RequestContext
from services.app.agent_build_session_store import AgentBuildDraft, AgentBuildSessionStore


class AgentBuildResourceCollector(Protocol):
    def __call__(self, *, tenant_id: str, binding_ids: tuple[str, ...]) -> None:
        """Schedule physical collection of already retired bindings in the given tenant."""
        ...


class AgentBuildSessionService:
    """Use the admitted workspace and account for every operation and collect resources after commit."""

    def __init__(self, *, store: AgentBuildSessionStore, collect_resources: AgentBuildResourceCollector) -> None:
        """Accept a store that commits writes before returning and a post-commit collector."""
        self._store = store
        self._collect_resources = collect_resources

    def refresh_conversation(self, context: RequestContext, agent_id: str) -> str:
        """Replace the caller's Build conversation, then schedule collection of the retired binding, if any."""
        result = self._store.refresh_build_conversation(
            tenant_id=context.active_workspace_id, agent_id=agent_id, account_id=context.account_id
        )
        if result.retired_binding_id is not None:
            self._collect_resources(tenant_id=context.active_workspace_id, binding_ids=(result.retired_binding_id,))
        return result.conversation_id

    def get_draft(self, context: RequestContext, agent_id: str) -> AgentBuildDraft:
        """Return the admitted caller's existing Build draft without writing."""
        return self._store.get_build_draft(
            tenant_id=context.active_workspace_id, agent_id=agent_id, account_id=context.account_id
        )

    def discard_draft(self, context: RequestContext, agent_id: str) -> None:
        """Discard only the admitted caller's Build draft, then schedule collection if a binding was retired."""
        retired = self._store.discard_build_draft(
            tenant_id=context.active_workspace_id, agent_id=agent_id, account_id=context.account_id
        )
        if retired is not None:
            self._collect_resources(tenant_id=context.active_workspace_id, binding_ids=(retired,))
