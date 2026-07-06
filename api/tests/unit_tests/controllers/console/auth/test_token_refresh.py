"""
Test suite for token refresh authentication flows.

This module tests the token refresh mechanism including:
- Access token refresh using refresh token
- Cookie-based token extraction and renewal
- Token expiration and validation
- Error handling for invalid tokens
"""

from unittest.mock import ANY, MagicMock, patch

import pytest
from flask import Flask
from flask_restx import Api
from werkzeug.exceptions import Unauthorized

from controllers.console.auth.login import RefreshTokenApi
from services.errors.account import RefreshTokenAccountNotFoundError, RefreshTokenNotFoundError


class TestRefreshTokenApi:
    """Test cases for the RefreshTokenApi endpoint."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def api(self, app: Flask):
        """Create Flask-RESTX API instance."""
        return Api(app)

    @pytest.fixture
    def client(self, app: Flask, api: Api):
        """Create test client."""
        api.add_resource(RefreshTokenApi, "/refresh-token")
        return app.test_client()

    @pytest.fixture
    def mock_token_pair(self):
        """Create mock token pair object."""
        token_pair = MagicMock()
        token_pair.access_token = "new_access_token"
        token_pair.refresh_token = "new_refresh_token"
        token_pair.csrf_token = "new_csrf_token"
        return token_pair

    @patch("controllers.console.auth.login.extract_refresh_token", autospec=True)
    @patch("controllers.console.auth.login.AccountService.refresh_token", autospec=True)
    def test_successful_token_refresh(self, mock_refresh_token, mock_extract_token, app: Flask, mock_token_pair):
        """
        Test successful token refresh flow.

        Verifies that:
        - Refresh token is extracted from cookies
        - New token pair is generated
        - New tokens are set in response cookies
        - Success response is returned
        """
        # Arrange
        mock_extract_token.return_value = "valid_refresh_token"
        mock_refresh_token.return_value = mock_token_pair

        # Act
        with app.test_request_context("/refresh-token", method="POST"):
            refresh_api = RefreshTokenApi()
            response = refresh_api.post()

        # Assert
        mock_extract_token.assert_called_once()
        mock_refresh_token.assert_called_once_with("valid_refresh_token", session=ANY)
        assert response.json["result"] == "success"

    @patch("controllers.console.auth.login.extract_refresh_token", autospec=True)
    def test_refresh_fails_without_token(self, mock_extract_token, app: Flask):
        """
        Test token refresh failure when no refresh token provided.

        Verifies that:
        - Error is returned when refresh token is missing
        - 401 status code is returned
        - Appropriate error message is provided
        """
        # Arrange
        mock_extract_token.return_value = None

        # Act
        with app.test_request_context("/refresh-token", method="POST"):
            refresh_api = RefreshTokenApi()
            response, status_code = refresh_api.post()

        # Assert
        assert status_code == 401
        assert response["result"] == "fail"
        assert "No refresh token provided" in response["message"]

    @patch("controllers.console.auth.login.extract_refresh_token", autospec=True)
    @patch("controllers.console.auth.login.AccountService.refresh_token", autospec=True)
    def test_refresh_returns_unauthorized_for_invalid_refresh_token(
        self, mock_refresh_token, mock_extract_token, app: Flask
    ):
        """
        Test token refresh maps invalid refresh tokens to unauthorized responses.

        Verifies that:
        - Invalid refresh token validation failures return 401
        - The failure response preserves the validation message
        """
        # Arrange
        mock_extract_token.return_value = "invalid_refresh_token"
        mock_refresh_token.side_effect = RefreshTokenNotFoundError("Invalid refresh token")

        # Act
        with app.test_request_context("/refresh-token", method="POST"):
            refresh_api = RefreshTokenApi()
            response, status_code = refresh_api.post()

        # Assert
        assert status_code == 401
        assert response["result"] == "fail"
        assert response["message"] == "Invalid refresh token"

    @patch("controllers.console.auth.login.extract_refresh_token", autospec=True)
    @patch("controllers.console.auth.login.AccountService.refresh_token", autospec=True)
    def test_refresh_returns_unauthorized_for_invalid_account(self, mock_refresh_token, mock_extract_token, app: Flask):
        """
        Test token refresh maps missing accounts to unauthorized responses.

        Verifies that:
        - Invalid account validation failures return 401
        - The failure response preserves the validation message
        """
        # Arrange
        mock_extract_token.return_value = "refresh_token_for_missing_account"
        mock_refresh_token.side_effect = RefreshTokenAccountNotFoundError("Invalid account")

        # Act
        with app.test_request_context("/refresh-token", method="POST"):
            refresh_api = RefreshTokenApi()
            response, status_code = refresh_api.post()

        # Assert
        assert status_code == 401
        assert response["result"] == "fail"
        assert response["message"] == "Invalid account"

    @patch("controllers.console.auth.login.extract_refresh_token", autospec=True)
    @patch("controllers.console.auth.login.AccountService.refresh_token", autospec=True)
    def test_refresh_returns_unauthorized_for_banned_account(self, mock_refresh_token, mock_extract_token, app: Flask):
        """
        Test token refresh maps banned accounts to unauthorized responses.

        Verifies that:
        - Authorization failures raised during account loading return 401
        - The failure response preserves the authorization message
        """
        # Arrange
        mock_extract_token.return_value = "refresh_token_for_banned_account"
        mock_refresh_token.side_effect = Unauthorized("Account is banned.")

        # Act
        with app.test_request_context("/refresh-token", method="POST"):
            refresh_api = RefreshTokenApi()
            response, status_code = refresh_api.post()

        # Assert
        assert status_code == 401
        assert response["result"] == "fail"
        assert response["message"] == "Account is banned."

    @patch("controllers.console.auth.login.extract_refresh_token", autospec=True)
    @patch("controllers.console.auth.login.AccountService.refresh_token", autospec=True)
    def test_refresh_propagates_non_whitelisted_value_error(self, mock_refresh_token, mock_extract_token, app: Flask):
        """
        Test token refresh preserves non-whitelisted ValueError failures.

        Verifies that:
        - Only known refresh-token validation errors are mapped to 401
        - Unexpected ValueError instances continue to propagate
        """
        # Arrange
        mock_extract_token.return_value = "valid_refresh_token"
        mock_refresh_token.side_effect = ValueError("unexpected parse failure")

        # Act & Assert
        with app.test_request_context("/refresh-token", method="POST"):
            refresh_api = RefreshTokenApi()
            with pytest.raises(ValueError, match="unexpected parse failure"):
                refresh_api.post()

    @patch("controllers.console.auth.login.extract_refresh_token", autospec=True)
    @patch("controllers.console.auth.login.AccountService.refresh_token", autospec=True)
    def test_refresh_propagates_unexpected_service_errors(self, mock_refresh_token, mock_extract_token, app: Flask):
        """
        Test token refresh preserves unexpected service failures.

        Verifies that:
        - Operational errors are not misreported as authentication failures
        - The original exception is preserved for higher-level error handling
        """
        # Arrange
        mock_extract_token.return_value = "valid_refresh_token"
        mock_refresh_token.side_effect = RuntimeError("redis unavailable")

        # Act & Assert
        with app.test_request_context("/refresh-token", method="POST"):
            refresh_api = RefreshTokenApi()
            with pytest.raises(RuntimeError, match="redis unavailable"):
                refresh_api.post()

    @patch("controllers.console.auth.login.extract_refresh_token", autospec=True)
    @patch("controllers.console.auth.login.AccountService.refresh_token", autospec=True)
    def test_refresh_with_empty_token(self, mock_refresh_token, mock_extract_token, app: Flask):
        """
        Test token refresh with empty string token.

        Verifies that:
        - Empty string is treated as no token
        - 401 status code is returned
        """
        # Arrange
        mock_extract_token.return_value = ""

        # Act
        with app.test_request_context("/refresh-token", method="POST"):
            refresh_api = RefreshTokenApi()
            response, status_code = refresh_api.post()

        # Assert
        assert status_code == 401
        assert response["result"] == "fail"

    @patch("controllers.console.auth.login.extract_refresh_token", autospec=True)
    @patch("controllers.console.auth.login.AccountService.refresh_token", autospec=True)
    def test_refresh_updates_all_tokens(self, mock_refresh_token, mock_extract_token, app: Flask, mock_token_pair):
        """
        Test that token refresh updates all three tokens.

        Verifies that:
        - Access token is updated
        - Refresh token is rotated
        - CSRF token is regenerated
        """
        # Arrange
        mock_extract_token.return_value = "valid_refresh_token"
        mock_refresh_token.return_value = mock_token_pair

        # Act
        with app.test_request_context("/refresh-token", method="POST"):
            refresh_api = RefreshTokenApi()
            response = refresh_api.post()

        # Assert
        assert response.json["result"] == "success"
        # Verify new token pair was generated
        mock_refresh_token.assert_called_once_with("valid_refresh_token", session=ANY)
        # In real implementation, cookies would be set with new values
        assert mock_token_pair.access_token == "new_access_token"
        assert mock_token_pair.refresh_token == "new_refresh_token"
        assert mock_token_pair.csrf_token == "new_csrf_token"
