from unittest.mock import MagicMock, patch
import urllib.parse
import pytest
from libs.oauth import KeystoneOAuth, OAuthUserInfo

class TestKeystoneOAuth:
    @pytest.fixture
    def keystone_oauth(self):
        return KeystoneOAuth(
            client_id="client_id",
            client_secret="client_secret",
            redirect_uri="http://localhost/callback",
            server_url="https://keystone.example.com"
        )

    def test_get_authorization_url(self, keystone_oauth):
        url = keystone_oauth.get_authorization_url(invite_token="invite123")
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qs(parsed.query)
        
        assert parsed.scheme == "https"
        assert parsed.netloc == "keystone.example.com"
        assert parsed.path == "/api/v1/auth/oidc/auth"
        assert params["client_id"] == ["client_id"]
        assert params["response_type"] == ["code"]
        assert params["redirect_uri"] == ["http://localhost/callback"]
        assert params["scope"] == ["openid profile email"]
        assert params["state"] == ["invite123"]

    @patch("libs.oauth.httpx.post")
    def test_get_access_token(self, mock_post, keystone_oauth):
        mock_response = MagicMock()
        mock_response.json.return_value = {"access_token": "token123"}
        mock_post.return_value = mock_response
        
        token = keystone_oauth.get_access_token("code123")
        
        assert token == "token123"
        mock_post.assert_called_once_with(
            "https://keystone.example.com/api/v1/auth/oidc/token",
            data={
                "grant_type": "authorization_code",
                "client_id": "client_id",
                "client_secret": "client_secret",
                "code": "code123",
                "redirect_uri": "http://localhost/callback",
            }
        )

    @patch("libs.oauth.httpx.get")
    def test_get_raw_user_info(self, mock_get, keystone_oauth):
        mock_response = MagicMock()
        mock_response.json.return_value = {"sub": "user1", "name": "User One", "email": "user@example.com"}
        mock_get.return_value = mock_response
        
        info = keystone_oauth.get_raw_user_info("token123")
        
        assert info["sub"] == "user1"
        mock_get.assert_called_once_with(
            "https://keystone.example.com/api/v1/auth/oidc/user",
            headers={"Authorization": "Bearer token123"}
        )

    def test_transform_user_info(self, keystone_oauth):
        raw_info = {"sub": "user1", "name": "User One", "email": "user@example.com"}
        user_info = keystone_oauth._transform_user_info(raw_info)
        
        assert isinstance(user_info, OAuthUserInfo)
        assert user_info.id == "user1"
        assert user_info.name == "User One"
        assert user_info.email == "user@example.com"

    def test_transform_user_info_fallback_id(self, keystone_oauth):
        raw_info = {"id": "user2", "name": "User Two", "email": "user2@example.com"}
        user_info = keystone_oauth._transform_user_info(raw_info)
        
        assert user_info.id == "user2"
