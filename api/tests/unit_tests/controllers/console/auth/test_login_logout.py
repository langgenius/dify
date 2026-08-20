"""
Test suite for login and logout authentication flows.

This module tests the core authentication endpoints including:
- Email/password login with rate limiting
- Session management and logout
- Cookie-based token handling
- Account status validation
"""

import base64
import logging
from contextlib import nullcontext
from unittest.mock import ANY, MagicMock, Mock, patch

import pytest
from flask import Flask
from flask_restx import Api
from werkzeug.exceptions import Unauthorized

from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailPasswordLoginLimitError,
    InvalidEmailError,
)
from controllers.console.auth.login import EmailCodeLoginApi, LoginApi, LogoutApi
from controllers.console.error import (
    AccountBannedError,
    AccountInFreezeError,
    SeatsLimitExceeded,
    WorkspacesLimitExceeded,
)
from enums import DeploymentEdition
from services.email_code_login_challenge import EmailCodeLoginChallengeResult, EmailCodeLoginChallengeStatus
from services.entities.auth_entities import LoginFailureReason
from services.errors.account import AccountLoginError, AccountPasswordError, SeatsLimitExceededError

TEST_TOKEN = "00000000-0000-4000-8000-000000000001"


def encode_password(password: str) -> str:
    """Helper to encode password as Base64 for testing."""
    return base64.b64encode(password.encode("utf-8")).decode()


def encode_code(code: str) -> str:
    """Helper to encode verification code as Base64 for testing."""
    return base64.b64encode(code.encode("utf-8")).decode()


from inspect import unwrap


