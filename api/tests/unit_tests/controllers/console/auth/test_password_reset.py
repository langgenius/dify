"""Unit tests for password reset controller flows."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session, scoped_session, sessionmaker

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
from enums.deployment_edition import DeploymentEdition
from models.account import Account, Tenant, TenantAccountJoin
from services.feature_service import SystemFeatureModel

SQLITE_MODELS = (Account, Tenant, TenantAccountJoin)


@contextmanager
def _bind_database_session(session: Session) -> Generator[scoped_session[Session]]:
    """Bind the controller's session proxy to the SQLite test engine."""

    database_session = scoped_session(sessionmaker(bind=session.get_bind(), expire_on_commit=False))
    try:
        with patch("controllers.console.auth.forgot_password.db.session", database_session):
            yield database_session
    finally:
        database_session.remove()


@pytest.fixture(autouse=True)
def enable_password_login_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep endpoint decorators deterministic without requiring the configured app database."""

    monkeypatch.setattr("controllers.console.wraps.dify_config.EDITION", "CLOUD")
    monkeypatch.setattr(
        "controllers.console.wraps.FeatureService.get_system_features",
        lambda: SystemFeatureModel(
            deployment_edition=DeploymentEdition.COMMUNITY,
            enable_email_password_login=True,
        ),
    )


class TestForgotPasswordSendEmailApi:
    """Test cases for sending password reset emails."""

    @pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)
    @patch("controllers.console.auth.forgot_password.AccountService.is_email_send_ip_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.send_reset_password_email")
    def test_send_reset_email_success(
        self,
        mock_send_email,
        mock_is_ip_limit,
        app: Flask,
        sqlite_session: Session,
    ):
        # Arrange
        mock_is_ip_limit.return_value = False
        mock_send_email.return_value = "reset_token_123"

        # Act
        with (
            _bind_database_session(sqlite_session),
            app.test_request_context(
                "/forgot-password", method="POST", json={"email": "test@example.com", "language": "en-US"}
            ),
        ):
            api = ForgotPasswordSendEmailApi()
            response = api.post()

        # Assert
        assert response["result"] == "success"
        assert response["data"] == "reset_token_123"
        mock_send_email.assert_called_once()

    @patch("controllers.console.auth.forgot_password.AccountService.is_email_send_ip_limit")
    def test_send_reset_email_ip_rate_limited(self, mock_is_ip_limit, app: Flask):
        """
        Test password reset email blocked by IP rate limit.

        Verifies that:
        - EmailSendIpLimitError is raised when IP limit exceeded
        - No email is sent when rate limited
        """
        # Arrange
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
    @pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)
    @patch("controllers.console.auth.forgot_password.AccountService.is_email_send_ip_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.send_reset_password_email")
    def test_send_reset_email_language_handling(
        self,
        mock_send_email,
        mock_is_ip_limit,
        language_input,
        expected_language,
        app: Flask,
        sqlite_session: Session,
    ):
        """
        Test password reset email with different language preferences.

        Verifies that:
        - Language parameter is correctly processed
        - Unsupported languages default to en-US
        """
        # Arrange
        mock_is_ip_limit.return_value = False
        mock_send_email.return_value = "token"

        # Act
        with (
            _bind_database_session(sqlite_session),
            app.test_request_context(
                "/forgot-password", method="POST", json={"email": "test@example.com", "language": language_input}
            ),
        ):
            api = ForgotPasswordSendEmailApi()
            api.post()

        # Assert
        call_args = mock_send_email.call_args
        assert call_args.kwargs["language"] == expected_language


class TestForgotPasswordCheckApi:
    """Test cases for verifying password reset codes."""

    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.console.auth.forgot_password.AccountService.revoke_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.generate_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.reset_forgot_password_error_rate_limit")
    def test_verify_code_success(
        self,
        mock_reset_rate_limit: MagicMock,
        mock_generate_token: MagicMock,
        mock_revoke_token: MagicMock,
        mock_get_data: MagicMock,
        mock_is_rate_limit,
        app: Flask,
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

    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.console.auth.forgot_password.AccountService.revoke_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.generate_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.reset_forgot_password_error_rate_limit")
    def test_verify_code_preserves_token_email_case(
        self,
        mock_reset_rate_limit: MagicMock,
        mock_generate_token: MagicMock,
        mock_revoke_token: MagicMock,
        mock_get_data: MagicMock,
        mock_is_rate_limit,
        app: Flask,
    ):
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

    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    def test_verify_code_rate_limited(self, mock_is_rate_limit, app: Flask):
        """
        Test code verification blocked by rate limit.

        Verifies that:
        - EmailPasswordResetLimitError is raised when limit exceeded
        - Prevents brute force attacks on verification codes
        """
        # Arrange
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

    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    def test_verify_code_invalid_token(self, mock_get_data, mock_is_rate_limit, app: Flask):
        """
        Test code verification with invalid token.

        Verifies that:
        - InvalidTokenError is raised for invalid/expired tokens
        """
        # Arrange
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

    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    def test_verify_code_email_mismatch(self, mock_get_data, mock_is_rate_limit, app: Flask):
        """
        Test code verification with mismatched email.

        Verifies that:
        - InvalidEmailError is raised when email doesn't match token
        - Prevents token abuse
        """
        # Arrange
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

    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.console.auth.forgot_password.AccountService.add_forgot_password_error_rate_limit")
    def test_verify_code_wrong_code(self, mock_add_rate_limit, mock_get_data, mock_is_rate_limit, app: Flask):
        """
        Test code verification with incorrect code.

        Verifies that:
        - EmailCodeError is raised for wrong code
        - Rate limit counter is incremented
        """
        # Arrange
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

    @pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.console.auth.forgot_password.AccountService.revoke_reset_password_token")
    def test_reset_password_success(
        self,
        mock_revoke_token: MagicMock,
        mock_get_data: MagicMock,
        app: Flask,
        sqlite_session: Session,
    ):
        """
        Test successful password reset.

        Verifies that:
        - Password is updated with new hashed value
        - Token is revoked after use
        - Success response is returned
        """
        # Arrange
        mock_get_data.return_value = {"email": "test@example.com", "phase": "reset"}

        # Act
        with _bind_database_session(sqlite_session) as database_session:
            account = Account(name="Test User", email="test@example.com")
            tenant = Tenant(name="Test Workspace")
            database_session.add_all([account, tenant])
            database_session.flush()
            database_session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=account.id))
            database_session.commit()
            account_id = account.id

            with app.test_request_context(
                "/forgot-password/resets",
                method="POST",
                json={
                    "token": "valid_token",
                    "new_password": "NewPass123!",
                    "password_confirm": "NewPass123!",
                },
            ):
                api = ForgotPasswordResetApi()
                response = api.post()

            updated_account = database_session.get(Account, account_id)

        # Assert
        assert response["result"] == "success"
        mock_revoke_token.assert_called_once_with("valid_token")
        assert updated_account is not None
        assert updated_account.password is not None
        assert updated_account.password_salt is not None

    def test_reset_password_mismatch(self, app: Flask):
        """
        Test password reset with mismatched passwords.

        Verifies that:
        - PasswordMismatchError is raised when passwords don't match
        - No password update occurs
        """
        # Act & Assert
        with app.test_request_context(
            "/forgot-password/resets",
            method="POST",
            json={"token": "token", "new_password": "NewPass123!", "password_confirm": "DifferentPass123!"},
        ):
            api = ForgotPasswordResetApi()
            with pytest.raises(PasswordMismatchError):
                api.post()

    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    def test_reset_password_invalid_token(self, mock_get_data, app: Flask):
        """
        Test password reset with invalid token.

        Verifies that:
        - InvalidTokenError is raised for invalid/expired tokens
        """
        # Arrange
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

    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    def test_reset_password_wrong_phase(self, mock_get_data, app: Flask):
        """
        Test password reset with token not in reset phase.

        Verifies that:
        - InvalidTokenError is raised when token is not in reset phase
        - Prevents use of verification-phase tokens for reset
        """
        # Arrange
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

    @pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.console.auth.forgot_password.AccountService.revoke_reset_password_token")
    def test_reset_password_account_not_found(
        self, mock_revoke_token, mock_get_data, app: Flask, sqlite_session: Session
    ):
        """
        Test password reset for non-existent account.

        Verifies that:
        - AccountNotFound is raised when account doesn't exist
        """
        # Arrange
        mock_get_data.return_value = {"email": "nonexistent@example.com", "phase": "reset"}

        # Act & Assert
        with (
            _bind_database_session(sqlite_session),
            app.test_request_context(
                "/forgot-password/resets",
                method="POST",
                json={"token": "token", "new_password": "NewPass123!", "password_confirm": "NewPass123!"},
            ),
        ):
            api = ForgotPasswordResetApi()
            with pytest.raises(AccountNotFound):
                api.post()
