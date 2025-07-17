import urllib.parse
from unittest.mock import MagicMock, patch

import pytest
import requests

from libs.oauth import GitHubOAuth, GoogleOAuth, OAuthUserInfo


class BaseOAuthTest:
    """Base class for OAuth provider tests with common fixtures"""

    @pytest.fixture
    def oauth_config(self):
        return {
            "client_id": "test_client_id",
            "client_secret": "test_client_secret",
            "redirect_uri": "http://localhost/callback",
        }

    @pytest.fixture
    def mock_response(self):
        response = MagicMock()
        response.json.return_value = {}
        return response

    def parse_auth_url(self, url):
        """Helper to parse authorization URL"""
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qs(parsed.query)
        return parsed, params


class TestGitHubOAuth(BaseOAuthTest):
    @pytest.fixture
    def oauth(self, oauth_config):
        return GitHubOAuth(oauth_config["client_id"], oauth_config["client_secret"], oauth_config["redirect_uri"])

    @pytest.mark.parametrize(
        ("invite_token", "expected_state"),
        [
            (None, None),
            ("test_invite_token", "test_invite_token"),
            ("", None),
        ],
    )
    def test_should_generate_authorization_url_correctly(self, oauth, oauth_config, invite_token, expected_state):
        url = oauth.get_authorization_url(invite_token)
        parsed, params = self.parse_auth_url(url)

        assert parsed.scheme == "https"
        assert parsed.netloc == "github.com"
        assert parsed.path == "/login/oauth/authorize"
        assert params["client_id"][0] == oauth_config["client_id"]
        assert params["redirect_uri"][0] == oauth_config["redirect_uri"]
        assert params["scope"][0] == "user:email"

        if expected_state:
            assert params["state"][0] == expected_state
        else:
            assert "state" not in params

    @pytest.mark.parametrize(
        ("response_data", "expected_token", "should_raise"),
        [
            ({"access_token": "test_token"}, "test_token", False),
            ({"error": "invalid_grant"}, None, True),
            ({}, None, True),
        ],
    )
    @patch("requests.post")
    def test_should_retrieve_access_token(
        self, mock_post, oauth, mock_response, response_data, expected_token, should_raise
    ):
        mock_response.json.return_value = response_data
        mock_post.return_value = mock_response

        if should_raise:
            with pytest.raises(ValueError) as exc_info:
                oauth.get_access_token("test_code")
            assert "Error in GitHub OAuth" in str(exc_info.value)
        else:
            token = oauth.get_access_token("test_code")
            assert token == expected_token

    @pytest.mark.parametrize(
        ("user_data", "email_data", "expected_email"),
        [
            # User with primary email
            (
                {"id": 12345, "login": "testuser", "name": "Test User"},
                [
                    {"email": "secondary@example.com", "primary": False},
                    {"email": "primary@example.com", "primary": True},
                ],
                "primary@example.com",
            ),
            # User with no emails - fallback to noreply
            ({"id": 12345, "login": "testuser", "name": "Test User"}, [], "12345+testuser@users.noreply.github.com"),
            # User with only secondary email - fallback to noreply
            (
                {"id": 12345, "login": "testuser", "name": "Test User"},
                [{"email": "secondary@example.com", "primary": False}],
                "12345+testuser@users.noreply.github.com",
            ),
        ],
    )
    @patch("requests.get")
    def test_should_retrieve_user_info_correctly(self, mock_get, oauth, user_data, email_data, expected_email):
        user_response = MagicMock()
        user_response.json.return_value = user_data

        email_response = MagicMock()
        email_response.json.return_value = email_data

        mock_get.side_effect = [user_response, email_response]

        user_info = oauth.get_user_info("test_token")

        assert user_info.id == str(user_data["id"])
        assert user_info.name == user_data["name"]
        assert user_info.email == expected_email

    @patch("requests.get")
    def test_should_handle_network_errors(self, mock_get, oauth):
        mock_get.side_effect = requests.exceptions.RequestException("Network error")

        with pytest.raises(requests.exceptions.RequestException):
            oauth.get_raw_user_info("test_token")


