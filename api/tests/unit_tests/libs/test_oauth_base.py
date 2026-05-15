import pytest

from libs.oauth import OAuth, decode_oauth_state, encode_oauth_state


def test_oauth_base_methods_raise_not_implemented():
    oauth = OAuth(client_id="id", client_secret="sec", redirect_uri="uri")

    with pytest.raises(NotImplementedError):
        oauth.get_authorization_url()

    with pytest.raises(NotImplementedError):
        oauth.get_access_token("code")

    with pytest.raises(NotImplementedError):
        oauth.get_raw_user_info("token")

    with pytest.raises(NotImplementedError):
        oauth._transform_user_info({})


def test_oauth_state_round_trips_invite_token_timezone_and_language():
    state = encode_oauth_state(invite_token="invite-123", timezone="Asia/Shanghai", language="zh-Hans")

    assert decode_oauth_state(state) == {
        "invite_token": "invite-123",
        "timezone": "Asia/Shanghai",
        "language": "zh-Hans",
    }


def test_oauth_state_returns_empty_payload_for_invalid_state():
    assert decode_oauth_state("invalid-state") == {}
