"""Personal agents reading Agent Knowledge Bases as the signed-in member.

The platform is its own OAuth 2.1 authorization server for MCP clients (PKCE S256, client ID
metadata documents and dynamic registration, resource-bound tokens) and also mints personal
tokens. Every bearer is a ``dfok_`` row in ``oauth_access_tokens`` linked to one connection
(``KnowledgeAgentGrant``): one account, one workspace, the knowledge bases chosen for it. Effective
access is re-evaluated on every request: account, membership, the workspace switch, the
knowledge bases' own switches and the member's current permissions.

``KnowledgeAgentAccessService`` is the facade the controllers use. The work lives in:

- ``clients``: the client registry (dynamic registration, metadata documents);
- ``authorization``: the authorization server (consent, codes, token endpoint, revocation);
- ``authentication``: bearer authentication for the MCP endpoint;
- ``grants``: connection management for the Console;
- ``tokens`` and ``policy``: the rows behind a connection and what it may reach right now.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from models.account import Account
from services.knowledge_agent import authorization
from services.knowledge_agent.authentication import KnowledgeAgentBearerAuthentication
from services.knowledge_agent.authorization import KnowledgeAgentAuthorizationServer
from services.knowledge_agent.clients import KnowledgeAgentClientRegistry
from services.knowledge_agent.contracts import (
    AUDIT_GRANT_CREATED,
    AUDIT_GRANT_REVOKED,
    ClientMetadataFetcher,
    Clock,
    KnowledgeAgentAccessError,
    KnowledgeAgentAuthFailure,
    KnowledgeAgentPrincipal,
    KnowledgeAgentRedis,
    KnowledgeAgentSpacePort,
    KnowledgeAgentUrls,
    utcnow,
)
from services.knowledge_agent.grants import TOKEN_HINT_LENGTH, KnowledgeAgentGrantConsole
from services.knowledge_agent.policy import KnowledgeAgentAccessPolicy
from services.knowledge_agent.tokens import KnowledgeAgentTokenStore

__all__ = [
    "AUDIT_GRANT_CREATED",
    "AUDIT_GRANT_REVOKED",
    "TOKEN_HINT_LENGTH",
    "KnowledgeAgentAccessError",
    "KnowledgeAgentAccessService",
    "KnowledgeAgentAuthFailure",
    "KnowledgeAgentPrincipal",
    "KnowledgeAgentSpacePort",
    "KnowledgeAgentUrls",
]


class KnowledgeAgentAccessService:
    """One entry point over the knowledge-agent modules; it wires them and holds no logic of its own."""

    def __init__(
        self,
        *,
        session_maker: sessionmaker[Session],
        bearer_session: Callable[[], Session],
        redis_client: KnowledgeAgentRedis,
        spaces: KnowledgeAgentSpacePort,
        fetch_client_metadata: ClientMetadataFetcher | None,
        enabled: Callable[[], bool],
        clock: Clock = utcnow,
    ) -> None:
        self._policy = KnowledgeAgentAccessPolicy(session_maker=session_maker, spaces=spaces, enabled=enabled)
        tokens = KnowledgeAgentTokenStore(redis_client=redis_client, clock=clock)
        self._clients = KnowledgeAgentClientRegistry(
            session_maker=session_maker,
            redis_client=redis_client,
            fetch_client_metadata=fetch_client_metadata,
            clock=clock,
        )
        self._authorization = KnowledgeAgentAuthorizationServer(
            session_maker=session_maker,
            redis_client=redis_client,
            clients=self._clients,
            tokens=tokens,
            policy=self._policy,
            clock=clock,
        )
        self._authentication = KnowledgeAgentBearerAuthentication(
            session_maker=session_maker,
            bearer_session=bearer_session,
            redis_client=redis_client,
            policy=self._policy,
            clock=clock,
        )
        self._grants = KnowledgeAgentGrantConsole(
            session_maker=session_maker, tokens=tokens, policy=self._policy, clock=clock
        )

    # -- Discovery ----------------------------------------------------------------------------

    @staticmethod
    def protected_resource_metadata(urls: KnowledgeAgentUrls) -> dict[str, Any]:
        """RFC 9728 metadata for the knowledge MCP endpoint."""
        return authorization.protected_resource_metadata(urls)

    @staticmethod
    def authorization_server_metadata(urls: KnowledgeAgentUrls) -> dict[str, Any]:
        """RFC 8414 metadata: PKCE S256 only, public clients, metadata documents and registration."""
        return authorization.authorization_server_metadata(urls)

    def require_enabled(self) -> None:
        """Raise the 404 access error when this deployment does not offer agent connections."""
        self._policy.require_enabled()

    # -- OAuth clients and the authorization server ---------------------------------------------

    def register_client(self, body: dict[str, Any], *, ip_address: str | None) -> dict[str, Any]:
        """Dynamic client registration (RFC 7591), rate limited per caller address and deployment-wide."""
        return self._clients.register(body, ip_address=ip_address)

    def describe_authorization(
        self, *, account: Account, tenant_id: str, params: dict[str, Any], urls: KnowledgeAgentUrls
    ) -> dict[str, Any]:
        """Validate an agent's authorization request and describe it for the member's consent page."""
        return self._authorization.describe(account=account, tenant_id=tenant_id, params=params, urls=urls)

    def decide_authorization(
        self, *, account: Account, tenant_id: str, body: dict[str, Any], urls: KnowledgeAgentUrls
    ) -> dict[str, str]:
        """Record the member's approval or denial and return the redirect back to the agent."""
        return self._authorization.decide(account=account, tenant_id=tenant_id, body=body, urls=urls)

    def exchange_token(self, form: dict[str, Any], urls: KnowledgeAgentUrls) -> dict[str, Any]:
        """The token endpoint: authorization-code redemption and refresh-token rotation."""
        return self._authorization.exchange_token(form, urls)

    def revoke_token(self, form: dict[str, Any]) -> None:
        """RFC 7009: revoking any token of a connection ends the connection; unknown tokens are fine."""
        self._authorization.revoke_token(form)

    # -- Bearer authentication (MCP) --------------------------------------------------------------

    def authenticate(self, token: str) -> KnowledgeAgentPrincipal | KnowledgeAgentAuthFailure:
        """The connection a ``dfok_`` bearer stands for, or the status and code to refuse it with."""
        return self._authentication.authenticate(token)

    def knowledge_bases_for(
        self, principal: KnowledgeAgentPrincipal, *, among: Iterable[str] | None = None
    ) -> set[str]:
        """Bases this connection may use now: chosen, readable by the member, not blocked.

        ``among`` limits the check to those ids, for a tool that reads a single knowledge base.
        """
        return self._policy.knowledge_bases_for(principal, among=among)

    # -- Connections (Console) -------------------------------------------------------------------

    def list_mine(self, *, account: Account, tenant_id: str, urls: KnowledgeAgentUrls) -> dict[str, Any]:
        """The member's connections in the workspace, with the MCP URL and both switches."""
        return self._grants.list_mine(account=account, tenant_id=tenant_id, urls=urls)

    def create_personal_token(self, *, account: Account, tenant_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Create a personal token; the response is the only place the token appears."""
        return self._grants.create_personal_token(account=account, tenant_id=tenant_id, body=body)

    def update_grant(self, *, account: Account, tenant_id: str, grant_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Change which knowledge bases the member's own connection may read."""
        return self._grants.update_grant(account=account, tenant_id=tenant_id, grant_id=grant_id, body=body)

    def revoke_grant(self, *, account: Account, tenant_id: str, role: str | None, grant_id: str) -> None:
        """Disconnect a connection as its owner or as a workspace admin."""
        self._grants.revoke_grant(account=account, tenant_id=tenant_id, role=role, grant_id=grant_id)

    def workspace_settings(self, *, tenant_id: str, role: str | None) -> dict[str, Any]:
        """The workspace switch and all members' connections, for workspace admins."""
        return self._grants.workspace_settings(tenant_id=tenant_id, role=role)

    def update_workspace_settings(
        self, *, account: Account, tenant_id: str, role: str | None, body: dict[str, Any]
    ) -> dict[str, Any]:
        """Set the workspace switch (workspace admins) and return the refreshed admin view."""
        return self._grants.update_workspace_settings(account=account, tenant_id=tenant_id, role=role, body=body)
