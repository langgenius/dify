"""
Test suite for login and logout authentication flows.

This module tests the core authentication endpoints including:
- Email/password login with rate limiting
- Session management and logout
- Cookie-based token handling
- Account status validation
"""

import base64
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask_restx import Api

from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailPasswordLoginLimitError,
    InvalidEmailError,
)
from controllers.console.auth.login import LoginApi, LogoutApi
from controllers.console.error import (
    AccountBannedError,
    AccountInFreezeError,
    WorkspacesLimitExceeded,
)
from services.errors.account import AccountLoginError, AccountPasswordError


def encode_password(password: str) -> str:
    """Helper to encode password as Base64 for testing."""
    return base64.b64encode(password.encode("utf-8")).decode()


class TestLoginApi:
    """Test cases for the LoginApi endpoint."""

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
        api.add_resource(LoginApi, "/login")
        return app.test_client()

    @pytest.fixture
    def mock_account(self):
        """Create mock account object."""
        account = MagicMock()
        account.id = "test-account-id"
        account.email = "test@example.com"
        account.name = "Test User"
        return account

    @pytest.fixture
    def mock_token_pair(self):
        """Create mock token pair object."""
        token_pair = MagicMock()
        token_pair.access_token = "mock_access_token"
        token_pair.refresh_token = "mock_refresh_token"
        token_pair.csrf_token = "mock_csrf_token"
        return token_pair

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.BILLING_ENABLED", False)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_with_case_fallback")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.AccountService.login")
    @patch("controllers.console.auth.login.AccountService.reset_login_error_rate_limit")
    def test_successful_login_without_invitation(
        self,
        mock_reset_rate_limit,
        mock_login,
        mock_get_tenants,
        mock_authenticate,
        mock_get_invitation,
        mock_is_rate_limit,
        mock_db,
        app,
        mock_account,
        mock_token_pair,
    ):
        """
        Test successful login flow without invitation token.

        Verifies that:
        - Valid credentials authenticate successfully
        - Tokens are generated and set in cookies
        - Rate limit is reset after successful login
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = False
        mock_get_invitation.return_value = None
        mock_authenticate.return_value = mock_account
        mock_get_tenants.return_value = [MagicMock()]  # Has at least one tenant
        mock_login.return_value = mock_token_pair

        # Act
        with app.test_request_context(
            "/login",
            method="POST",
            json={"email": "test@example.com", "password": encode_password("ValidPass123!")},
        ):
            login_api = LoginApi()
            response = login_api.post()

        # Assert
        mock_authenticate.assert_called_once_with("test@example.com", "ValidPass123!", None)
        mock_login.assert_called_once()
        mock_reset_rate_limit.assert_called_once_with("test@example.com")
        assert response.json["result"] == "success"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.BILLING_ENABLED", False)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_with_case_fallback")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.AccountService.login")
    @patch("controllers.console.auth.login.AccountService.reset_login_error_rate_limit")
    def test_successful_login_with_valid_invitation(
        self,
        mock_reset_rate_limit,
        mock_login,
        mock_get_tenants,
        mock_authenticate,
        mock_get_invitation,
        mock_is_rate_limit,
        mock_db,
        app,
        mock_account,
        mock_token_pair,
    ):
        """
        Test successful login with valid invitation token.

        Verifies that:
        - Invitation token is validated
        - Email matches invitation email
        - Authentication proceeds with invitation token
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = False
        mock_get_invitation.return_value = {"data": {"email": "test@example.com"}}
        mock_authenticate.return_value = mock_account
        mock_get_tenants.return_value = [MagicMock()]
        mock_login.return_value = mock_token_pair

        # Act
        with app.test_request_context(
            "/login",
            method="POST",
            json={
                "email": "test@example.com",
                "password": encode_password("ValidPass123!"),
                "invite_token": "valid_token",
            },
        ):
            login_api = LoginApi()
            response = login_api.post()

        # Assert
        mock_authenticate.assert_called_once_with("test@example.com", "ValidPass123!", "valid_token")
        assert response.json["result"] == "success"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.BILLING_ENABLED", False)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_with_case_fallback")
    def test_login_fails_when_rate_limited(self, mock_get_invitation, mock_is_rate_limit, mock_db, app):
        """
        Test login rejection when rate limit is exceeded.

        Verifies that:
        - Rate limit check is performed before authentication
        - EmailPasswordLoginLimitError is raised when limit exceeded
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = True
        mock_get_invitation.return_value = None

        # Act & Assert
        with app.test_request_context(
            "/login", method="POST", json={"email": "test@example.com", "password": encode_password("password")}
        ):
            login_api = LoginApi()
            with pytest.raises(EmailPasswordLoginLimitError):
                login_api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.BILLING_ENABLED", True)
    @patch("controllers.console.auth.login.BillingService.is_email_in_freeze")
    def test_login_fails_when_account_frozen(self, mock_is_frozen, mock_db, app):
        """
        Test login rejection for frozen accounts.

        Verifies that:
        - Billing freeze status is checked when billing enabled
        - AccountInFreezeError is raised for frozen accounts
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_frozen.return_value = True

        # Act & Assert
        with app.test_request_context(
            "/login", method="POST", json={"email": "frozen@example.com", "password": encode_password("password")}
        ):
            login_api = LoginApi()
            with pytest.raises(AccountInFreezeError):
                login_api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.BILLING_ENABLED", False)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_with_case_fallback")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.AccountService.add_login_error_rate_limit")
    def test_login_fails_with_invalid_credentials(
        self,
        mock_add_rate_limit,
        mock_authenticate,
        mock_get_invitation,
        mock_is_rate_limit,
        mock_db,
        app,
    ):
        """
        Test login failure with invalid credentials.

        Verifies that:
        - AuthenticationFailedError is raised for wrong password
        - Login error rate limit counter is incremented
        - Generic error message prevents user enumeration
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = False
        mock_get_invitation.return_value = None
        mock_authenticate.side_effect = AccountPasswordError("Invalid password")

        # Act & Assert
        with app.test_request_context(
            "/login", method="POST", json={"email": "test@example.com", "password": encode_password("WrongPass123!")}
        ):
            login_api = LoginApi()
            with pytest.raises(AuthenticationFailedError):
                login_api.post()

        mock_add_rate_limit.assert_called_once_with("test@example.com")

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.BILLING_ENABLED", False)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_with_case_fallback")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    def test_login_fails_for_banned_account(
        self, mock_authenticate, mock_get_invitation, mock_is_rate_limit, mock_db, app
    ):
        """
        Test login rejection for banned accounts.

        Verifies that:
        - AccountBannedError is raised for banned accounts
        - Login is prevented even with valid credentials
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = False
        mock_get_invitation.return_value = None
        mock_authenticate.side_effect = AccountLoginError("Account is banned")

        # Act & Assert
        with app.test_request_context(
            "/login", method="POST", json={"email": "banned@example.com", "password": encode_password("ValidPass123!")}
        ):
            login_api = LoginApi()
            with pytest.raises(AccountBannedError):
                login_api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.BILLING_ENABLED", False)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_with_case_fallback")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.FeatureService.get_system_features")
    def test_login_fails_when_no_workspace_and_limit_exceeded(
        self,
        mock_get_features,
        mock_get_tenants,
        mock_authenticate,
        mock_get_invitation,
        mock_is_rate_limit,
        mock_db,
        app,
        mock_account,
    ):
        """
        Test login failure when user has no workspace and workspace limit exceeded.

        Verifies that:
        - WorkspacesLimitExceeded is raised when limit reached
        - User cannot login without an assigned workspace
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = False
        mock_get_invitation.return_value = None
        mock_authenticate.return_value = mock_account
        mock_get_tenants.return_value = []  # No tenants

        mock_features = MagicMock()
        mock_features.is_allow_create_workspace = True
        mock_features.license.workspaces.is_available.return_value = False
        mock_get_features.return_value = mock_features

        # Act & Assert
        with app.test_request_context(
            "/login", method="POST", json={"email": "test@example.com", "password": encode_password("ValidPass123!")}
        ):
            login_api = LoginApi()
            with pytest.raises(WorkspacesLimitExceeded):
                login_api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.BILLING_ENABLED", False)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_with_case_fallback")
    def test_login_invitation_email_mismatch(self, mock_get_invitation, mock_is_rate_limit, mock_db, app):
        """
        Test login failure when invitation email doesn't match login email.

        Verifies that:
        - InvalidEmailError is raised for email mismatch
        - Security check prevents invitation token abuse
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = False
        mock_get_invitation.return_value = {"data": {"email": "invited@example.com"}}

        # Act & Assert
        with app.test_request_context(
            "/login",
            method="POST",
            json={
                "email": "different@example.com",
                "password": encode_password("ValidPass123!"),
                "invite_token": "token",
            },
        ):
            login_api = LoginApi()
            with pytest.raises(InvalidEmailError):
                login_api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.BILLING_ENABLED", False)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_with_case_fallback")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.AccountService.add_login_error_rate_limit")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.AccountService.login")
    @patch("controllers.console.auth.login.AccountService.reset_login_error_rate_limit")
    def test_login_retries_with_lowercase_email(
        self,
        mock_reset_rate_limit,
        mock_login_service,
        mock_get_tenants,
        mock_add_rate_limit,
        mock_authenticate,
        mock_get_invitation,
        mock_is_rate_limit,
        mock_db,
        app,
        mock_account,
        mock_token_pair,
    ):
        """Test that login retries with lowercase email when uppercase lookup fails."""
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_is_rate_limit.return_value = False
        mock_get_invitation.return_value = None
        mock_authenticate.side_effect = [AccountPasswordError("Invalid"), mock_account]
        mock_get_tenants.return_value = [MagicMock()]
        mock_login_service.return_value = mock_token_pair

        with app.test_request_context(
            "/login",
            method="POST",
            json={"email": "Upper@Example.com", "password": encode_password("ValidPass123!")},
        ):
            response = LoginApi().post()

        assert response.json["result"] == "success"
        assert mock_authenticate.call_args_list == [
            (("Upper@Example.com", "ValidPass123!", None), {}),
            (("upper@example.com", "ValidPass123!", None), {}),
        ]
        mock_add_rate_limit.assert_not_called()
        mock_reset_rate_limit.assert_called_once_with("upper@example.com")


