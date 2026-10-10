from __future__ import annotations

from unittest.mock import patch

import pytest
from redis import Redis
from sqlalchemy.orm import sessionmaker

from constants.oauth_bearer import TokenType
from libs.oauth_bearer import BearerAuthenticator, InvalidBearerError, OAuthAccessTokenResolver, Resolver


def _authenticator_with(resolver: Resolver) -> BearerAuthenticator:
    return BearerAuthenticator({TokenType.OAUTH_ACCOUNT: resolver})


@patch("libs.oauth_bearer.enforce_bearer_rate_limit")
def test_rate_limit_called_before_resolve(rl, monkeypatch: pytest.MonkeyPatch):
    call_order: list[str] = []
    rl.side_effect = lambda _h: call_order.append("rl")
    resolver = OAuthAccessTokenResolver(sessionmaker(), Redis())
    monkeypatch.setattr(resolver, "cache_get", lambda _h: call_order.append("resolve") or "invalid")
    auth = _authenticator_with(resolver.for_token_type(TokenType.OAUTH_ACCOUNT))

    with pytest.raises(InvalidBearerError):
        auth.authenticate("dfoa_xyz")

    assert call_order == ["rl", "resolve"], f"expected rl before resolve, got {call_order}"


@pytest.mark.parametrize("token", ["zzz_xyz", "dfoa_revoked"], ids=["unknown prefix", "revoked"])
@patch("libs.oauth_bearer.enforce_bearer_rate_limit")
def test_every_refusal_raises_the_generic_invalid_bearer(rl, token: str, monkeypatch: pytest.MonkeyPatch):
    resolver = OAuthAccessTokenResolver(sessionmaker(), Redis())
    monkeypatch.setattr(resolver, "cache_get", lambda _h: "invalid")
    auth = _authenticator_with(resolver.for_token_type(TokenType.OAUTH_ACCOUNT))
    with pytest.raises(InvalidBearerError) as exc:
        auth.authenticate(token)
    assert str(exc.value) == "invalid_bearer"
