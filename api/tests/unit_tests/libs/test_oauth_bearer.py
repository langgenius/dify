from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from redis import Redis
from sqlalchemy.orm import sessionmaker

from constants.oauth_bearer import TOKEN_CACHE_KEY_FMT, OAuthScope, Scope, SubjectType, TokenType
from libs.oauth_bearer import (
    BearerAuthenticator,
    InvalidBearerError,
    OAuthAccessTokenResolver,
    ResolvedRow,
    Resolver,
    _TokenTypeResolver,
    sha256_hex,
)

"""The bearer catalog: which subject each token type serves and what it may do."""


def _row(account_id: uuid.UUID | None, oauth_scopes: frozenset[OAuthScope] | None = None) -> ResolvedRow:
    return ResolvedRow(
        subject_email="who@example.com",
        subject_issuer="issuer",
        account_id=account_id,
        client_id="client",
        token_id=uuid.uuid4(),
        expires_at=datetime.now(UTC),
        oauth_scopes=oauth_scopes,
    )


@pytest.mark.parametrize("token_type", list(TokenType), ids=lambda t: t.value)
def test_a_row_matches_its_subject_only_when_its_account_binding_agrees(token_type: TokenType) -> None:
    """Every token type, present or future, is held to the binding its subject declares."""
    resolver = _TokenTypeResolver(OAuthAccessTokenResolver(sessionmaker(), Redis()), token_type)
    bound = token_type.subject.bound_to_account
    assert resolver._matches_subject(_row(uuid.uuid4())) is bound
    assert resolver._matches_subject(_row(None)) is not bound


def test_scope_sets_are_pinned_exactly() -> None:
    """`dfoa_` relies on the `Scope.FULL` umbrella; the explicit scopes are reserved for `dfoe_`."""
    assert SubjectType.ACCOUNT.scopes == frozenset({Scope.FULL})
    assert SubjectType.EXTERNAL_SSO.scopes == frozenset({Scope.APPS_RUN, Scope.APPS_READ_PERMITTED_EXTERNAL})


@pytest.mark.parametrize(
    ("token", "expected"),
    [
        ("dfoa_abc", TokenType.OAUTH_ACCOUNT),
        ("dfoe_abc", TokenType.OAUTH_EXTERNAL_SSO),
        ("dfp_abc", None),
        ("", None),
    ],
)
def test_for_token_classifies_by_prefix_and_refuses_the_rest(token: str, expected: TokenType | None) -> None:
    assert TokenType.for_token(token) is expected


def _authenticator_with(resolver: Resolver) -> BearerAuthenticator:
    return BearerAuthenticator({TokenType.OAUTH_ACCOUNT: resolver})


