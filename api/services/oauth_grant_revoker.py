"""Grant-wide revocation for OpenAPI OAuth logins, and the RFC 7009 revoke endpoint behind it.

A grant is one login, identified by its ``GrantKey``. Revoking it revokes its
access row and deletes every refresh token it holds.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TOKEN_CACHE_KEY_FMT
from extensions.ext_redis import RedisClientWrapper
from libs.oauth_bearer import sha256_hex
from repositories.oauth_device_token_repository import (
    OwnedGrant,
    find_live_access_grant,
    lock_account,
    revoke_grant_rows,
)
from repositories.oauth_refresh_token_repository import SQLAlchemyOAuthRefreshTokenRepository
from services.oauth_client_auth import authenticate_client
from services.oauth_clients import OAuthClientRegistry
from services.oauth_device_contracts import GrantKey
from services.oauth_token_contracts import TokenEndpointError, TokenErrorCode


class GrantRevoker:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        redis: RedisClientWrapper,
        refresh: SQLAlchemyOAuthRefreshTokenRepository,
    ) -> None:
        self._session_factory = session_factory
        self._redis = redis
        self._refresh = refresh

    def revoke_grant(self, grant: GrantKey, *, account_id: str | None) -> None:
        """Revoke the grant ``account_id`` holds; None for an external-SSO grant."""
        with self._session_factory() as session, session.begin():
            # The account lock orders this after any refresh of the grant already
            # under way, and makes later ones see the refresh tokens gone.
            if account_id is not None:
                lock_account(session, account_id)
            hashes = revoke_grant_rows(session, grant, account_id=account_id, now=datetime.now(UTC))
        if hashes:
            self._redis.delete(*(TOKEN_CACHE_KEY_FMT.format(hash=token_hash) for token_hash in hashes))

    def revoke_by_token(self, token: str, *, client_id: str) -> None:
        """Revoke the grant behind an access or refresh token issued to ``client_id``.

        An unknown token, or one issued to another client, is ignored (RFC 7009 §2.1, §2.2).
        """
        owned = self._grant_for(token)
        if owned is None:
            return
        if owned.grant.client_id != client_id:
            return
        self.revoke_grant(owned.grant, account_id=owned.account_id)

    def _grant_for(self, token: str) -> OwnedGrant | None:
        with self._session_factory() as session:
            owned = find_live_access_grant(session, sha256_hex(token))
        if owned is not None:
            return owned
        # Any refresh token of the grant ends it, rotated or not: refresh
        # grants are per login, so an old one names no other session.
        record = self._refresh.find(token)
        if record is None:
            return None
        return OwnedGrant(grant=record.grant_key, account_id=record.account_id)


class TokenRevoker(Protocol):
    def revoke_by_token(self, token: str, *, client_id: str) -> None: ...


@dataclass(frozen=True)
class RevokeRequest:
    client_id: str | None
    client_secret: str | None
    token: str | None
    source_ip: str


class OAuthRevocationService:
    def __init__(self, *, clients: OAuthClientRegistry, grants: TokenRevoker) -> None:
        self._clients = clients
        self._grants = grants

    def revoke(self, request: RevokeRequest) -> None:
        client = authenticate_client(
            self._clients,
            client_id=request.client_id,
            client_secret=request.client_secret,
            source_ip=request.source_ip,
        )
        if not request.token:
            raise TokenEndpointError(TokenErrorCode.INVALID_REQUEST)
        self._grants.revoke_by_token(request.token, client_id=client.storage_client_id)
