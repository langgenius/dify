from __future__ import annotations

import json
import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from redis import Redis
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TOKEN_CACHE_KEY_FMT, Scope, SubjectType, TokenType
from extensions.ext_redis import RedisClientWrapper
from libs.oauth_bearer import (
    POSITIVE_TTL_SECONDS,
    BearerAuthenticator,
    InvalidBearerError,
    OAuthAccessTokenResolver,
    ResolvedRow,
    Resolver,
    _TokenTypeResolver,
)
from models import OAuthAccessToken

"""The bearer catalog: which subject each token type serves and what it may do."""


def _row(account_id: uuid.UUID | None) -> ResolvedRow:
    return ResolvedRow(
        subject_email="who@example.com",
        subject_issuer="issuer",
        account_id=account_id,
        client_id="client",
        token_id=uuid.uuid4(),
        expires_at=datetime.now(UTC),
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


@pytest.mark.parametrize("account_id", [None, uuid.UUID("12345678-1234-5678-1234-567812345678")])
@pytest.mark.parametrize("encoding", ["str", "bytes", "bytearray"])
def test_token_cache_round_trip(
    redis_transport: tuple[RedisClientWrapper, MagicMock], account_id: uuid.UUID | None, encoding: str
) -> None:
    row = _row(account_id)
    payload = json.dumps(row.to_cache())
    raw: str | bytes | bytearray = payload
    if encoding == "bytes":
        raw = payload.encode()
    elif encoding == "bytearray":
        raw = bytearray(payload.encode())
    redis, commands = redis_transport
    commands.return_value = raw
    resolver = OAuthAccessTokenResolver(sessionmaker(), redis)

    assert resolver.cache_get("token-hash") == row


def test_token_cache_accepts_legacy_entries_without_client_id(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    row = replace(_row(None), client_id=None, expires_at=None)
    payload = row.to_cache()
    del payload["client_id"]
    redis, commands = redis_transport
    commands.return_value = json.dumps(payload)
    resolver = OAuthAccessTokenResolver(sessionmaker(), redis)

    assert resolver.cache_get("token-hash") == row


@pytest.mark.parametrize("raw", [None, "invalid", b"invalid", bytearray(b"invalid")])
def test_token_cache_preserves_miss_and_negative_entries(
    redis_transport: tuple[RedisClientWrapper, MagicMock], raw: str | bytes | bytearray | None
) -> None:
    redis, commands = redis_transport
    commands.return_value = raw
    resolver = OAuthAccessTokenResolver(sessionmaker(), redis)

    assert resolver.cache_get("token-hash") == (None if raw is None else "invalid")


@pytest.mark.parametrize(
    "raw",
    ["not json", "null", "[]", "42", '"text"', "{}", b"\xff"],
)
def test_token_cache_treats_malformed_payload_as_miss(
    redis_transport: tuple[RedisClientWrapper, MagicMock], raw: str | bytes
) -> None:
    redis, commands = redis_transport
    commands.return_value = raw
    resolver = OAuthAccessTokenResolver(sessionmaker(), redis)

    assert resolver.cache_get("token-hash") is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("subject_email", 42),
        ("subject_issuer", []),
        ("account_id", 42),
        ("account_id", "not a uuid"),
        ("client_id", {}),
        ("token_id", None),
        ("token_id", "not a uuid"),
        ("expires_at", 42),
        ("expires_at", "not a timestamp"),
    ],
)
def test_token_cache_treats_invalid_fields_as_miss(
    redis_transport: tuple[RedisClientWrapper, MagicMock], field: str, value: object
) -> None:
    payload: dict[str, object] = dict(_row(None).to_cache())
    payload[field] = value
    redis, commands = redis_transport
    commands.return_value = json.dumps(payload)
    resolver = OAuthAccessTokenResolver(sessionmaker(), redis)

    assert resolver.cache_get("token-hash") is None


def test_token_resolver_recovers_from_malformed_cache(
    sqlite_session_factory: sessionmaker[Session], redis_transport: tuple[RedisClientWrapper, MagicMock]
) -> None:
    account_id = uuid.uuid4()
    token = OAuthAccessToken(
        subject_email="who@example.com",
        subject_issuer="dify:account",
        account_id=str(account_id),
        client_id="client",
        device_label="test-device",
        prefix=TokenType.OAUTH_ACCOUNT.prefix,
        token_hash="token-hash",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    redis, commands = redis_transport
    commands.return_value = "[]"

    with sqlite_session_factory() as session:
        session.add(token)
        session.flush()
        resolver = OAuthAccessTokenResolver(lambda: session, redis).for_token_type(TokenType.OAUTH_ACCOUNT)

        resolved = resolver.resolve("token-hash")

        assert resolved is not None
        assert resolved.token_id == uuid.UUID(token.id)
        assert resolved.subject_email == token.subject_email
        assert resolved.account_id == account_id
    commands.assert_called_with(
        "SETEX", TOKEN_CACHE_KEY_FMT.format(hash="token-hash"), POSITIVE_TTL_SECONDS, json.dumps(resolved.to_cache())
    )


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