class TestLoginApi:
    """Test cases for the LoginApi endpoint."""

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
    @patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_if_token_valid")
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
        app: Flask,
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
        mock_authenticate.assert_called_once_with("test@example.com", "ValidPass123!", None, session=ANY)
        mock_login.assert_called_once_with(
            account=mock_account,
            session=ANY,
            ip_address=ANY,
            activate_pending=True,
        )
        mock_reset_rate_limit.assert_called_once_with("test@example.com")
        assert response.json["result"] == "success"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_if_token_valid")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.AccountService.login")
    @patch("controllers.console.auth.login.AccountService.reset_login_error_rate_limit")
    def test_successful_login_with_valid_invitation(
        self,
        mock_reset_rate_limit: Mock,
        mock_login,
        mock_get_tenants,
        mock_authenticate,
        mock_get_invitation,
        mock_is_rate_limit,
        mock_db,
        app: Flask,
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
        mock_is_rate_limit.return_value = False
        invitation_data = {
            "account_id": "test-account-id",
            "email": "test@example.com",
            "workspace_id": "workspace-id",
            "role": "normal",
            "inviter_id": "inviter-id",
        }
        mock_get_invitation.return_value = {"data": invitation_data}
        mock_authenticate.return_value = mock_account
        mock_get_tenants.return_value = []
        mock_login.return_value = mock_token_pair

        # Act
        with (
            patch(
                "controllers.console.auth.login.RegisterService.current_invitation",
                return_value=nullcontext(True),
            ) as current_invitation,
            app.test_request_context(
                "/login",
                method="POST",
                json={
                    "email": "Test@Example.com",
                    "password": encode_password("ValidPass123!"),
                    "invite_token": "valid_token",
                },
            ),
        ):
            response = LoginApi().post()

        # Assert
        mock_get_invitation.assert_called_once_with(None, "test@example.com", "valid_token", session=ANY)
        current_invitation.assert_called_once_with("valid_token", invitation_data)
        mock_authenticate.assert_called_once_with("test@example.com", "ValidPass123!", "valid_token", session=ANY)
        mock_login.assert_called_once_with(
            account=mock_account,
            session=ANY,
            ip_address=ANY,
            activate_pending=False,
        )
        assert response.json["result"] == "success"

    @patch("controllers.console.wraps.db", new=MagicMock())
    @patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    @patch(
        "controllers.console.auth.login.AccountService.is_login_error_rate_limit",
        new=MagicMock(return_value=False),
    )
    @patch("controllers.console.auth.login.RegisterService.get_invitation_if_token_valid")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    def test_superseded_invitation_cannot_set_initial_password(
        self,
        mock_authenticate: MagicMock,
        mock_get_invitation: MagicMock,
        app: Flask,
    ) -> None:
        invitation_data = {
            "account_id": "test-account-id",
            "email": "test@example.com",
            "workspace_id": "workspace-id",
            "role": "normal",
            "inviter_id": "inviter-id",
        }
        mock_get_invitation.return_value = {"data": invitation_data}

        with (
            patch(
                "controllers.console.auth.login.RegisterService.current_invitation",
                return_value=nullcontext(False),
            ),
            app.test_request_context(
                "/login",
                method="POST",
                json={
                    "email": "test@example.com",
                    "password": encode_password("ValidPass123!"),
                    "invite_token": "superseded-token",
                },
            ),
            pytest.raises(AuthenticationFailedError),
        ):
            LoginApi().post()

        mock_authenticate.assert_not_called()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_if_token_valid")
    def test_login_fails_when_rate_limited(
        self, mock_get_invitation, mock_is_rate_limit, mock_db, app: Flask, caplog: pytest.LogCaptureFixture
    ):
        """
        Test login rejection when rate limit is exceeded.

        Verifies that:
        - Rate limit check is performed before authentication
        - EmailPasswordLoginLimitError is raised when limit exceeded
        """
        # Arrange
        mock_is_rate_limit.return_value = True
        mock_get_invitation.return_value = None

        # Act & Assert
        with app.test_request_context(
            "/login", method="POST", json={"email": "test@example.com", "password": encode_password("password")}
        ):
            login_api = LoginApi()
            with pytest.raises(EmailPasswordLoginLimitError):
                login_api.post()

        warn_records = [
            r for r in caplog.records if r.name == "controllers.console.auth.login" and r.levelno == logging.WARNING
        ]
        assert len(warn_records) == 1
        assert warn_records[0].args[0] == "test@example.com"
        assert warn_records[0].args[1] == LoginFailureReason.LOGIN_RATE_LIMITED

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    @patch("controllers.console.auth.login.BillingService.is_email_in_freeze")
    def test_login_fails_when_account_frozen(
        self, mock_is_frozen, mock_db, app: Flask, caplog: pytest.LogCaptureFixture
    ):
        """
        Test login rejection for frozen accounts.

        Verifies that:
        - Billing freeze status is checked when billing enabled
        - AccountInFreezeError is raised for frozen accounts
        """
        # Arrange
        mock_is_frozen.return_value = True

        # Act & Assert
        with app.test_request_context(
            "/login", method="POST", json={"email": "frozen@example.com", "password": encode_password("password")}
        ):
            login_api = LoginApi()
            with pytest.raises(AccountInFreezeError):
                login_api.post()

        warn_records = [
            r for r in caplog.records if r.name == "controllers.console.auth.login" and r.levelno == logging.WARNING
        ]
        assert len(warn_records) == 1
        assert warn_records[0].args[0] == "frozen@example.com"
        assert warn_records[0].args[1] == LoginFailureReason.ACCOUNT_IN_FREEZE

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_if_token_valid")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.AccountService.add_login_error_rate_limit")
    def test_login_fails_with_invalid_credentials(
        self,
        mock_add_rate_limit,
        mock_authenticate,
        mock_get_invitation,
        mock_is_rate_limit,
        mock_db,
        app: Flask,
        caplog: pytest.LogCaptureFixture,
    ):
        """
        Test login failure with invalid credentials.

        Verifies that:
        - AuthenticationFailedError is raised for wrong password
        - Login error rate limit counter is incremented
        - Generic error message prevents user enumeration
        """
        # Arrange
        mock_is_rate_limit.return_value = False
        mock_get_invitation.return_value = None
        mock_authenticate.side_effect = AccountPasswordError("Invalid password")

        # Act & Assert
        with app.test_request_context(
            "/login",
            method="POST",
            json={"email": "test@example.com", "password": encode_password("WrongPass123!")},
        ):
            login_api = LoginApi()
            with pytest.raises(AuthenticationFailedError):
                login_api.post()

        mock_add_rate_limit.assert_called_once_with("test@example.com")
        warn_records = [
            r for r in caplog.records if r.name == "controllers.console.auth.login" and r.levelno == logging.WARNING
        ]
        assert len(warn_records) == 1
        assert warn_records[0].args[0] == "test@example.com"
        assert warn_records[0].args[1] == LoginFailureReason.INVALID_CREDENTIALS

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_if_token_valid")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    def test_login_fails_for_banned_account(
        self, mock_authenticate, mock_get_invitation, mock_is_rate_limit, mock_db, app: Flask, caplog
    ):
        """
        Test login rejection for banned accounts.

        Verifies that:
        - AccountBannedError is raised for banned accounts
        - Login is prevented even with valid credentials
        """
        # Arrange
        mock_is_rate_limit.return_value = False
        mock_get_invitation.return_value = None
        mock_authenticate.side_effect = AccountLoginError("Account is banned")

        # Act & Assert
        with app.test_request_context(
            "/login",
            method="POST",
            json={"email": "banned@example.com", "password": encode_password("ValidPass123!")},
        ):
            login_api = LoginApi()
            with pytest.raises(AccountBannedError):
                login_api.post()

        warn_records = [
            r for r in caplog.records if r.name == "controllers.console.auth.login" and r.levelno == logging.WARNING
        ]
        assert len(warn_records) == 1
        assert warn_records[0].args[0] == "banned@example.com"
        assert warn_records[0].args[1] == LoginFailureReason.ACCOUNT_BANNED

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_if_token_valid")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.FeatureService.get_license")
    @patch("controllers.console.auth.login.FeatureService.is_workspace_creation_allowed")
    def test_login_fails_when_no_workspace_and_limit_exceeded(
        self,
        mock_is_workspace_creation_allowed: MagicMock,
        mock_get_license: MagicMock,
        mock_get_tenants: MagicMock,
        mock_authenticate: MagicMock,
        mock_get_invitation: MagicMock,
        mock_is_rate_limit: MagicMock,
        mock_db: MagicMock,
        app: Flask,
        mock_account: MagicMock,
    ):
        """
        Test login failure when user has no workspace and workspace limit exceeded.

        Verifies that:
        - WorkspacesLimitExceeded is raised when limit reached
        - User cannot login without an assigned workspace
        """
        # Arrange
        mock_is_rate_limit.return_value = False
        mock_get_invitation.return_value = None
        mock_authenticate.return_value = mock_account
        mock_get_tenants.return_value = []  # No tenants

        mock_is_workspace_creation_allowed.return_value = True
        mock_get_license.return_value.workspaces.is_available.return_value = False

        # Act & Assert
        with (
            patch("controllers.console.auth.login.AccountService.login") as login,
            app.test_request_context(
                "/login",
                method="POST",
                json={"email": "test@example.com", "password": encode_password("ValidPass123!")},
            ),
        ):
            with pytest.raises(WorkspacesLimitExceeded):
                LoginApi().post()

        login.assert_not_called()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_if_token_valid")
    def test_login_invitation_email_mismatch(self, mock_get_invitation, mock_is_rate_limit, mock_db, app: Flask):
        """
        Test login failure when invitation email doesn't match login email.

        Verifies that:
        - InvalidEmailError is raised for email mismatch
        - Security check prevents invitation token abuse
        """
        # Arrange
        mock_is_rate_limit.return_value = False
        invitation_data = {
            "account_id": "test-account-id",
            "email": "invited@example.com",
            "workspace_id": "workspace-id",
            "role": "normal",
            "inviter_id": "inviter-id",
        }
        mock_get_invitation.return_value = {"data": invitation_data}

        # Act & Assert
        with (
            patch(
                "controllers.console.auth.login.RegisterService.current_invitation",
                return_value=nullcontext(True),
            ),
            app.test_request_context(
                "/login",
                method="POST",
                json={
                    "email": "different@example.com",
                    "password": encode_password("ValidPass123!"),
                    "invite_token": "token",
                },
            ),
            pytest.raises(InvalidEmailError),
        ):
            LoginApi().post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.RegisterService.get_invitation_if_token_valid")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.AccountService.add_login_error_rate_limit")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.AccountService.login")
    @patch("controllers.console.auth.login.AccountService.reset_login_error_rate_limit")
    def test_login_retries_with_lowercase_email(
        self,
        mock_reset_rate_limit: MagicMock,
        mock_login_service: MagicMock,
        mock_get_tenants: MagicMock,
        mock_add_rate_limit: MagicMock,
        mock_authenticate: MagicMock,
        mock_get_invitation: MagicMock,
        mock_is_rate_limit: MagicMock,
        mock_db,
        app: Flask,
        mock_account,
        mock_token_pair,
    ):
        """Test that login retries with lowercase email when uppercase lookup fails."""
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
            (("Upper@Example.com", "ValidPass123!", None), {"session": ANY}),
            (("upper@example.com", "ValidPass123!", None), {"session": ANY}),
        ]
        mock_add_rate_limit.assert_not_called()
        mock_reset_rate_limit.assert_called_once_with("upper@example.com")

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    @patch("controllers.console.auth.login._get_account_with_case_fallback")
    def test_email_code_login_logs_banned_account(
        self,
        mock_get_account: MagicMock,
        mock_verify_challenge: MagicMock,
        mock_db: MagicMock,
        app: Flask,
        caplog: pytest.LogCaptureFixture,
    ):
        mock_verify_challenge.return_value = EmailCodeLoginChallengeResult(
            status=EmailCodeLoginChallengeStatus.VERIFIED
        )
        mock_get_account.side_effect = Unauthorized("Account is banned.")

        with app.test_request_context(
            "/email-code-login/validity",
            method="POST",
            json={"email": "User@Example.com", "code": encode_code("123456"), "token": TEST_TOKEN},
        ):
            with pytest.raises(AccountBannedError):
                EmailCodeLoginApi().post()

        warn_records = [
            r for r in caplog.records if r.name == "controllers.console.auth.login" and r.levelno == logging.WARNING
        ]
        assert len(warn_records) == 1
        assert warn_records[0].args[0] == "user@example.com"
        assert warn_records[0].args[1] == LoginFailureReason.ACCOUNT_BANNED

    @patch("controllers.console.wraps.db", new=MagicMock())
    @patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    def test_email_code_invitation_login_keeps_zero_tenant_account_pending(
        self,
        app: Flask,
        mock_account: MagicMock,
        mock_token_pair: MagicMock,
    ) -> None:
        invitation_data = {
            "account_id": mock_account.id,
            "email": mock_account.email,
            "workspace_id": "workspace-id",
            "role": "normal",
            "inviter_id": "inviter-id",
        }
        with (
            patch(
                "controllers.console.auth.login.AccountService.verify_email_code_login_challenge",
                return_value=EmailCodeLoginChallengeResult(status=EmailCodeLoginChallengeStatus.VERIFIED),
            ),
            patch(
                "controllers.console.auth.login.RegisterService.get_invitation_if_token_valid",
                return_value={"account": mock_account, "data": invitation_data, "tenant": MagicMock()},
            ) as get_invitation,
            patch(
                "controllers.console.auth.login.RegisterService.current_invitation",
                return_value=nullcontext(True),
            ) as current_invitation,
            patch("controllers.console.auth.login._get_account_with_case_fallback", return_value=mock_account),
            patch("controllers.console.auth.login.TenantService.get_join_tenants", return_value=[]),
            patch(
                "controllers.console.auth.login.TenantService.create_owner_tenant_if_not_exist"
            ) as create_owner_tenant,
            patch("controllers.console.auth.login.FeatureService.get_license") as get_license,
            patch("controllers.console.auth.login.FeatureService.is_workspace_creation_allowed") as creation_allowed,
            patch("controllers.console.auth.login.AccountService.create_account_and_tenant") as create_account,
            patch("controllers.console.auth.login.AccountService.login", return_value=mock_token_pair) as login,
            patch("controllers.console.auth.login.AccountService.reset_login_error_rate_limit"),
            app.test_request_context(
                "/email-code-login/validity",
                method="POST",
                json={
                    "email": mock_account.email,
                    "code": encode_code("123456"),
                    "token": TEST_TOKEN,
                    "invite_token": "invite-token",
                },
            ),
        ):
            response = EmailCodeLoginApi().post()

        assert response.json["result"] == "success"
        get_invitation.assert_called_once_with(None, mock_account.email, "invite-token", session=ANY)
        current_invitation.assert_called_once_with("invite-token", invitation_data)
        create_owner_tenant.assert_not_called()
        get_license.assert_not_called()
        creation_allowed.assert_not_called()
        create_account.assert_not_called()
        login.assert_called_once_with(
            mock_account,
            session=ANY,
            ip_address=ANY,
            activate_pending=False,
        )

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.db")
    @patch("controllers.console.auth.login.AccountService.create_account_and_tenant")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    @patch("controllers.console.auth.login._get_account_with_case_fallback")
    def test_email_code_login_fails_when_seats_limit_exceeded(
        self,
        mock_get_account: MagicMock,
        mock_verify_challenge: MagicMock,
        mock_create_account: MagicMock,
        mock_login_db: MagicMock,
        mock_db: MagicMock,
        app: Flask,
    ):
        """
        Test email-code login failure when creating the account would exceed the licensed seats.

        Verifies that:
        - the new-account path is taken when no account exists for the email
        - the service-layer SeatsLimitExceededError is translated to the SeatsLimitExceeded HTTP error
        """
        # Arrange: valid token, no existing account -> account-creation path
        mock_verify_challenge.return_value = EmailCodeLoginChallengeResult(
            status=EmailCodeLoginChallengeStatus.VERIFIED
        )
        mock_get_account.return_value = None
        mock_create_account.side_effect = SeatsLimitExceededError("licensed seats limit exceeded")

        # Act & Assert
        with app.test_request_context(
            "/email-code-login/validity",
            method="POST",
            json={"email": "User@Example.com", "code": encode_code("123456"), "token": TEST_TOKEN},
        ):
            with pytest.raises(SeatsLimitExceeded):
                EmailCodeLoginApi().post()

        mock_create_account.assert_called_once()


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

    @patch("controllers.console.auth.login.AccountService.logout")
    @patch("controllers.console.auth.login.flask_login.logout_user")
    def test_successful_logout(
        self, mock_logout_user: MagicMock, mock_service_logout: MagicMock, app: Flask, mock_account
    ):
        """
        Test successful logout flow.

        Verifies that:
        - User session is terminated
        - AccountService.logout is called
        - All authentication cookies are cleared
        - Success response is returned
        """
        # Act
        with app.test_request_context("/logout", method="POST"):
            logout_api = LogoutApi()
            response = unwrap(logout_api.post)(logout_api, mock_account)

        # Assert
        mock_service_logout.assert_called_once_with(account=mock_account)
        mock_logout_user.assert_called_once()
        assert response.json["result"] == "success"

    @patch("controllers.console.auth.login.flask_login")
    def test_logout_anonymous_user(self, mock_flask_login, app: Flask):
        """
        Test logout for anonymous (not logged in) user.

        Verifies that:
        - Anonymous users can call logout endpoint
        - No errors are raised
        - Success response is returned
        """
        # Arrange
        # Create a mock anonymous user that will pass isinstance check
        anonymous_user = MagicMock()
        mock_flask_login.AnonymousUserMixin = type("AnonymousUserMixin", (), {})
        anonymous_user.__class__ = mock_flask_login.AnonymousUserMixin

        # Act
        with app.test_request_context("/logout", method="POST"):
            logout_api = LogoutApi()
            response = unwrap(logout_api.post)(logout_api, anonymous_user)

        # Assert
        assert response.json["result"] == "success"
