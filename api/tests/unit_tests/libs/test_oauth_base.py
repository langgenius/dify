from collections.abc import Callable
from urllib.parse import parse_qs, urlsplit

import pytest
from itsdangerous import TimestampSigner

from libs.oauth import (
    EndUserOAuthState,
    GitHubOAuth,
    GoogleOAuth,
    OAuth,
    decode_end_user_oauth_state,
    decode_oauth_state,
    encode_end_user_oauth_state,
    encode_oauth_state,
)


def test_oauth_base_methods_raise_not_implemented() -> None:
    oauth = OAuth(client_id="id", client_secret="sec", redirect_uri="uri")

    with pytest.raises(NotImplementedError):
        oauth.get_authorization_url()

    with pytest.raises(NotImplementedError):
        oauth.get_access_token("code")

    with pytest.raises(NotImplementedError):
        oauth.get_raw_user_info("token")

    with pytest.raises(NotImplementedError):
        oauth._transform_user_info({})


def test_oauth_state_round_trips_login_context() -> None:
    state = encode_oauth_state(
        invite_token="invite-123",
        timezone="Asia/Shanghai",
        language="zh-Hans",
        redirect_url="/apps?category=workflow",
    )

    assert decode_oauth_state(state) == {
        "invite_token": "invite-123",
        "timezone": "Asia/Shanghai",
        "language": "zh-Hans",
        "redirect_url": "/apps?category=workflow",
    }


def test_oauth_state_returns_empty_payload_for_invalid_state() -> None:
    assert decode_oauth_state("invalid-state") == {}


def test_end_user_oauth_state_is_signed_and_expires(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(SECRET_KEY="end-user-state-test-key")
    now = 1000
    monkeypatch.setattr(TimestampSigner, "get_timestamp", lambda _self: now)
    original = EndUserOAuthState(
        provider="github", nonce="nonce", context={"redirect_url": "/chatbot/code?q=a%26b#result"}
    )
    state = encode_end_user_oauth_state(original)
    assert decode_end_user_oauth_state(state) == original
    with pytest.raises(ValueError, match="Invalid or expired"):
        decode_end_user_oauth_state(state + "tampered")
    now += 601
    with pytest.raises(ValueError, match="Invalid or expired"):
        decode_end_user_oauth_state(state)


@pytest.mark.parametrize("provider", [GitHubOAuth, GoogleOAuth])
def test_provider_authorization_preserves_protected_state(provider: type[OAuth]) -> None:
    oauth = provider(client_id="client", client_secret="secret", redirect_uri="https://api.example.com/callback")
    url = oauth.get_authorization_url(state="end_user.signed-context", redirect_url="/ignored-legacy-target")
    assert parse_qs(urlsplit(url).query)["state"] == ["end_user.signed-context"]
