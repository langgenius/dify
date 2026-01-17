from unittest.mock import MagicMock, patch
import urllib.parse
import pytest
from libs.oauth import CasdoorOAuth, OAuthUserInfo

class TestCasdoorOAuth:
    @pytest.fixture
    def casdoor_oauth(self):
        return CasdoorOAuth(
            client_id="client_id",
            client_secret="client_secret",
            redirect_uri="http://localhost/callback",
            server_url="https://casdoor.example.com"
        )

    def test_get_authorization_url(self, casdoor_oauth):
        url = casdoor_oauth.get_authorization_url(invite_token="invite123")
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qs(parsed.query)
        
        assert parsed.scheme == "https"
        assert parsed.netloc == "casdoor.example.com"
        assert parsed.path == "/login/oauth/authorize"
        assert params["client_id"] == ["client_id"]
        assert params["response_type"] == ["code"]
        assert params["redirect_uri"] == ["http://localhost/callback"]
        assert params["scope"] == ["openid profile email"]
        assert params["state"] == ["invite123"]

    @patch("libs.oauth.httpx.post")
    def test_get_access_token(self, mock_post, casdoor_oauth):
        mock_response = MagicMock()
        mock_response.json.return_value = {"access_token": "token123"}
        mock_post.return_value = mock_response
        
        token = casdoor_oauth.get_access_token("code123")
        
        assert token == "token123"
        mock_post.assert_called_once_with(
            "https://casdoor.example.com/api/login/oauth/access_token",
            data={
                "grant_type": "authorization_code",
                "client_id": "client_id",
                "client_secret": "client_secret",
                "code": "code123",
                "redirect_uri": "http://localhost/callback",
            }
        )

    @patch("libs.oauth.httpx.get")
    def test_get_raw_user_info(self, mock_get, casdoor_oauth):
        mock_response = MagicMock()
        mock_response.json.return_value = {"sub": "user1", "name": "User One", "email": "user@example.com"}
        mock_get.return_value = mock_response
        
        info = casdoor_oauth.get_raw_user_info("token123")
        
        assert info["sub"] == "user1"
        mock_get.assert_called_once_with(
            "https://casdoor.example.com/api/userinfo",
            headers={"Authorization": "Bearer token123"}
        )

    def test_transform_user_info(self, casdoor_oauth):
        raw_info = {"sub": "user1", "name": "User One", "email": "user@example.com"}
        user_info = casdoor_oauth._transform_user_info(raw_info)
        
        assert isinstance(user_info, OAuthUserInfo)
        assert user_info.id == "user1"
        assert user_info.name == "User One"
        assert user_info.email == "user@example.com"

    def test_transform_user_info_fallback_id(self, casdoor_oauth):
        raw_info = {"id": "user2", "name": "User Two", "email": "user2@example.com"}
        user_info = casdoor_oauth._transform_user_info(raw_info)
        
        assert user_info.id == "user2"
