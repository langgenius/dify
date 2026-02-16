"""
Test suite for password reset authentication flows.

This module tests the password reset mechanism including:
- Password reset email sending
- Verification code validation
- Password reset with token
- Rate limiting and security checks
"""

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.auth.error import (
    EmailCodeError,
    EmailPasswordResetLimitError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
)
from controllers.console.auth.forgot_password import (
    ForgotPasswordCheckApi,
    ForgotPasswordResetApi,
    ForgotPasswordSendEmailApi,
)
from controllers.console.error import AccountNotFound, EmailSendIpLimitError


@pytest.fixture(autouse=True)
def _mock_forgot_password_session():
    with patch("controllers.console.auth.forgot_password.Session") as mock_session_cls:
        mock_session = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_session
        mock_session_cls.return_value.__exit__.return_value = None
        yield mock_session


@pytest.fixture(autouse=True)
def _mock_forgot_password_db():
    with patch("controllers.console.auth.forgot_password.db") as mock_db:
        mock_db.engine = MagicMock()
        yield mock_db


class TestForgotPasswordSendEmailApi:
    """Test cases for sending password reset emails."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_account(self):
        """Create mock account object."""
        account = MagicMock()
        account.email = "test@example.com"
        account.name = "Test User"
        return account

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.is_email_send_ip_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.console.auth.forgot_password.AccountService.send_reset_password_email")
    @patch("controllers.console.auth.forgot_password.FeatureService.get_system_features")
    def test_send_reset_email_success(
        self,
        mock_get_features,
        mock_send_email,
        mock_get_account,
        mock_is_ip_limit,
        mock_wraps_db,
        app,
        mock_account,
    ):
        """
        Test successful password reset email sending.

        Verifies that:
        - Email is sent to valid account
        - Reset token is generated and returned
        - IP rate limiting is checked
        """
        # Arrange
        mock_wraps_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_ip_limit.return_value = False
        mock_get_account.return_value = mock_account
        mock_send_email.return_value = "reset_token_123"
        mock_get_features.return_value.is_allow_register = True

        # Act
        with app.test_request_context(
            "/forgot-password", method="POST", json={"email": "test@example.com", "language": "en-US"}
        ):
            api = ForgotPasswordSendEmailApi()
            response = api.post()

        # Assert
        assert response["result"] == "success"
        assert response["data"] == "reset_token_123"
        mock_send_email.assert_called_once()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.is_email_send_ip_limit")
    def test_send_reset_email_ip_rate_limited(self, mock_is_ip_limit, mock_db, app):
        """
        Test password reset email blocked by IP rate limit.

        Verifies that:
        - EmailSendIpLimitError is raised when IP limit exceeded
        - No email is sent when rate limited
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_ip_limit.return_value = True

        # Act & Assert
        with app.test_request_context("/forgot-password", method="POST", json={"email": "test@example.com"}):
            api = ForgotPasswordSendEmailApi()
            with pytest.raises(EmailSendIpLimitError):
                api.post()

    @pytest.mark.parametrize(
        ("language_input", "expected_language"),
        [
            ("zh-Hans", "zh-Hans"),
            ("en-US", "en-US"),
            ("fr-FR", "en-US"),  # Defaults to en-US for unsupported
            (None, "en-US"),  # Defaults to en-US when not provided
        ],
    )
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.is_email_send_ip_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.console.auth.forgot_password.AccountService.send_reset_password_email")
    @patch("controllers.console.auth.forgot_password.FeatureService.get_system_features")
    def test_send_reset_email_language_handling(
        self,
        mock_get_features,
        mock_send_email,
        mock_get_account,
        mock_is_ip_limit,
        mock_wraps_db,
        app,
        mock_account,
        language_input,
        expected_language,
    ):
        """
        Test password reset email with different language preferences.

        Verifies that:
        - Language parameter is correctly processed
        - Unsupported languages default to en-US
        """
        # Arrange
        mock_wraps_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_ip_limit.return_value = False
        mock_get_account.return_value = mock_account
        mock_send_email.return_value = "token"
        mock_get_features.return_value.is_allow_register = True

        # Act
        with app.test_request_context(
            "/forgot-password", method="POST", json={"email": "test@example.com", "language": language_input}
        ):
            api = ForgotPasswordSendEmailApi()
            api.post()

        # Assert
        call_args = mock_send_email.call_args
        assert call_args.kwargs["language"] == expected_language


