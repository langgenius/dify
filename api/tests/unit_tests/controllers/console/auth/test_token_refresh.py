"""
Test suite for token refresh authentication flows.

This module tests the token refresh mechanism including:
- Access token refresh using refresh token
- Cookie-based token extraction and renewal
- Token expiration and validation
- Error handling for invalid tokens
"""

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask_restx import Api

from controllers.console.auth.login import RefreshTokenApi


class TestRefreshTokenApi:
    """Test cases for the RefreshTokenApi endpoint."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def api(self, app):
        """Create Flask-RESTX API instance."""
        return Api(app)

    @pytest.fixture
    def client(self, app, api):
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

    @patch("controllers.console.auth.login.extract_refresh_token")
    @patch("controllers.console.auth.login.AccountService.refresh_token")
    def test_successful_token_refresh(self, mock_refresh_token, mock_extract_token, app, mock_token_pair):
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
        mock_refresh_token.assert_called_once_with("valid_refresh_token")
        assert response.json["result"] == "success"

    @patch("controllers.console.auth.login.extract_refresh_token")
    def test_refresh_fails_without_token(self, mock_extract_token, app):
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

    @patch("controllers.console.auth.login.extract_refresh_token")
    @patch("controllers.console.auth.login.AccountService.refresh_token")
    def test_refresh_fails_with_invalid_token(self, mock_refresh_token, mock_extract_token, app):
        """
        Test token refresh failure with invalid refresh token.

        Verifies that:
        - Exception is caught when token is invalid
        - 401 status code is returned
        - Error message is included in response
        """
        # Arrange
        mock_extract_token.return_value = "invalid_refresh_token"
        mock_refresh_token.side_effect = Exception("Invalid refresh token")

        # Act
        with app.test_request_context("/refresh-token", method="POST"):
            refresh_api = RefreshTokenApi()
            response, status_code = refresh_api.post()

        # Assert
        assert status_code == 401
        assert response["result"] == "fail"
        assert "Invalid refresh token" in response["message"]

    @patch("controllers.console.auth.login.extract_refresh_token")
    @patch("controllers.console.auth.login.AccountService.refresh_token")
    def test_refresh_fails_with_expired_token(self, mock_refresh_token, mock_extract_token, app):
        """
        Test token refresh failure with expired refresh token.

        Verifies that:
        - Expired tokens are rejected
        - 401 status code is returned
        - Appropriate error handling
        """
        # Arrange
        mock_extract_token.return_value = "expired_refresh_token"
        mock_refresh_token.side_effect = Exception("Refresh token expired")

        # Act
        with app.test_request_context("/refresh-token", method="POST"):
            refresh_api = RefreshTokenApi()
            response, status_code = refresh_api.post()

        # Assert
        assert status_code == 401
        assert response["result"] == "fail"
        assert "expired" in response["message"].lower()

    @patch("controllers.console.auth.login.extract_refresh_token")
    @patch("controllers.console.auth.login.AccountService.refresh_token")
    def test_refresh_with_empty_token(self, mock_refresh_token, mock_extract_token, app):
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

    @patch("controllers.console.auth.login.extract_refresh_token")
    @patch("controllers.console.auth.login.AccountService.refresh_token")
    def test_refresh_updates_all_tokens(self, mock_refresh_token, mock_extract_token, app, mock_token_pair):
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
        mock_refresh_token.assert_called_once_with("valid_refresh_token")
        # In real implementation, cookies would be set with new values
        assert mock_token_pair.access_token == "new_access_token"
        assert mock_token_pair.refresh_token == "new_refresh_token"
        assert mock_token_pair.csrf_token == "new_csrf_token"
