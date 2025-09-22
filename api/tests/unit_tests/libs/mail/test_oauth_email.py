"""Comprehensive tests for email OAuth implementation"""

import base64
from typing import Optional, Union

import pytest

from libs.mail.oauth_email import MicrosoftEmailOAuth, OAuthUserInfo
from libs.mail.oauth_http_client import OAuthHTTPClientProtocol


class MockHTTPClient(OAuthHTTPClientProtocol):
    """Mock HTTP client for testing OAuth without real network calls"""

    def __init__(self):
        self.post_responses = []
        self.get_responses = []
        self.post_calls = []
        self.get_calls = []
        self.post_index = 0
        self.get_index = 0

    def add_post_response(self, status_code: int, json_data: dict[str, Union[str, int]]):
        """Add a mocked POST response"""
        self.post_responses.append(
            {
                "status_code": status_code,
                "json": json_data,
                "text": str(json_data),
                "headers": {"content-type": "application/json"},
            }
        )

    def add_get_response(self, json_data: dict[str, Union[str, int, dict, list]]):
        """Add a mocked GET response"""
        self.get_responses.append(json_data)

    def post(
        self, url: str, data: dict[str, Union[str, int]], headers: dict[str, str] | None = None
    ) -> dict[str, Union[str, int, dict, list]]:
        """Mock POST request"""
        self.post_calls.append({"url": url, "data": data, "headers": headers})

        if self.post_index < len(self.post_responses):
            response = self.post_responses[self.post_index]
            self.post_index += 1
            return response

        # Default error response
        return {
            "status_code": 500,
            "json": {"error": "No mock response configured"},
            "text": "No mock response configured",
            "headers": {},
        }

    def get(self, url: str, headers: dict[str, str] | None = None) -> dict[str, Union[str, int, dict, list]]:
        """Mock GET request"""
        self.get_calls.append({"url": url, "headers": headers})

        if self.get_index < len(self.get_responses):
            response = self.get_responses[self.get_index]
            self.get_index += 1
            return response

        # Default error response
        raise Exception("No mock response configured")