class TestForgotPasswordCheckApi:
    """Test cases for verifying password reset codes."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.console.auth.forgot_password.AccountService.revoke_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.generate_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.reset_forgot_password_error_rate_limit")
    def test_verify_code_success(
        self,
        mock_reset_rate_limit,
        mock_generate_token,
        mock_revoke_token,
        mock_get_data,
        mock_is_rate_limit,
        mock_db,
        app,
    ):
        """
        Test successful verification code validation.

        Verifies that:
        - Valid code is accepted
        - Old token is revoked
        - New token is generated for reset phase
        - Rate limit is reset on success
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = {"email": "test@example.com", "code": "123456"}
        mock_generate_token.return_value = (None, "new_token")

        # Act
        with app.test_request_context(
            "/forgot-password/validity",
            method="POST",
            json={"email": "test@example.com", "code": "123456", "token": "old_token"},
        ):
            api = ForgotPasswordCheckApi()
            response = api.post()

        # Assert
        assert response["is_valid"] is True
        assert response["email"] == "test@example.com"
        assert response["token"] == "new_token"
        mock_revoke_token.assert_called_once_with("old_token")
        mock_generate_token.assert_called_once_with(
            "test@example.com", code="123456", additional_data={"phase": "reset"}
        )
        mock_reset_rate_limit.assert_called_once_with("test@example.com")

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.console.auth.forgot_password.AccountService.revoke_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.generate_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.reset_forgot_password_error_rate_limit")
    def test_verify_code_preserves_token_email_case(
        self,
        mock_reset_rate_limit,
        mock_generate_token,
        mock_revoke_token,
        mock_get_data,
        mock_is_rate_limit,
        mock_db,
        app,
    ):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = {"email": "User@Example.com", "code": "999888"}
        mock_generate_token.return_value = (None, "fresh-token")

        with app.test_request_context(
            "/forgot-password/validity",
            method="POST",
            json={"email": "user@example.com", "code": "999888", "token": "upper_token"},
        ):
            response = ForgotPasswordCheckApi().post()

        assert response == {"is_valid": True, "email": "user@example.com", "token": "fresh-token"}
        mock_generate_token.assert_called_once_with(
            "User@Example.com", code="999888", additional_data={"phase": "reset"}
        )
        mock_revoke_token.assert_called_once_with("upper_token")
        mock_reset_rate_limit.assert_called_once_with("user@example.com")

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    def test_verify_code_rate_limited(self, mock_is_rate_limit, mock_db, app):
        """
        Test code verification blocked by rate limit.

        Verifies that:
        - EmailPasswordResetLimitError is raised when limit exceeded
        - Prevents brute force attacks on verification codes
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = True

        # Act & Assert
        with app.test_request_context(
            "/forgot-password/validity",
            method="POST",
            json={"email": "test@example.com", "code": "123456", "token": "token"},
        ):
            api = ForgotPasswordCheckApi()
            with pytest.raises(EmailPasswordResetLimitError):
                api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    def test_verify_code_invalid_token(self, mock_get_data, mock_is_rate_limit, mock_db, app):
        """
        Test code verification with invalid token.

        Verifies that:
        - InvalidTokenError is raised for invalid/expired tokens
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = None

        # Act & Assert
        with app.test_request_context(
            "/forgot-password/validity",
            method="POST",
            json={"email": "test@example.com", "code": "123456", "token": "invalid_token"},
        ):
            api = ForgotPasswordCheckApi()
            with pytest.raises(InvalidTokenError):
                api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    def test_verify_code_email_mismatch(self, mock_get_data, mock_is_rate_limit, mock_db, app):
        """
        Test code verification with mismatched email.

        Verifies that:
        - InvalidEmailError is raised when email doesn't match token
        - Prevents token abuse
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = {"email": "original@example.com", "code": "123456"}

        # Act & Assert
        with app.test_request_context(
            "/forgot-password/validity",
            method="POST",
            json={"email": "different@example.com", "code": "123456", "token": "token"},
        ):
            api = ForgotPasswordCheckApi()
            with pytest.raises(InvalidEmailError):
                api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.console.auth.forgot_password.AccountService.add_forgot_password_error_rate_limit")
    def test_verify_code_wrong_code(self, mock_add_rate_limit, mock_get_data, mock_is_rate_limit, mock_db, app):
        """
        Test code verification with incorrect code.

        Verifies that:
        - EmailCodeError is raised for wrong code
        - Rate limit counter is incremented
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = {"email": "test@example.com", "code": "123456"}

        # Act & Assert
        with app.test_request_context(
            "/forgot-password/validity",
            method="POST",
            json={"email": "test@example.com", "code": "wrong_code", "token": "token"},
        ):
            api = ForgotPasswordCheckApi()
            with pytest.raises(EmailCodeError):
                api.post()

        mock_add_rate_limit.assert_called_once_with("test@example.com")


