"""Bearer authentication for the knowledge MCP endpoint.

Only this endpoint resolves ``dfok_`` bearers. A resolved bearer is not enough: the connection,
the member, the deployment switch and the workspace switch are all re-checked on every request,
and so is the bearer itself (the resolver's cache may still hold a bearer that was rotated away).

The re-check costs two statements per request (one join, then the connection's knowledge bases)
on top of the resolver's own lookup when its cache is cold. It is deliberately not cached:
revocation, membership and switch changes take effect on the next request.
"""

from __future__ import annotations

import secrets
from collections.abc import Callable
from datetime import timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TokenType
from libs.oauth_bearer import BearerAuthenticator, InvalidBearerError, OAuthAccessTokenResolver
from models.account import Account, AccountStatus, TenantAccountJoin
from models.knowledge_agent import (
    KnowledgeAgentClient,
    KnowledgeAgentGrant,
    KnowledgeAgentGrantSpace,
    KnowledgeAgentWorkspaceSetting,
)
from models.oauth import OAuthAccessToken
from services.knowledge_agent.contracts import (
    Clock,
    KnowledgeAgentAuthFailure,
    KnowledgeAgentPrincipal,
    KnowledgeAgentRedis,
    aware,
)
from services.knowledge_agent.oauth import sha256_hex
from services.knowledge_agent.policy import KnowledgeAgentAccessPolicy

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
            # One statement for everything that decides the request: the bearer row, its
            # connection, the member's account and membership, the workspace switch and the
            # client's name. Nothing here is cached, so a change applies to the next request.
            found = session.execute(
                sa.select(
                    OAuthAccessToken,
                    KnowledgeAgentGrant,
                    Account.status,
                    TenantAccountJoin.id,
                    KnowledgeAgentWorkspaceSetting.enabled,
                    KnowledgeAgentClient.name,
                )
                .join(KnowledgeAgentGrant, KnowledgeAgentGrant.id == OAuthAccessToken.knowledge_agent_grant_id)
                .outerjoin(Account, Account.id == KnowledgeAgentGrant.account_id)
                .outerjoin(
                    TenantAccountJoin,
                    sa.and_(
                        TenantAccountJoin.tenant_id == KnowledgeAgentGrant.tenant_id,
                        TenantAccountJoin.account_id == KnowledgeAgentGrant.account_id,
                    ),
                )
                .outerjoin(
                    KnowledgeAgentWorkspaceSetting,
                    KnowledgeAgentWorkspaceSetting.tenant_id == KnowledgeAgentGrant.tenant_id,
                )
                .outerjoin(KnowledgeAgentClient, KnowledgeAgentClient.id == KnowledgeAgentGrant.client_ref)
                .where(OAuthAccessToken.id == str(context.token_id))
                .limit(1)
            ).first()
            if found is None:
                return invalid
            row, grant, account_status, membership_id, workspace_enabled, registered_name = found
            if (
                # The bearer cache is keyed by hash and outlives a rotation by up to its lifetime;
                # the row holds the one bearer that is valid now (none once it is revoked).
                row.token_hash is None
                or not secrets.compare_digest(row.token_hash, sha256_hex(token))
                or grant.revoked_at is not None
                or (grant.expires_at is not None and aware(grant.expires_at) <= now)
                or account_status != AccountStatus.ACTIVE
                or membership_id is None
            ):
                return invalid
            if not self._policy.deployment_enabled():
                return KnowledgeAgentAuthFailure(404, "agent_access_unavailable")
            # A workspace without a settings row allows agents.
            if workspace_enabled is not None and not workspace_enabled:
                return KnowledgeAgentAuthFailure(403, "agent_access_disabled")
            last_used = aware(grant.last_used_at)
            if last_used is None or now - last_used > _TOUCH_INTERVAL:
                grant.last_used_at = now
                row.last_used_at = now
            client_name = registered_name or grant.name
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
