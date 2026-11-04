from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from redis import Redis
from sqlalchemy.orm import sessionmaker

from constants.oauth_bearer import Scope, SubjectType, TokenType
from libs.oauth_bearer import (
    BearerAuthenticator,
    InvalidBearerError,
    OAuthAccessTokenResolver,
    ResolvedRow,
    Resolver,
    _TokenTypeResolver,
)

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
