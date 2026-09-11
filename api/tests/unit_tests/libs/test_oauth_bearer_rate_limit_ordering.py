from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from constants.oauth_bearer import Scope, SubjectType, TokenType
from libs import oauth_bearer
from libs.oauth_bearer import BearerAuthenticator, InvalidBearerError, TokenKind, TokenKindRegistry


@dataclass
class _Resolver:
    call_order: list[str] | None = None
    calls: list[str] = field(default_factory=list)

    def resolve(self, token_hash: str):
        self.calls.append(token_hash)
        if self.call_order is not None:
            self.call_order.append("resolve")


def _registry_with_resolver(resolver: _Resolver) -> TokenKindRegistry:
    return TokenKindRegistry(
        [
            TokenKind(
                prefix="dfoa_",
                subject_type=SubjectType.ACCOUNT,
                scopes=frozenset({Scope.FULL}),
                token_type=TokenType.OAUTH_ACCOUNT,
                resolver=resolver,
            )
        ]
    )


def test_rate_limit_called_on_unknown_revoked_token(monkeypatch: pytest.MonkeyPatch) -> None:
    rate_limit_calls: list[str] = []
    monkeypatch.setattr(oauth_bearer, "enforce_bearer_rate_limit", rate_limit_calls.append)
    resolver = _Resolver()
    auth = BearerAuthenticator(_registry_with_resolver(resolver))

    with pytest.raises(InvalidBearerError):
        auth.authenticate("dfoa_revokedtoken123")

    assert len(rate_limit_calls) == 1
    assert len(resolver.calls) == 1


def test_rate_limit_called_before_resolve(monkeypatch: pytest.MonkeyPatch) -> None:
    call_order: list[str] = []
    monkeypatch.setattr(oauth_bearer, "enforce_bearer_rate_limit", lambda _token_hash: call_order.append("rl"))
    auth = BearerAuthenticator(_registry_with_resolver(_Resolver(call_order=call_order)))

    with pytest.raises(InvalidBearerError):
        auth.authenticate("dfoa_xyz")

    assert call_order == ["rl", "resolve"]


def test_unknown_prefix_raises_generic_invalid_bearer() -> None:
    auth = BearerAuthenticator(_registry_with_resolver(_Resolver()))

    with pytest.raises(InvalidBearerError) as exc:
        auth.authenticate("zzz_xyz")

    assert str(exc.value) == "invalid_bearer"


def test_revoked_token_raises_generic_invalid_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(oauth_bearer, "enforce_bearer_rate_limit", lambda _token_hash: None)
    auth = BearerAuthenticator(_registry_with_resolver(_Resolver()))

    with pytest.raises(InvalidBearerError) as exc:
        auth.authenticate("dfoa_revoked")

    assert str(exc.value) == "invalid_bearer"
