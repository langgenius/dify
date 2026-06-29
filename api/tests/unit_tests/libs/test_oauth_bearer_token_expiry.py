"""Resolver-level expiry signalling.

An expired token must be distinguishable from an unknown/revoked one: the
resolver raises ``TokenExpiredError`` for expiry and returns ``None`` for
everything else. The signal survives the negative-cache window via a distinct
``expired`` marker so a retry inside ``NEGATIVE_TTL`` still reports expiry.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest

from libs.oauth_bearer import (
    OAuthAccessTokenResolver,
    TokenExpiredError,
)


def _row(expires_at: datetime):
    row = MagicMock()
    row.id = "11111111-1111-1111-1111-111111111111"
    row.account_id = "22222222-2222-2222-2222-222222222222"
    row.prefix = "dfoa_"
    row.subject_email = None
    row.subject_issuer = None
    row.client_id = None
    row.expires_at = expires_at
    return row


def _resolver(redis: MagicMock, db_row=None) -> OAuthAccessTokenResolver:
    session = MagicMock()
    session.query.return_value.filter.return_value.one_or_none.return_value = db_row
    session.execute.return_value.rowcount = 1
    return OAuthAccessTokenResolver(session_factory=lambda: session, redis_client=redis)


def test_resolve_raises_token_expired_for_expired_db_row():
    redis = MagicMock()
    redis.get.return_value = None  # cache miss -> DB path
    past = datetime.now(UTC) - timedelta(minutes=1)
    resolver = _resolver(redis, db_row=_row(past))

    with pytest.raises(TokenExpiredError):
        resolver.for_account().resolve("expiredhash")


def test_resolve_raises_token_expired_for_expired_cache_marker():
    redis = MagicMock()
    redis.get.return_value = b"expired"  # negative-cache replay
    resolver = _resolver(redis, db_row=None)

    with pytest.raises(TokenExpiredError):
        resolver.for_account().resolve("expiredhash")


def test_resolve_returns_none_for_invalid_cache_marker():
    redis = MagicMock()
    redis.get.return_value = b"invalid"
    resolver = _resolver(redis, db_row=None)

    assert resolver.for_account().resolve("revokedhash") is None


def test_resolve_returns_none_for_unknown_token():
    redis = MagicMock()
    redis.get.return_value = None  # cache miss
    resolver = _resolver(redis, db_row=None)  # no DB row

    assert resolver.for_account().resolve("unknownhash") is None


def test_hard_expire_caches_expired_marker_not_invalid():
    redis = MagicMock()
    redis.get.return_value = None
    past = datetime.now(UTC) - timedelta(minutes=1)
    resolver = _resolver(redis, db_row=_row(past))

    with pytest.raises(TokenExpiredError):
        resolver.for_account().resolve("expiredhash")

    setex_values = [call.args[2] for call in redis.setex.call_args_list]
    assert "expired" in setex_values
    assert "invalid" not in setex_values
