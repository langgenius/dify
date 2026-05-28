from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from libs.oauth_bearer import (
    BearerAuthenticator,
    InvalidBearerError,
    Scope,
    SubjectType,
    TokenKind,
    TokenKindRegistry,
    TokenType,
)


def _registry_with_resolver(resolver) -> TokenKindRegistry:
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


@patch("libs.oauth_bearer.enforce_bearer_rate_limit")
def test_rate_limit_called_on_unknown_revoked_token(rl):
    resolver = MagicMock()
    resolver.resolve.return_value = None
    auth = BearerAuthenticator(_registry_with_resolver(resolver))

    with pytest.raises(InvalidBearerError):
        auth.authenticate("dfoa_revokedtoken123")

    rl.assert_called_once()
    resolver.resolve.assert_called_once()


@patch("libs.oauth_bearer.enforce_bearer_rate_limit")
def test_rate_limit_called_before_resolve(rl):
    call_order: list[str] = []
    rl.side_effect = lambda _h: call_order.append("rl")
    resolver = MagicMock()
    resolver.resolve.side_effect = lambda _h: call_order.append("resolve") or None
    auth = BearerAuthenticator(_registry_with_resolver(resolver))

    with pytest.raises(InvalidBearerError):
        auth.authenticate("dfoa_xyz")

    assert call_order == ["rl", "resolve"], f"expected rl before resolve, got {call_order}"


def test_unknown_prefix_raises_generic_invalid_bearer():
    auth = BearerAuthenticator(
        TokenKindRegistry(
            [
                TokenKind(
                    prefix="dfoa_",
                    subject_type=SubjectType.ACCOUNT,
                    scopes=frozenset({Scope.FULL}),
                    token_type=TokenType.OAUTH_ACCOUNT,
                    resolver=MagicMock(),
                )
            ]
        )
    )
    with pytest.raises(InvalidBearerError) as exc:
        auth.authenticate("zzz_xyz")
    assert str(exc.value) == "invalid_bearer"


@patch("libs.oauth_bearer.enforce_bearer_rate_limit")
def test_revoked_token_raises_generic_invalid_bearer(rl):
    resolver = MagicMock()
    resolver.resolve.return_value = None
    auth = BearerAuthenticator(_registry_with_resolver(resolver))
    with pytest.raises(InvalidBearerError) as exc:
        auth.authenticate("dfoa_revoked")
    assert str(exc.value) == "invalid_bearer"