class TestGoogleOAuth(BaseOAuthTest):
    @pytest.fixture
    def oauth(self, oauth_config):
        return GoogleOAuth(oauth_config["client_id"], oauth_config["client_secret"], oauth_config["redirect_uri"])

    @pytest.mark.parametrize(
        ("invite_token", "expected_state"),
        [
            (None, None),
            ("test_invite_token", "test_invite_token"),
            ("", None),
        ],
    )
    def test_should_generate_authorization_url_correctly(self, oauth, oauth_config, invite_token, expected_state):
        url = oauth.get_authorization_url(invite_token)
        parsed, params = self.parse_auth_url(url)

        assert parsed.scheme == "https"
        assert parsed.netloc == "accounts.google.com"
        assert parsed.path == "/o/oauth2/v2/auth"
        assert params["client_id"][0] == oauth_config["client_id"]
        assert params["redirect_uri"][0] == oauth_config["redirect_uri"]
        assert params["response_type"][0] == "code"
        assert params["scope"][0] == "openid email"

        if expected_state:
            assert params["state"][0] == expected_state
        else:
            assert "state" not in params

    @pytest.mark.parametrize(
        ("response_data", "expected_token", "should_raise"),
        [
            ({"access_token": "test_token"}, "test_token", False),
            ({"error": "invalid_grant"}, None, True),
            ({}, None, True),
        ],
    )
    @patch("requests.post")
    def test_should_retrieve_access_token(
        self, mock_post, oauth, oauth_config, mock_response, response_data, expected_token, should_raise
    ):
        mock_response.json.return_value = response_data
        mock_post.return_value = mock_response

        if should_raise:
            with pytest.raises(ValueError) as exc_info:
                oauth.get_access_token("test_code")
            assert "Error in Google OAuth" in str(exc_info.value)
        else:
            token = oauth.get_access_token("test_code")
            assert token == expected_token

        mock_post.assert_called_once_with(
            oauth._TOKEN_URL,
            data={
                "client_id": oauth_config["client_id"],
                "client_secret": oauth_config["client_secret"],
                "code": "test_code",
                "grant_type": "authorization_code",
                "redirect_uri": oauth_config["redirect_uri"],
            },
            headers={"Accept": "application/json"},
        )

    @pytest.mark.parametrize(
        ("user_data", "expected_name"),
        [
            ({"sub": "123", "email": "test@example.com", "email_verified": True}, ""),
            ({"sub": "123", "email": "test@example.com", "name": "Test User"}, ""),  # Always returns empty string
        ],
    )
    @patch("requests.get")
    def test_should_retrieve_user_info_correctly(self, mock_get, oauth, mock_response, user_data, expected_name):
        mock_response.json.return_value = user_data
        mock_get.return_value = mock_response

        user_info = oauth.get_user_info("test_token")

        assert user_info.id == user_data["sub"]
        assert user_info.name == expected_name
        assert user_info.email == user_data["email"]

        mock_get.assert_called_once_with(oauth._USER_INFO_URL, headers={"Authorization": "Bearer test_token"})

    @pytest.mark.parametrize(
        "exception_type",
        [
            requests.exceptions.HTTPError,
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
        ],
    )
    @patch("requests.get")
    def test_should_handle_http_errors(self, mock_get, oauth, exception_type):
        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = exception_type("Error")
        mock_get.return_value = mock_response

        with pytest.raises(exception_type):
            oauth.get_raw_user_info("invalid_token")


class TestOAuthUserInfo:
    @pytest.mark.parametrize(
        "user_data",
        [
            {"id": "123", "name": "Test User", "email": "test@example.com"},
            {"id": "456", "name": "", "email": "user@domain.com"},
            {"id": "789", "name": "Another User", "email": "another@test.org"},
        ],
    )
    def test_should_create_user_info_dataclass(self, user_data):
        user_info = OAuthUserInfo(**user_data)

        assert user_info.id == user_data["id"]
        assert user_info.name == user_data["name"]
        assert user_info.email == user_data["email"]