@patch("libs.oauth_bearer.enforce_bearer_rate_limit")
def test_rate_limit_called_before_resolve(rl: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    call_order: list[str] = []
    rl.side_effect = lambda _h: call_order.append("rl")
    resolver = OAuthAccessTokenResolver(sessionmaker(), Redis())
    monkeypatch.setattr(resolver, "cache_get", lambda _h: call_order.append("resolve") or "invalid")
    auth = _authenticator_with(resolver.for_token_type(TokenType.OAUTH_ACCOUNT))

    with pytest.raises(InvalidBearerError):
        auth.authenticate("dfoa_xyz")

    assert call_order == ["rl", "resolve"], f"expected rl before resolve, got {call_order}"


# An unknown prefix is refused before the rate limit; a known prefix is rate limited, then refused.
@pytest.mark.parametrize(
    ("token", "rate_limited"),
    [("zzz_xyz", False), ("dfoa_revoked", True)],
    ids=["unknown prefix", "revoked"],
)
@patch("libs.oauth_bearer.enforce_bearer_rate_limit")
def test_every_refusal_raises_the_generic_invalid_bearer(
    rl: MagicMock, token: str, rate_limited: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    resolver = OAuthAccessTokenResolver(sessionmaker(), Redis())
    monkeypatch.setattr(resolver, "cache_get", lambda _h: "invalid")
    auth = _authenticator_with(resolver.for_token_type(TokenType.OAUTH_ACCOUNT))
    with pytest.raises(InvalidBearerError) as exc:
        auth.authenticate(token)
    assert str(exc.value) == "invalid_bearer"
    assert rl.called is rate_limited


@dataclass
class _FakeRedis:
    store: dict[str, str] = field(default_factory=dict)

    def get(self, key: str) -> str | None:
        return self.store.get(key)

    def setex(self, key: str, _ttl: int, value: str) -> None:
        self.store[key] = value

    def delete(self, *keys: str) -> None:
        for key in keys:
            self.store.pop(key, None)


@dataclass
class _FakeTokenRow:
    expires_at: datetime
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    account_id: uuid.UUID = field(default_factory=uuid.uuid4)
    prefix: str = TokenType.OAUTH_ACCOUNT.prefix
    subject_email: str = "who@example.com"
    subject_issuer: str = "dify:account"
    client_id: str = "client"
    scope: frozenset[OAuthScope] | None = None


@dataclass
class _FakeSession:
    row: _FakeTokenRow
    rowcount: int = 1

    def query(self, *_args: object) -> _FakeSession:
        return self

    def filter(self, *_args: object) -> _FakeSession:
        return self

    def one_or_none(self) -> _FakeTokenRow:
        return self.row

    def execute(self, _stmt: object) -> _FakeSession:
        return self

    def commit(self) -> None:
        pass


def test_cached_row_past_expiry_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("libs.oauth_bearer.enforce_bearer_rate_limit", lambda _h: None)
    db_row = _FakeTokenRow(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    redis = _FakeRedis()
    oauth = OAuthAccessTokenResolver(lambda: _FakeSession(db_row), redis)
    token_hash = sha256_hex("dfoa_stale")
    oauth.cache_set_positive(token_hash, _row(uuid.uuid4()))
    auth = _authenticator_with(oauth.for_token_type(TokenType.OAUTH_ACCOUNT))

    with pytest.raises(InvalidBearerError):
        auth.authenticate("dfoa_stale")

    assert redis.store[TOKEN_CACHE_KEY_FMT.format(hash=token_hash)] == "invalid"


@pytest.mark.parametrize(
    "oauth_scopes",
    [None, frozenset({OAuthScope.READ}), frozenset(OAuthScope)],
    ids=["unrestricted", "read", "read-write"],
)
def test_cache_round_trips_the_oauth_scopes(oauth_scopes: frozenset[OAuthScope] | None) -> None:
    row = _row(uuid.uuid4(), oauth_scopes)

    assert ResolvedRow.from_cache(row.to_cache()) == row


def test_cache_entry_from_before_scopes_reads_as_unrestricted() -> None:
    entry = _row(uuid.uuid4(), frozenset({OAuthScope.READ})).to_cache()
    del entry["oauth_scopes"]

    assert ResolvedRow.from_cache(entry).oauth_scopes is None


def test_cache_entry_naming_an_unknown_scope_is_a_miss() -> None:
    redis = _FakeRedis()
    oauth = OAuthAccessTokenResolver(sessionmaker(), redis)
    token_hash = sha256_hex("dfoa_odd")
    entry = _row(uuid.uuid4()).to_cache() | {"oauth_scopes": ["admin"]}
    redis.store[TOKEN_CACHE_KEY_FMT.format(hash=token_hash)] = json.dumps(entry)

    assert oauth.cache_get(token_hash) is None


def test_resolver_carries_the_rows_scopes_through_the_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("libs.oauth_bearer.enforce_bearer_rate_limit", lambda _h: None)
    db_row = _FakeTokenRow(expires_at=datetime.now(UTC) + timedelta(hours=1), scope=frozenset({OAuthScope.READ}))
    oauth = OAuthAccessTokenResolver(lambda: _FakeSession(db_row), _FakeRedis())
    auth = _authenticator_with(oauth.for_token_type(TokenType.OAUTH_ACCOUNT))

    from_row = auth.authenticate("dfoa_read")
    db_row.scope = None
    from_cache = auth.authenticate("dfoa_read")

    assert from_row.oauth_scopes == from_cache.oauth_scopes == frozenset({OAuthScope.READ})
