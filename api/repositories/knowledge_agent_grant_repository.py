"""SQL persistence shared by everything that ends a knowledge-agent connection.

A connection (``KnowledgeAgentGrant``) is ended from several places: the Console, the OAuth
revocation endpoint, replay detection, and the account's session list. They all go through
``revoke_knowledge_agent_grant`` so the grant, its bearer row and its refresh tokens always end
together. This module depends on models only, so repositories and services can both import it.
"""

from __future__ import annotations

from datetime import datetime
from typing import NamedTuple

import sqlalchemy as sa
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from models.knowledge_agent import KnowledgeAgentGrant, KnowledgeAgentRefreshToken
from models.oauth import OAuthAccessToken


class KnowledgeAgentGrantRevocation(NamedTuple):
    """What a revocation changed, for the caller's cache invalidation and audit trail."""

    newly_revoked: bool
    token_hashes: tuple[str, ...]


def revoke_knowledge_agent_grant(
    session: Session, grant_id: str, *, revoked_at: datetime
) -> KnowledgeAgentGrantRevocation:
    """Mark the grant revoked, retire its bearer row and delete its refresh tokens.

    Idempotent. Returns the bearer hashes that were live, so the caller can drop them from the
    token cache, and whether this call is the one that revoked the grant.
    """
    result = session.execute(
        sa.update(KnowledgeAgentGrant)
        .where(KnowledgeAgentGrant.id == grant_id, KnowledgeAgentGrant.revoked_at.is_(None))
        .values(revoked_at=revoked_at)
        .execution_options(synchronize_session=False)
    )
    hashes = session.scalars(
        sa.select(OAuthAccessToken.token_hash).where(
            OAuthAccessToken.knowledge_agent_grant_id == grant_id,
            OAuthAccessToken.token_hash.is_not(None),
        )
    ).all()
    session.execute(
        sa.update(OAuthAccessToken)
        .where(OAuthAccessToken.knowledge_agent_grant_id == grant_id, OAuthAccessToken.revoked_at.is_(None))
        .values(revoked_at=revoked_at, token_hash=None)
        .execution_options(synchronize_session=False)
    )
    session.execute(
        sa.delete(KnowledgeAgentRefreshToken)
        .where(KnowledgeAgentRefreshToken.grant_id == grant_id)
        .execution_options(synchronize_session=False)
    )
    return KnowledgeAgentGrantRevocation(
        newly_revoked=isinstance(result, CursorResult) and result.rowcount == 1,
        token_hashes=tuple(token_hash for token_hash in hashes if token_hash),
    )