class TestLogoutApi:
    """Test cases for the LogoutApi endpoint."""

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
        account.id = "test-account-id"
        account.email = "test@example.com"
        return account

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.current_account_with_tenant")
    @patch("controllers.console.auth.login.AccountService.logout")
    @patch("controllers.console.auth.login.flask_login.logout_user")
    def test_successful_logout(
        self, mock_logout_user, mock_service_logout, mock_current_account, mock_db, app, mock_account
    ):
        """
        Test successful logout flow.

        Verifies that:
        - User session is terminated
        - AccountService.logout is called
        - All authentication cookies are cleared
        - Success response is returned
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_current_account.return_value = (mock_account, MagicMock())

        # Act
        with app.test_request_context("/logout", method="POST"):
            logout_api = LogoutApi()
            response = logout_api.post()

        # Assert
        mock_service_logout.assert_called_once_with(account=mock_account)
        mock_logout_user.assert_called_once()
        assert response.json["result"] == "success"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.current_account_with_tenant")
    @patch("controllers.console.auth.login.flask_login")
    def test_logout_anonymous_user(self, mock_flask_login, mock_current_account, mock_db, app):
        """
        Test logout for anonymous (not logged in) user.

        Verifies that:
        - Anonymous users can call logout endpoint
        - No errors are raised
        - Success response is returned
        """
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()
        # Create a mock anonymous user that will pass isinstance check
        anonymous_user = MagicMock()
        mock_flask_login.AnonymousUserMixin = type("AnonymousUserMixin", (), {})
        anonymous_user.__class__ = mock_flask_login.AnonymousUserMixin
        mock_current_account.return_value = (anonymous_user, None)

        # Act
        with app.test_request_context("/logout", method="POST"):
            logout_api = LogoutApi()
            response = logout_api.post()

        # Assert
        assert response.json["result"] == "success"