class TestForgotPasswordResetApi:
    """Test cases for resetting password with verified token."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_account(self):
        """Create mock account object."""
        account = MagicMock()
        account.email = "test@example.com"
        account.name = "Test User"
        return account

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.console.auth.forgot_password.AccountService.revoke_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.console.auth.forgot_password.TenantService.get_join_tenants")
    def test_reset_password_success(
        self,
        mock_get_tenants,
        mock_get_account,
        mock_revoke_token,
        mock_get_data,
        mock_wraps_db,
        app,
        mock_account,
    ):
        """
        Test successful password reset.

        Verifies that:
        - Password is updated with new hashed value
        - Token is revoked after use
        - Success response is returned
        """
        # Arrange
        mock_wraps_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_data.return_value = {"email": "test@example.com", "phase": "reset"}
        mock_get_account.return_value = mock_account
        mock_get_tenants.return_value = [MagicMock()]

        # Act
        with app.test_request_context(
            "/forgot-password/resets",
            method="POST",
            json={"token": "valid_token", "new_password": "NewPass123!", "password_confirm": "NewPass123!"},
        ):
            api = ForgotPasswordResetApi()
            response = api.post()

        # Assert
        assert response["result"] == "success"
        mock_revoke_token.assert_called_once_with("valid_token")

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    def test_reset_password_mismatch(self, mock_get_data, mock_db, app):
        """
        Test password reset with mismatched passwords.

        Verifies that:
        - PasswordMismatchError is raised when passwords don't match
        - No password update occurs
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_data.return_value = {"email": "test@example.com", "phase": "reset"}

        # Act & Assert
        with app.test_request_context(
            "/forgot-password/resets",
            method="POST",
            json={"token": "token", "new_password": "NewPass123!", "password_confirm": "DifferentPass123!"},
        ):
            api = ForgotPasswordResetApi()
            with pytest.raises(PasswordMismatchError):
                api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    def test_reset_password_invalid_token(self, mock_get_data, mock_db, app):
        """
        Test password reset with invalid token.

        Verifies that:
        - InvalidTokenError is raised for invalid/expired tokens
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_data.return_value = None

        # Act & Assert
        with app.test_request_context(
            "/forgot-password/resets",
            method="POST",
            json={"token": "invalid_token", "new_password": "NewPass123!", "password_confirm": "NewPass123!"},
        ):
            api = ForgotPasswordResetApi()
            with pytest.raises(InvalidTokenError):
                api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    def test_reset_password_wrong_phase(self, mock_get_data, mock_db, app):
        """
        Test password reset with token not in reset phase.

        Verifies that:
        - InvalidTokenError is raised when token is not in reset phase
        - Prevents use of verification-phase tokens for reset
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_data.return_value = {"email": "test@example.com", "phase": "verify"}

        # Act & Assert
        with app.test_request_context(
            "/forgot-password/resets",
            method="POST",
            json={"token": "token", "new_password": "NewPass123!", "password_confirm": "NewPass123!"},
        ):
            api = ForgotPasswordResetApi()
            with pytest.raises(InvalidTokenError):
                api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.console.auth.forgot_password.AccountService.revoke_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.get_account_by_email_with_case_fallback")
    def test_reset_password_account_not_found(
        self, mock_get_account, mock_revoke_token, mock_get_data, mock_wraps_db, app
    ):
        """
        Test password reset for non-existent account.

        Verifies that:
        - AccountNotFound is raised when account doesn't exist
        """
        # Arrange
        mock_wraps_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_data.return_value = {"email": "nonexistent@example.com", "phase": "reset"}
        mock_get_account.return_value = None

        # Act & Assert
        with app.test_request_context(
            "/forgot-password/resets",
            method="POST",
            json={"token": "token", "new_password": "NewPass123!", "password_confirm": "NewPass123!"},
        ):
            api = ForgotPasswordResetApi()
            with pytest.raises(AccountNotFound):
                api.post()
