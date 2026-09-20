from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from libs.oauth_bearer import BearerAuthenticator, InvalidBearerError, TokenType


def _authenticator_with(resolver) -> BearerAuthenticator:
    return BearerAuthenticator({TokenType.OAUTH_ACCOUNT: resolver})


@patch("libs.oauth_bearer.enforce_bearer_rate_limit")
def test_rate_limit_called_before_resolve(rl):
    call_order: list[str] = []
    rl.side_effect = lambda _h: call_order.append("rl")
    resolver = MagicMock()
    resolver.resolve.side_effect = lambda _h: call_order.append("resolve") or None
    auth = _authenticator_with(resolver)

    with pytest.raises(InvalidBearerError):
        auth.authenticate("dfoa_xyz")

    assert call_order == ["rl", "resolve"], f"expected rl before resolve, got {call_order}"


@pytest.mark.parametrize("token", ["zzz_xyz", "dfoa_revoked"], ids=["unknown prefix", "revoked"])
@patch("libs.oauth_bearer.enforce_bearer_rate_limit")
def test_every_refusal_raises_the_generic_invalid_bearer(rl, token: str):
    resolver = MagicMock()
    resolver.resolve.return_value = None
    auth = _authenticator_with(resolver)
    with pytest.raises(InvalidBearerError) as exc:
        auth.authenticate(token)
    assert str(exc.value) == "invalid_bearer"