class TestMicrosoftEmailOAuth:
    """Test cases for MicrosoftEmailOAuth"""

    @pytest.fixture
    def mock_http_client(self):
        """Create a mock HTTP client"""
        return MockHTTPClient()

    @pytest.fixture
    def oauth_client(self, mock_http_client):
        """Create OAuth client with mock HTTP client"""
        return MicrosoftEmailOAuth(
            client_id="test-client-id",
            client_secret="test-client-secret",
            redirect_uri="https://example.com/callback",
            tenant_id="test-tenant",
            http_client=mock_http_client,
        )

    def test_get_authorization_url(self, oauth_client):
        """Test authorization URL generation"""
        url = oauth_client.get_authorization_url()

        assert "login.microsoftonline.com/test-tenant/oauth2/v2.0/authorize" in url
        assert "client_id=test-client-id" in url
        assert "response_type=code" in url
        assert "redirect_uri=https%3A%2F%2Fexample.com%2Fcallback" in url
        assert "scope=https%3A%2F%2Foutlook.office.com%2FSMTP.Send+offline_access" in url
        assert "response_mode=query" in url

    def test_get_authorization_url_with_state(self, oauth_client):
        """Test authorization URL with state parameter"""
        url = oauth_client.get_authorization_url(invite_token="test-state-123")

        assert "state=test-state-123" in url

    def test_get_access_token_success(self, oauth_client, mock_http_client):
        """Test successful access token retrieval"""
        # Setup mock response
        mock_http_client.add_post_response(
            200,
            {
                "access_token": "test-access-token",
                "token_type": "Bearer",
                "expires_in": 3600,
                "refresh_token": "test-refresh-token",
            },
        )

        result = oauth_client.get_access_token("test-auth-code")

        # Verify result
        assert result["access_token"] == "test-access-token"
        assert result["token_type"] == "Bearer"
        assert result["expires_in"] == 3600
        assert result["refresh_token"] == "test-refresh-token"

        # Verify HTTP call
        assert len(mock_http_client.post_calls) == 1
        call = mock_http_client.post_calls[0]
        assert "login.microsoftonline.com/test-tenant/oauth2/v2.0/token" in call["url"]
        assert call["data"]["grant_type"] == "authorization_code"
        assert call["data"]["code"] == "test-auth-code"
        assert call["data"]["client_id"] == "test-client-id"
        assert call["data"]["client_secret"] == "test-client-secret"

    def test_get_access_token_failure(self, oauth_client, mock_http_client):
        """Test access token retrieval failure"""
        # Setup mock error response
        mock_http_client.add_post_response(
            400, {"error": "invalid_grant", "error_description": "The authorization code is invalid"}
        )

        with pytest.raises(ValueError, match="Error in Microsoft OAuth"):
            oauth_client.get_access_token("bad-auth-code")

    def test_get_access_token_client_credentials_success(self, oauth_client, mock_http_client):
        """Test successful client credentials flow"""
        # Setup mock response
        mock_http_client.add_post_response(
            200, {"access_token": "service-access-token", "token_type": "Bearer", "expires_in": 3600}
        )

        result = oauth_client.get_access_token_client_credentials()

        # Verify result
        assert result["access_token"] == "service-access-token"
        assert result["token_type"] == "Bearer"

        # Verify HTTP call
        call = mock_http_client.post_calls[0]
        assert call["data"]["grant_type"] == "client_credentials"
        assert call["data"]["scope"] == "https://outlook.office365.com/.default"

    def test_get_access_token_client_credentials_custom_scope(self, oauth_client, mock_http_client):
        """Test client credentials with custom scope"""
        mock_http_client.add_post_response(200, {"access_token": "custom-scope-token", "token_type": "Bearer"})

        result = oauth_client.get_access_token_client_credentials(scope="https://graph.microsoft.com/.default")

        assert result["access_token"] == "custom-scope-token"

        # Verify custom scope was used
        call = mock_http_client.post_calls[0]
        assert call["data"]["scope"] == "https://graph.microsoft.com/.default"

    def test_refresh_access_token_success(self, oauth_client, mock_http_client):
        """Test successful token refresh"""
        # Setup mock response
        mock_http_client.add_post_response(
            200,
            {
                "access_token": "new-access-token",
                "refresh_token": "new-refresh-token",
                "token_type": "Bearer",
                "expires_in": 3600,
            },
        )

        result = oauth_client.refresh_access_token("old-refresh-token")

        # Verify result
        assert result["access_token"] == "new-access-token"
        assert result["refresh_token"] == "new-refresh-token"

        # Verify HTTP call
        call = mock_http_client.post_calls[0]
        assert call["data"]["grant_type"] == "refresh_token"
        assert call["data"]["refresh_token"] == "old-refresh-token"

    def test_refresh_access_token_failure(self, oauth_client, mock_http_client):
        """Test token refresh failure"""
        # Setup mock error response
        mock_http_client.add_post_response(
            400, {"error": "invalid_grant", "error_description": "The refresh token has expired"}
        )

        with pytest.raises(ValueError, match="Error refreshing Microsoft OAuth token"):
            oauth_client.refresh_access_token("expired-refresh-token")

    def test_get_raw_user_info(self, oauth_client, mock_http_client):
        """Test getting user info from Microsoft Graph"""
        # Setup mock response
        mock_http_client.add_get_response(
            {
                "id": "12345",
                "displayName": "Test User",
                "mail": "test@contoso.com",
                "userPrincipalName": "test@contoso.com",
            }
        )

        result = oauth_client.get_raw_user_info("test-access-token")

        # Verify result
        assert result["id"] == "12345"
        assert result["displayName"] == "Test User"
        assert result["mail"] == "test@contoso.com"

        # Verify HTTP call
        call = mock_http_client.get_calls[0]
        assert call["url"] == "https://graph.microsoft.com/v1.0/me"
        assert call["headers"]["Authorization"] == "Bearer test-access-token"

    def test_get_user_info_complete_flow(self, oauth_client, mock_http_client):
        """Test complete user info retrieval flow"""
        # Setup mock response
        mock_http_client.add_get_response(
            {
                "id": "67890",
                "displayName": "John Doe",
                "mail": "john.doe@contoso.com",
                "userPrincipalName": "john.doe@contoso.com",
            }
        )

        user_info = oauth_client.get_user_info("test-access-token")

        # Verify transformed user info
        assert isinstance(user_info, OAuthUserInfo)
        assert user_info.id == "67890"
        assert user_info.name == "John Doe"
        assert user_info.email == "john.doe@contoso.com"

    def test_transform_user_info_with_missing_mail(self, oauth_client):
        """Test user info transformation when mail field is missing"""
        raw_info = {"id": "99999", "displayName": "No Mail User", "userPrincipalName": "nomail@contoso.com"}

        user_info = oauth_client._transform_user_info(raw_info)

        # Should fall back to userPrincipalName
        assert user_info.email == "nomail@contoso.com"

    def test_transform_user_info_with_no_display_name(self, oauth_client):
        """Test user info transformation when displayName is missing"""
        raw_info = {"id": "11111", "mail": "anonymous@contoso.com", "userPrincipalName": "anonymous@contoso.com"}

        user_info = oauth_client._transform_user_info(raw_info)

        # Should have empty name
        assert user_info.name == ""
        assert user_info.email == "anonymous@contoso.com"

    def test_create_sasl_xoauth2_string(self):
        """Test static SASL XOAUTH2 string creation"""
        username = "test@contoso.com"
        access_token = "test-token-456"

        result = MicrosoftEmailOAuth.create_sasl_xoauth2_string(username, access_token)

        # Decode and verify format
        decoded = base64.b64decode(result).decode()
        expected = f"user={username}\x01auth=Bearer {access_token}\x01\x01"
        assert decoded == expected

    def test_error_handling_with_non_json_response(self, oauth_client, mock_http_client):
        """Test handling of non-JSON error responses"""
        # Setup mock HTML error response
        mock_http_client.post_responses.append(
            {
                "status_code": 500,
                "json": {},
                "text": "<html>Internal Server Error</html>",
                "headers": {"content-type": "text/html"},
            }
        )

        with pytest.raises(ValueError, match="Error in Microsoft OAuth"):
            oauth_client.get_access_token("test-code")


