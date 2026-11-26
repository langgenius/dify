"""Connections and their tokens: the rows behind every knowledge-agent bearer.

One ``KnowledgeAgentGrant`` per connection, one ``dfok_`` row in ``oauth_access_tokens`` per grant
(rotated in place) and, for OAuth connections, rotating refresh tokens. Every method works inside
the caller's session, so issuing and revoking stay atomic with whatever decided them.

The bearer cache is keyed by token hash. A rotated bearer's entry is dropped only after the
rotation commits: dropped earlier, a request racing the rotation could read the old hash from the
database and cache it again for the cache's whole lifetime. Authentication also compares the
presented bearer with the row's current hash, so a stale entry never admits a rotated bearer.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta
from typing import Any

import sqlalchemy as sa
from redis.exceptions import RedisError
from sqlalchemy import event
from sqlalchemy.orm import Session

from libs.oauth_bearer import invalidate_oauth_token_cache
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin
from models.knowledge_agent import KnowledgeAgentGrant, KnowledgeAgentGrantSpace, KnowledgeAgentRefreshToken
from models.oauth import OAuthAccessToken
from repositories.knowledge_agent_grant_repository import revoke_knowledge_agent_grant
from services.knowledge_agent.contracts import (
    AUDIT_GRANT_CREATED,
    AUDIT_GRANT_REVOKED,
    Clock,
    KnowledgeAgentRedis,
)
from services.knowledge_agent.oauth import (
    ACCESS_TOKEN_PREFIX,
    ACCESS_TOKEN_TTL_SECONDS,
    DEFAULT_KNOWLEDGE_AGENT_SCOPE,
    REFRESH_TOKEN_PREFIX,
    REFRESH_TOKEN_TTL_SECONDS,
    TOKEN_ROW_CLIENT_ID,
    sha256_hex,
)
from services.oauth_device_contracts import ACCOUNT_ISSUER_SENTINEL

logger = logging.getLogger(__name__)


def member_active(session: Session, grant: KnowledgeAgentGrant) -> bool:
    """Whether the grant's account is active and still a member of the grant's workspace."""
    status = session.scalar(sa.select(Account.status).where(Account.id == grant.account_id))
    member = session.scalar(
        sa.select(TenantAccountJoin.id).where(
            TenantAccountJoin.tenant_id == grant.tenant_id,
            TenantAccountJoin.account_id == grant.account_id,
        )
    )
    return status == AccountStatus.ACTIVE and member is not None


class KnowledgeAgentTokenStore:
    """Creates and ends connections and mints their bearers, keeping the bearer cache in step."""

    def __init__(self, *, redis_client: KnowledgeAgentRedis, clock: Clock) -> None:
        self._redis = redis_client
        self._now = clock

    def create_grant(
        self,
        session: Session,
        *,
        account_id: str,
        tenant_id: str,
        kind: str,
        name: str,
        scopes: list[str],
        space_ids: list[str],
        client_ref: str | None,
        expires_at: datetime | None,
        grant_id: str | None = None,
    ) -> KnowledgeAgentGrant:
        """Insert a connection with its chosen knowledge bases and write the audit record.

        ``grant_id`` lets the caller fix the id before the row exists (the token endpoint reserves
        it against authorization-code replay); otherwise the model generates one.
        """
        grant = KnowledgeAgentGrant(
            tenant_id=tenant_id,
            account_id=account_id,
            kind=kind,
            name=name[:255],
            scope=" ".join(scopes) or DEFAULT_KNOWLEDGE_AGENT_SCOPE,
            client_ref=client_ref,
            expires_at=expires_at,
        )
        if grant_id is not None:
            grant.id = grant_id
        session.add(grant)
        session.flush()
        session.add_all(
            KnowledgeAgentGrantSpace(grant_id=grant.id, control_space_id=space_id, tenant_id=tenant_id)
            for space_id in space_ids
        )
        logger.info(
            "audit: %s grant_id=%s kind=%s",
            AUDIT_GRANT_CREATED,
            grant.id,
            kind,
            extra={"audit": True, "grant_id": grant.id, "account_id": account_id, "tenant_id": tenant_id},
        )
        return grant

    def revoke_grant(self, session: Session, grant_id: str, *, reason: str) -> None:
        """End a connection: revoke its rows, drop its bearer from the cache, audit the first revocation."""
        revocation = revoke_knowledge_agent_grant(session, grant_id, revoked_at=self._now())
        for token_hash in revocation.token_hashes:
            invalidate_oauth_token_cache(self._redis, token_hash)
        if revocation.newly_revoked:
            logger.info(
                "audit: %s grant_id=%s reason=%s",
                AUDIT_GRANT_REVOKED,
                grant_id,
                reason,
                extra={"audit": True, "grant_id": grant_id, "reason": reason},
            )

    def upsert_bearer(self, session: Session, grant: KnowledgeAgentGrant, expires_at: datetime) -> str:
        """One bearer row per connection, rotated in place like the device-flow tokens."""
        token = f"{ACCESS_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"
        row = session.scalar(
            sa.select(OAuthAccessToken).where(OAuthAccessToken.knowledge_agent_grant_id == grant.id).with_for_update()
        )
        previous_hash = row.token_hash if row else None
        if row is None:
            account = session.get(Account, grant.account_id)
            row = OAuthAccessToken(
                subject_email=account.email if account else "",
                client_id=TOKEN_ROW_CLIENT_ID,
                device_label=self._token_row_label(session, grant),
                prefix=ACCESS_TOKEN_PREFIX,
                expires_at=expires_at,
                subject_issuer=ACCOUNT_ISSUER_SENTINEL,
                account_id=grant.account_id,
                token_hash=sha256_hex(token),
                knowledge_agent_grant_id=grant.id,
            )
            session.add(row)
        else:
            row.token_hash = sha256_hex(token)
            row.expires_at = expires_at
            row.revoked_at = None
        session.flush()
        if previous_hash:
            self._invalidate_after_commit(session, previous_hash)
        return token

    def _invalidate_after_commit(self, session: Session, token_hash: str) -> None:
        """Drop a bearer's cache entry once the session's transaction has committed.

        The rotation is already durable when this runs, so a cache outage must not fail the call
        (the caller would lose tokens it can no longer ask for again). Leaving the entry behind
        is safe: authentication compares the presented bearer with the row's current hash.
        """
        redis = self._redis

        def invalidate(_session: Session) -> None:
            try:
                invalidate_oauth_token_cache(redis, token_hash)
            except RedisError:
                logger.warning("knowledge agent bearer cache entry was not dropped after rotation", exc_info=True)

        event.listen(session, "after_commit", invalidate, once=True)

    def issue_tokens(self, session: Session, grant: KnowledgeAgentGrant) -> dict[str, Any]:
        """Rotate the access token, add a refresh token and return the RFC 6749 token response."""
        now = self._now()
        access_token = self.upsert_bearer(session, grant, now + timedelta(seconds=ACCESS_TOKEN_TTL_SECONDS))
        refresh_token = f"{REFRESH_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"
        session.add(
            KnowledgeAgentRefreshToken(
                grant_id=grant.id,
                token_hash=sha256_hex(refresh_token),
                expires_at=now + timedelta(seconds=REFRESH_TOKEN_TTL_SECONDS),
            )
        )
        session.execute(
            sa.delete(KnowledgeAgentRefreshToken)
            .where(
                KnowledgeAgentRefreshToken.grant_id == grant.id,
                KnowledgeAgentRefreshToken.expires_at < now,
            )
            .execution_options(synchronize_session=False)
        )
        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": ACCESS_TOKEN_TTL_SECONDS,
            "refresh_token": refresh_token,
            "scope": grant.scope,
        }

    @staticmethod
    def _token_row_label(session: Session, grant: KnowledgeAgentGrant) -> str:
        tenant_name = session.scalar(sa.select(Tenant.name).where(Tenant.id == grant.tenant_id)) or ""
        # The id suffix keeps the (email, issuer, client, label) uniqueness of the token table.
        return f"{grant.name} · {tenant_name} · {grant.id[:8]}"[:255]
