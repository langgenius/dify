"""What a member and a connection may reach right now: the three switches and current sharing."""

from __future__ import annotations

from collections.abc import Callable

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_agent import KnowledgeAgentWorkspaceSetting
from services.knowledge_agent.contracts import (
    KnowledgeAgentAccessError,
    KnowledgeAgentPrincipal,
    KnowledgeAgentSpacePort,
)
from services.knowledge_agent.oauth import MAX_GRANT_KNOWLEDGE_BASES


class KnowledgeAgentAccessPolicy:
    """The deployment switch, the workspace switch and the knowledge bases' own switches and sharing."""

    def __init__(
        self,
        *,
        session_maker: sessionmaker[Session],
        spaces: KnowledgeAgentSpacePort,
        enabled: Callable[[], bool],
    ) -> None:
        self._sessions = session_maker
        self._spaces = spaces
        self._enabled = enabled

    def deployment_enabled(self) -> bool:
        """Whether this deployment offers agent connections at all."""
        return self._enabled()

    def require_enabled(self) -> None:
        """Answer 404 on Console and registration calls when the deployment switch is off."""
        if not self._enabled():
            raise KnowledgeAgentAccessError(404, "agent_access_unavailable", "Agent connections are not enabled")

    @staticmethod
    def workspace_enabled_in(session: Session, tenant_id: str) -> bool:
        """The workspace switch read in the caller's session; a workspace without a row allows agents."""
        enabled = session.scalar(
            sa.select(KnowledgeAgentWorkspaceSetting.enabled).where(
                KnowledgeAgentWorkspaceSetting.tenant_id == tenant_id
            )
        )
        return True if enabled is None else bool(enabled)

    def workspace_enabled(self, tenant_id: str) -> bool:
        """The workspace switch, read in a short session of its own."""
        with self._sessions() as session:
            return self.workspace_enabled_in(session, tenant_id)

    def require_workspace_enabled(self, tenant_id: str) -> None:
        """Refuse to create a connection in a workspace whose admins turned agents off."""
        if not self.workspace_enabled(tenant_id):
            raise KnowledgeAgentAccessError(
                403, "agent_access_disabled", "Agent access is turned off for this workspace"
            )

    def blocked_knowledge_bases(self, tenant_id: str) -> list[str]:
        """Every knowledge base of the workspace whose managers turned personal agents off, sorted."""
        return sorted(self._spaces.blocked(tenant_id=tenant_id))

    def check_knowledge_bases(self, *, account_id: str, tenant_id: str, raw: object) -> list[str]:
        """Validate the bases chosen for a connection: 1-100 ids the member can read, none blocked."""
        if not isinstance(raw, list) or not raw or len(raw) > MAX_GRANT_KNOWLEDGE_BASES:
            raise KnowledgeAgentAccessError(
                422,
                "invalid_knowledge_bases",
                f"Choose between 1 and {MAX_GRANT_KNOWLEDGE_BASES} knowledge bases",
            )
        ids = list(dict.fromkeys(raw))
        if any(not isinstance(item, str) or not item for item in ids):
            raise KnowledgeAgentAccessError(422, "invalid_knowledge_bases", "Knowledge base ids must be strings")
        readable = self._spaces.readable(tenant_id=tenant_id, account_id=account_id, control_space_ids=ids)
        rejected = [item for item in ids if item not in readable]
        if rejected:
            raise KnowledgeAgentAccessError(
                422,
                "invalid_knowledge_bases",
                "Some knowledge bases are not available",
                {"knowledge_base_ids": rejected},
            )
        blocked = self._spaces.blocked(tenant_id=tenant_id, control_space_ids=ids)
        blocked_ids = [item for item in ids if item in blocked]
        if blocked_ids:
            raise KnowledgeAgentAccessError(
                422,
                "knowledge_base_agent_access_blocked",
                "Agent access is turned off for some knowledge bases",
                {"knowledge_base_ids": blocked_ids},
            )
        return ids

    def knowledge_bases_for(self, principal: KnowledgeAgentPrincipal) -> set[str]:
        """Bases this connection may use now: chosen, readable by the member, not blocked."""
        readable = self._spaces.readable(
            tenant_id=principal.tenant_id,
            account_id=principal.account_id,
            control_space_ids=principal.control_space_ids,
        )
        return readable - self._spaces.blocked(tenant_id=principal.tenant_id, control_space_ids=readable)