class TestOAuthIntegration:
    """Integration tests for OAuth with SMTP"""

    def test_oauth_token_flow_for_smtp(self):
        """Test complete OAuth token flow for SMTP usage"""
        # Create mock HTTP client
        mock_http = MockHTTPClient()

        # Setup mock responses for complete flow
        mock_http.add_post_response(
            200,
            {
                "access_token": "smtp-access-token",
                "token_type": "Bearer",
                "expires_in": 3600,
                "refresh_token": "smtp-refresh-token",
                "scope": "https://outlook.office.com/SMTP.Send offline_access",
            },
        )

        # Create OAuth client
        oauth_client = MicrosoftEmailOAuth(
            client_id="smtp-client-id",
            client_secret="smtp-client-secret",
            redirect_uri="https://app.example.com/oauth/callback",
            tenant_id="contoso.onmicrosoft.com",
            http_client=mock_http,
        )

        # Get authorization URL
        auth_url = oauth_client.get_authorization_url()
        assert "scope=https%3A%2F%2Foutlook.office.com%2FSMTP.Send+offline_access" in auth_url

        # Exchange code for token
        token_response = oauth_client.get_access_token("auth-code-from-user")
        assert token_response["access_token"] == "smtp-access-token"

        # Create SASL string for SMTP
        access_token = str(token_response["access_token"])
        sasl_string = MicrosoftEmailOAuth.create_sasl_xoauth2_string("user@contoso.com", access_token)

        # Verify SASL string is valid base64
        try:
            decoded = base64.b64decode(sasl_string)
            assert b"user=user@contoso.com" in decoded
            assert b"auth=Bearer smtp-access-token" in decoded
        except Exception:
            pytest.fail("SASL string is not valid base64")

    def test_service_account_flow(self):
        """Test service account (client credentials) flow"""
        mock_http = MockHTTPClient()

        # Setup mock response for client credentials
        mock_http.add_post_response(
            200, {"access_token": "service-smtp-token", "token_type": "Bearer", "expires_in": 3600}
        )

        oauth_client = MicrosoftEmailOAuth(
            client_id="service-client-id",
            client_secret="service-client-secret",
            redirect_uri="",  # Not needed for service accounts
            tenant_id="contoso.onmicrosoft.com",
            http_client=mock_http,
        )

        # Get token using client credentials
        token_response = oauth_client.get_access_token_client_credentials()

        assert token_response["access_token"] == "service-smtp-token"

        # Verify the request used correct grant type
        call = mock_http.post_calls[0]
        assert call["data"]["grant_type"] == "client_credentials"
        assert "redirect_uri" not in call["data"]  # Should not include redirect_uri
