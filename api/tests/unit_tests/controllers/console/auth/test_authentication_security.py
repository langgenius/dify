"""Test authentication security to prevent user enumeration."""

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask_restful import Api

from controllers.console.auth.error import AuthenticationFailedError
from controllers.console.auth.login import LoginApi
from services.errors.account import AccountNotFoundError, AccountPasswordError


class TestAuthenticationSecurity:
    """Test authentication endpoints for security against user enumeration."""

    def setup_method(self):
        """Set up test fixtures."""
        self.app = Flask(__name__)
        self.api = Api(self.app)
        self.api.add_resource(LoginApi, "/login")
        self.client = self.app.test_client()
        self.app.config["TESTING"] = True

    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.AccountService.add_login_error_rate_limit")
    @patch("controllers.console.auth.login.dify_config.BILLING_ENABLED", False)
    @patch("controllers.console.auth.login.RegisterService.get_invitation_if_token_valid")
    def test_login_invalid_email_returns_generic_error(
        self, mock_get_invitation, mock_add_rate_limit, mock_authenticate, mock_is_rate_limit
    ):
        """Test that invalid email returns same error as wrong password."""
        # Arrange
        mock_is_rate_limit.return_value = False
        mock_get_invitation.return_value = None
        mock_authenticate.side_effect = AccountNotFoundError("Account not found")

        # Act & Assert
        with pytest.raises(AuthenticationFailedError) as exc_info:
            with self.app.test_request_context(
                "/login", method="POST", json={"email": "nonexistent@example.com", "password": "WrongPass123!"}
            ):
                login_api = LoginApi()
                login_api.post()

        assert exc_info.value.error_code == "authentication_failed"
        assert exc_info.value.description == "Invalid email or password."
        mock_add_rate_limit.assert_called_once_with("nonexistent@example.com")

    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.AccountService.add_login_error_rate_limit")
    @patch("controllers.console.auth.login.dify_config.BILLING_ENABLED", False)
    @patch("controllers.console.auth.login.RegisterService.get_invitation_if_token_valid")
    def test_login_wrong_password_returns_generic_error(
        self, mock_get_invitation, mock_add_rate_limit, mock_authenticate, mock_is_rate_limit
    ):
        """Test that wrong password returns same error as invalid email."""
        # Arrange
        mock_is_rate_limit.return_value = False
        mock_get_invitation.return_value = None
        mock_authenticate.side_effect = AccountPasswordError("Wrong password")

        # Act & Assert
        with pytest.raises(AuthenticationFailedError) as exc_info:
            with self.app.test_request_context(
                "/login", method="POST", json={"email": "existing@example.com", "password": "WrongPass123!"}
            ):
                login_api = LoginApi()
                login_api.post()

        assert exc_info.value.error_code == "authentication_failed"
        assert exc_info.value.description == "Invalid email or password."
        mock_add_rate_limit.assert_called_once_with("existing@example.com")

    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @patch("controllers.console.auth.login.AccountService.send_reset_password_email")
    def test_reset_password_always_returns_success(self, mock_send_email, mock_get_user):
        """Test that reset password always returns success regardless of account existence."""
        # Test with existing account
        mock_get_user.return_value = MagicMock(email="existing@example.com")
        mock_send_email.return_value = "token123"

        with self.app.test_request_context("/reset-password", method="POST", json={"email": "existing@example.com"}):
            from controllers.console.auth.login import ResetPasswordSendEmailApi

            api = ResetPasswordSendEmailApi()
            result = api.post()

        assert result == {"result": "success"}

        # Test with non-existent account
        mock_get_user.return_value = None

        with self.app.test_request_context("/reset-password", method="POST", json={"email": "nonexistent@example.com"}):
            api = ResetPasswordSendEmailApi()
            result = api.post()

        assert result == {"result": "success"}
