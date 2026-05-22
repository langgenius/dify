import urllib.parse
from unittest.mock import MagicMock, patch

import httpx
import pytest

from libs.oauth import GitHubOAuth, GoogleOAuth, OAuthUserInfo, decode_oauth_state


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
        ("invite_token", "timezone", "language", "expected_state"),
        [
            (None, None, None, None),
            ("test_invite_token", None, None, {"invite_token": "test_invite_token"}),
            ("", None, None, None),
            (None, "Asia/Shanghai", None, {"timezone": "Asia/Shanghai"}),
            (None, None, "zh-Hans", {"language": "zh-Hans"}),
            (
                "test_invite_token",
                "Asia/Shanghai",
                "zh-Hans",
                {"invite_token": "test_invite_token", "timezone": "Asia/Shanghai", "language": "zh-Hans"},
            ),
        ],
    )
    def test_should_generate_authorization_url_correctly(
        self, oauth, oauth_config, invite_token, timezone, language, expected_state
    ):
        url = oauth.get_authorization_url(invite_token, timezone=timezone, language=language)
        parsed, params = self.parse_auth_url(url)

        assert parsed.scheme == "https"
        assert parsed.netloc == "github.com"
        assert parsed.path == "/login/oauth/authorize"
        assert params["client_id"][0] == oauth_config["client_id"]
        assert params["redirect_uri"][0] == oauth_config["redirect_uri"]
        assert params["scope"][0] == "user:email"

        if expected_state:
            assert decode_oauth_state(params["state"][0]) == expected_state
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
    @patch("libs.oauth._http_client.post", autospec=True)
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
            # User with primary email from /user/emails (no email in profile)
            (
                {"id": 12345, "login": "testuser", "name": "Test User"},
                [
                    {"email": "secondary@example.com", "primary": False},
                    {"email": "primary@example.com", "primary": True},
                ],
                "primary@example.com",
            ),
            # User with private email (null email and name from API)
            (
                {"id": 12345, "login": "testuser", "name": None, "email": None},
                [{"email": "primary@example.com", "primary": True}],
                "primary@example.com",
            ),
            # User with only verified (non-primary) email
            (
                {"id": 12345, "login": "testuser", "name": "Test User"},
                [{"email": "verified@example.com", "primary": False, "verified": True}],
                "verified@example.com",
            ),
        ],
    )
    @patch("libs.oauth._http_client.get", autospec=True)
    def test_should_retrieve_user_info_correctly(self, mock_get, oauth, user_data, email_data, expected_email):
        user_response = MagicMock()
        user_response.json.return_value = user_data

        email_response = MagicMock()
        email_response.json.return_value = email_data

        mock_get.side_effect = [user_response, email_response]

        user_info = oauth.get_user_info("test_token")

        assert user_info.id == str(user_data["id"])
        assert user_info.name == (user_data["name"] or "")
        assert user_info.email == expected_email
        # The profile email is absent/null, so /user/emails should be called
        assert mock_get.call_count == 2

    @patch("libs.oauth._http_client.get", autospec=True)
    def test_should_skip_email_endpoint_when_profile_email_present(self, mock_get, oauth):
        """When the /user profile already contains an email, do not call /user/emails."""
        user_response = MagicMock()
        user_response.json.return_value = {
            "id": 12345,
            "login": "testuser",
            "name": "Test User",
            "email": "profile@example.com",
        }
        mock_get.return_value = user_response

        user_info = oauth.get_user_info("test_token")

        assert user_info.email == "profile@example.com"
        # Only /user should be called; /user/emails should be skipped
        mock_get.assert_called_once()

    @pytest.mark.parametrize(
        ("user_data", "email_data"),
        [
            # User with no emails at all
            ({"id": 12345, "login": "testuser", "name": "Test User"}, []),
            # User with only unverified secondary email
            (
                {"id": 12345, "login": "testuser", "name": "Test User"},
                [{"email": "secondary@example.com", "primary": False, "verified": False}],
            ),
            # User with private email and no entries in emails endpoint
            (
                {"id": 12345, "login": "testuser", "name": None, "email": None},
                [],
            ),
        ],
    )
    @patch("libs.oauth._http_client.get", autospec=True)
    def test_should_use_noreply_email_when_no_usable_email(self, mock_get, oauth, user_data, email_data):
        user_response = MagicMock()
        user_response.json.return_value = user_data

        email_response = MagicMock()
        email_response.json.return_value = email_data

        mock_get.side_effect = [user_response, email_response]

        user_info = oauth.get_user_info("test_token")

        assert user_info.id == str(user_data["id"])
        assert user_info.email == "12345@users.noreply.github.com"

    @patch("libs.oauth._http_client.get", autospec=True)
    def test_should_use_noreply_email_when_email_endpoint_fails(self, mock_get, oauth):
        user_response = MagicMock()
        user_response.json.return_value = {"id": 12345, "login": "testuser", "name": "Test User"}

        email_response = MagicMock()
        email_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Forbidden", request=MagicMock(), response=MagicMock()
        )

        mock_get.side_effect = [user_response, email_response]

        user_info = oauth.get_user_info("test_token")

        assert user_info.id == "12345"
        assert user_info.email == "12345@users.noreply.github.com"

    @patch("libs.oauth._http_client.get", autospec=True)
    def test_should_handle_network_errors(self, mock_get, oauth):
        mock_get.side_effect = httpx.RequestError("Network error")

        with pytest.raises(httpx.RequestError):
            oauth.get_raw_user_info("test_token")


class TestGoogleOAuth(BaseOAuthTest):
    @pytest.fixture
    def oauth(self, oauth_config):
        return GoogleOAuth(oauth_config["client_id"], oauth_config["client_secret"], oauth_config["redirect_uri"])

    @pytest.mark.parametrize(
        ("invite_token", "timezone", "language", "expected_state"),
        [
            (None, None, None, None),
            ("test_invite_token", None, None, {"invite_token": "test_invite_token"}),
            ("", None, None, None),
            (None, "Asia/Shanghai", None, {"timezone": "Asia/Shanghai"}),
            (None, None, "zh-Hans", {"language": "zh-Hans"}),
            (
                "test_invite_token",
                "Asia/Shanghai",
                "zh-Hans",
                {"invite_token": "test_invite_token", "timezone": "Asia/Shanghai", "language": "zh-Hans"},
            ),
        ],
    )
    def test_should_generate_authorization_url_correctly(
        self, oauth, oauth_config, invite_token, timezone, language, expected_state
    ):
        url = oauth.get_authorization_url(invite_token, timezone=timezone, language=language)
        parsed, params = self.parse_auth_url(url)

        assert parsed.scheme == "https"
        assert parsed.netloc == "accounts.google.com"
        assert parsed.path == "/o/oauth2/v2/auth"
        assert params["client_id"][0] == oauth_config["client_id"]
        assert params["redirect_uri"][0] == oauth_config["redirect_uri"]
        assert params["response_type"][0] == "code"
        assert params["scope"][0] == "openid email"

        if expected_state:
            assert decode_oauth_state(params["state"][0]) == expected_state
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
    @patch("libs.oauth._http_client.post", autospec=True)
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
    @patch("libs.oauth._http_client.get", autospec=True)
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
            httpx.HTTPError,
            httpx.ConnectError,
            httpx.TimeoutException,
        ],
    )
    @patch("libs.oauth._http_client.get", autospec=True)
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
