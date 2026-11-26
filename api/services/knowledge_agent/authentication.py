"""Bearer authentication for the knowledge MCP endpoint.

Only this endpoint resolves ``dfok_`` bearers. A resolved bearer is not enough: the connection,
the member, the deployment switch and the workspace switch are all re-checked on every request.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TokenType
from libs.oauth_bearer import BearerAuthenticator, InvalidBearerError, OAuthAccessTokenResolver
from models.knowledge_agent import KnowledgeAgentClient, KnowledgeAgentGrant, KnowledgeAgentGrantSpace
from models.oauth import OAuthAccessToken
from services.knowledge_agent.contracts import (
    Clock,
    KnowledgeAgentAuthFailure,
    KnowledgeAgentPrincipal,
    KnowledgeAgentRedis,
    aware,
)
from services.knowledge_agent.policy import KnowledgeAgentAccessPolicy
from services.knowledge_agent.tokens import member_active

_TOUCH_INTERVAL = timedelta(minutes=5)


class KnowledgeAgentBearerAuthentication:
    """Turns a ``dfok_`` bearer into the connection it stands for, or the reason it is refused."""

    def __init__(
        self,
        *,
        session_maker: sessionmaker[Session],
        bearer_session: Callable[[], Session],
        redis_client: KnowledgeAgentRedis,
        policy: KnowledgeAgentAccessPolicy,
        clock: Clock,
    ) -> None:
        self._sessions = session_maker
        self._policy = policy
        self._now = clock
        # The shared bearer resolver neither closes nor scopes its session: like the OpenAPI
        # authenticator, it gets the request-scoped session, which request teardown closes.
        resolver = OAuthAccessTokenResolver(bearer_session, redis_client)
        # Only the knowledge MCP endpoint resolves knowledge-agent bearers.
        self._authenticator = BearerAuthenticator(
            {TokenType.OAUTH_KNOWLEDGE_AGENT: resolver.for_token_type(TokenType.OAUTH_KNOWLEDGE_AGENT)}
        )

    def authenticate(self, token: str) -> KnowledgeAgentPrincipal | KnowledgeAgentAuthFailure:
        """Resolve the bearer and re-check its connection; also records the connection's last use."""
        invalid = KnowledgeAgentAuthFailure(401, "invalid_token")
        try:
            context = self._authenticator.authenticate(token)
        except InvalidBearerError:
            return invalid
        now = self._now()
        with self._sessions.begin() as session:
            row = session.get(OAuthAccessToken, str(context.token_id))
            grant = (
                session.get(KnowledgeAgentGrant, row.knowledge_agent_grant_id)
                if row is not None and row.knowledge_agent_grant_id
                else None
            )
            if (
                grant is None
                or grant.revoked_at is not None
                or (grant.expires_at is not None and aware(grant.expires_at) <= now)
                or not member_active(session, grant)
            ):
                return invalid
            if not self._policy.deployment_enabled():
                return KnowledgeAgentAuthFailure(404, "agent_access_unavailable")
            if not self._policy.workspace_enabled_in(session, grant.tenant_id):
                return KnowledgeAgentAuthFailure(403, "agent_access_disabled")
            last_used = aware(grant.last_used_at)
            if last_used is None or now - last_used > _TOUCH_INTERVAL:
                grant.last_used_at = now
                if row is not None:
                    row.last_used_at = now
            client_name = grant.name
            if grant.client_ref:
                client_name = (
                    session.scalar(
                        sa.select(KnowledgeAgentClient.name).where(KnowledgeAgentClient.id == grant.client_ref)
                    )
                    or grant.name
                )
            space_ids = tuple(
                session.scalars(
                    sa.select(KnowledgeAgentGrantSpace.control_space_id).where(
                        KnowledgeAgentGrantSpace.grant_id == grant.id
                    )
                ).all()
            )
            return KnowledgeAgentPrincipal(
                account_id=grant.account_id,
                tenant_id=grant.tenant_id,
                grant_id=grant.id,
                token_id=str(context.token_id),
                kind=grant.kind,
                client_name=client_name,
                control_space_ids=space_ids,
            )
