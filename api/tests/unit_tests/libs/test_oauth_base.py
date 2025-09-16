import pytest

from libs.oauth import OAuth


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
