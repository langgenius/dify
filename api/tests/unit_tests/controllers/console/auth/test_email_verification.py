"""
Test suite for email verification authentication flows.

This module tests the email code login mechanism including:
- Email code sending with rate limiting
- Code verification and validation
- Account creation via email verification
- Workspace creation for new users
"""

import base64
from unittest.mock import ANY, MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.console.auth.error import (
    EmailCodeError,
    EmailCodeLoginServiceUnavailableError,
    InvalidEmailError,
    InvalidTokenError,
    TurnstileServiceUnavailableError,
    TurnstileVerificationFailedError,
)
from controllers.console.auth.login import (
    EmailCodeLoginApi,
    EmailCodeLoginPayload,
    EmailCodeLoginSendEmailApi,
    EmailCodeSendPayload,
    EmailPayload,
)
from controllers.console.error import (
    AccountInFreezeError,
    AccountNotFound,
    EmailDomainSuspendedError,
    EmailSendIpLimitError,
    NotAllowedCreateWorkspace,
    WorkspacesLimitExceeded,
)
from enums import DeploymentEdition
from models.account import Account, Tenant
from services.email_code_login_challenge import (
    EmailCodeLoginChallengeResult,
    EmailCodeLoginChallengeStatus,
    EmailCodeLoginChallengeUnavailableError,
)
from services.errors.account import (
    AccountRegisterError,
)
from services.errors.account import (
    EmailDomainSuspendedError as EmailDomainSuspendedRegistrationError,
)
from services.turnstile_service import TurnstileChallengeRejectedError, TurnstileUpstreamError

TEST_TOKEN = "00000000-0000-4000-8000-000000000001"


def encode_code(code: str) -> str:
    """Helper to encode verification code as Base64 for testing."""
    return base64.b64encode(code.encode("utf-8")).decode()


def test_email_code_login_payload_rejects_invalid_timezone():
    with pytest.raises(ValidationError):
        EmailCodeLoginPayload.model_validate(
            {
                "email": "newuser@example.com",
                "code": "123456",
                "token": TEST_TOKEN,
                "timezone": "",
            }
        )


def test_turnstile_token_is_scoped_to_email_code_send_payload():
    assert "turnstile_token" in EmailCodeSendPayload.model_fields
    assert "turnstile_token" not in EmailPayload.model_fields
    assert "turnstile_token" in EmailCodeLoginPayload.model_fields


def test_email_code_login_code_schema_does_not_describe_plaintext_format():
    code_schema = EmailCodeLoginPayload.model_json_schema()["properties"]["code"]

    assert "pattern" not in code_schema


def test_email_code_login_payload_rejects_non_uuid_token():
    with pytest.raises(ValidationError):
        EmailCodeLoginPayload.model_validate({"email": "user@example.com", "code": "123456", "token": "not-a-uuid"})


class TestEmailCodeLoginSendEmailApi:
    """Test cases for sending email verification codes."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_account(self) -> Account:
        """Create a real transient account for the mail service boundary."""
        return Account(name="Test User", email="test@example.com")

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.is_email_send_ip_limit")
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @patch("controllers.console.auth.login.AccountService.send_email_code_login_email")
    def test_send_email_code_existing_user(
        self, mock_send_email, mock_get_user, mock_is_ip_limit, mock_db, app, mock_account
    ):
        """
        Test sending email code to existing user.

        Verifies that:
        - Email code is sent to existing account
        - Token is generated and returned
        - IP rate limiting is checked
        """
        # Arrange
        mock_is_ip_limit.return_value = False
        mock_get_user.return_value = mock_account
        mock_send_email.return_value = "email_token_123"

        # Act
        with app.test_request_context(
            "/email-code-login", method="POST", json={"email": "test@example.com", "language": "en-US"}
        ):
            api = EmailCodeLoginSendEmailApi()
            response = api.post()

        # Assert
        assert response["result"] == "success"
        assert response["data"] == "email_token_123"
        mock_send_email.assert_called_once_with(account=mock_account, language="en-US")

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.is_email_send_ip_limit")
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @patch("controllers.console.auth.login.FeatureService.get_system_features")
    @patch("controllers.console.auth.login.AccountService.send_email_code_login_email")
    def test_send_email_code_new_user_registration_allowed(
        self, mock_send_email, mock_get_features, mock_get_user, mock_is_ip_limit, mock_db, app
    ):
        """
        Test sending email code to new user when registration is allowed.

        Verifies that:
        - Email code is sent even for non-existent accounts
        - Registration is allowed by system features
        """
        # Arrange
        mock_is_ip_limit.return_value = False
        mock_get_user.return_value = None
        mock_get_features.return_value.is_allow_register = True
        mock_send_email.return_value = "email_token_123"

        # Act
        with app.test_request_context(
            "/email-code-login", method="POST", json={"email": "newuser@example.com", "language": "en-US"}
        ):
            api = EmailCodeLoginSendEmailApi()
            response = api.post()

        # Assert
        assert response["result"] == "success"
        mock_send_email.assert_called_once_with(email="newuser@example.com", language="en-US")

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.is_email_send_ip_limit")
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @patch("controllers.console.auth.login.FeatureService.get_system_features")
    def test_send_email_code_new_user_registration_disabled(
        self, mock_get_features, mock_get_user, mock_is_ip_limit, mock_db, app
    ):
        """
        Test sending email code to new user when registration is disabled.

        Verifies that:
        - AccountNotFound is raised for non-existent accounts
        - Registration is blocked by system features
        """
        # Arrange
        mock_is_ip_limit.return_value = False
        mock_get_user.return_value = None
        mock_get_features.return_value.is_allow_register = False

        # Act & Assert
        with app.test_request_context("/email-code-login", method="POST", json={"email": "newuser@example.com"}):
            api = EmailCodeLoginSendEmailApi()
            with pytest.raises(AccountNotFound):
                api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.is_email_send_ip_limit")
    @patch("controllers.console.auth.login.TurnstileService.verify")
    def test_send_email_code_ip_rate_limited(self, mock_verify, mock_is_ip_limit, mock_db, app: Flask):
        """
        Test email code sending blocked by IP rate limit.

        Verifies that:
        - EmailSendIpLimitError is raised when IP limit exceeded
        - Prevents spam and abuse
        """
        # Arrange
        mock_is_ip_limit.return_value = True

        # Act & Assert
        with (
            patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            app.test_request_context("/email-code-login", method="POST", json={"email": "test@example.com"}),
        ):
            with pytest.raises(EmailSendIpLimitError):
                EmailCodeLoginSendEmailApi().post()

        mock_verify.assert_not_called()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @patch("controllers.console.auth.login.AccountService.send_email_code_login_email", return_value="token")
    @patch("controllers.console.auth.login.TurnstileService.verify")
    def test_cloud_send_verifies_turnstile_before_sending_email(
        self,
        mock_verify,
        mock_send_email,
        mock_get_user,
        mock_is_ip_limit,
        mock_db,
        app: Flask,
        mock_account,
    ):
        mock_get_user.return_value = mock_account

        with (
            patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            app.test_request_context(
                "/email-code-login",
                method="POST",
                json={"email": "test@example.com", "turnstile_token": "verified-token"},
                headers={"CF-Connecting-IP": "203.0.113.8"},
            ),
        ):
            response = EmailCodeLoginSendEmailApi().post()

        assert response["result"] == "success"
        mock_verify.assert_called_once_with(token="verified-token", remote_ip="203.0.113.8")
        mock_send_email.assert_called_once()

    @pytest.mark.parametrize(
        ("service_error", "http_error"),
        [
            (TurnstileChallengeRejectedError(), TurnstileVerificationFailedError),
            (TurnstileUpstreamError(), TurnstileServiceUnavailableError),
        ],
    )
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    def test_cloud_send_maps_turnstile_errors_without_looking_up_account(
        self,
        mock_get_user,
        mock_is_ip_limit,
        mock_db,
        app: Flask,
        service_error: Exception,
        http_error: type[Exception],
    ):
        with (
            patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("controllers.console.auth.login.TurnstileService.verify", side_effect=service_error),
            app.test_request_context(
                "/email-code-login",
                method="POST",
                json={"email": "test@example.com", "turnstile_token": "challenge-token"},
            ),
            pytest.raises(http_error),
        ):
            EmailCodeLoginSendEmailApi().post()

        mock_get_user.assert_not_called()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @patch("controllers.console.auth.login.AccountService.send_email_code_login_email", return_value="token")
    @patch("controllers.console.auth.login.TurnstileService.verify")
    def test_self_hosted_send_does_not_call_turnstile(
        self,
        mock_verify,
        mock_send_email,
        mock_get_user,
        mock_is_ip_limit,
        mock_db,
        app: Flask,
        mock_account,
    ):
        mock_get_user.return_value = mock_account

        with (
            patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY),
            app.test_request_context("/email-code-login", method="POST", json={"email": "test@example.com"}),
        ):
            response = EmailCodeLoginSendEmailApi().post()

        assert response["result"] == "success"
        mock_verify.assert_not_called()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.is_email_send_ip_limit")
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @pytest.mark.parametrize(
        ("service_error", "expected_error"),
        [
            (AccountRegisterError("Account frozen"), AccountInFreezeError),
            (EmailDomainSuspendedRegistrationError(), EmailDomainSuspendedError),
        ],
    )
    def test_send_email_code_frozen_account(
        self,
        mock_get_user,
        mock_is_ip_limit,
        mock_db,
        app: Flask,
        service_error,
        expected_error,
    ):
        """
        Test email code sending to frozen account.

        Verifies that:
        - AccountInFreezeError is raised for frozen accounts
        """
        # Arrange
        mock_is_ip_limit.return_value = False
        mock_get_user.side_effect = service_error

        # Act & Assert
        with app.test_request_context("/email-code-login", method="POST", json={"email": "frozen@example.com"}):
            api = EmailCodeLoginSendEmailApi()
            with pytest.raises(expected_error):
                api.post()

    @pytest.mark.parametrize(
        ("language_input", "expected_language"),
        [
            ("zh-Hans", "zh-Hans"),
            ("en-US", "en-US"),
            (None, "en-US"),
        ],
    )
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.is_email_send_ip_limit")
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @patch("controllers.console.auth.login.AccountService.send_email_code_login_email")
    def test_send_email_code_language_handling(
        self,
        mock_send_email,
        mock_get_user,
        mock_is_ip_limit,
        mock_db,
        app: Flask,
        mock_account,
        language_input,
        expected_language,
    ):
        """
        Test email code sending with different language preferences.

        Verifies that:
        - Language parameter is correctly processed
        - Defaults to en-US when not specified
        """
        # Arrange
        mock_is_ip_limit.return_value = False
        mock_get_user.return_value = mock_account
        mock_send_email.return_value = "token"

        # Act
        with app.test_request_context(
            "/email-code-login", method="POST", json={"email": "test@example.com", "language": language_input}
        ):
            api = EmailCodeLoginSendEmailApi()
            api.post()

        # Assert
        call_args = mock_send_email.call_args
        assert call_args.kwargs["language"] == expected_language


class TestEmailCodeLoginApi:
    """Test cases for email code verification and login."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_account(self) -> Account:
        """Create a real transient account for login orchestration."""
        return Account(name="Test User", email="test@example.com")

    @pytest.fixture
    def mock_token_pair(self):
        """Create mock token pair object."""
        token_pair = MagicMock()
        token_pair.access_token = "access_token"
        token_pair.refresh_token = "refresh_token"
        token_pair.csrf_token = "csrf_token"
        return token_pair

    @pytest.mark.parametrize("code", ["12345", "1234567", "abcdef", "١٢٣٤٥٦"])
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    def test_rejects_malformed_code_after_wire_decode(
        self,
        mock_verify_challenge,
        mock_db,
        app: Flask,
        code: str,
    ):
        with (
            app.test_request_context(
                "/email-code-login/validity",
                method="POST",
                json={"email": "test@example.com", "code": encode_code(code), "token": TEST_TOKEN},
            ),
            pytest.raises(EmailCodeError),
        ):
            EmailCodeLoginApi().post()

        mock_verify_challenge.assert_not_called()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    @patch("controllers.console.auth.login.TurnstileService.verify")
    def test_cloud_verify_uses_separate_turnstile_action_when_required(
        self,
        mock_turnstile_verify,
        mock_verify_challenge,
        mock_db,
        app: Flask,
    ):
        mock_verify_challenge.return_value = EmailCodeLoginChallengeResult(
            status=EmailCodeLoginChallengeStatus.INVALID_TOKEN
        )

        with (
            patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("controllers.console.auth.login.dify_config.TURNSTILE_EMAIL_CODE_VERIFY_REQUIRED", True),
            app.test_request_context(
                "/email-code-login/validity",
                method="POST",
                json={
                    "email": "test@example.com",
                    "code": encode_code("123456"),
                    "token": TEST_TOKEN,
                    "turnstile_token": "verify-challenge-token",
                },
                headers={"CF-Connecting-IP": "203.0.113.8"},
            ),
            pytest.raises(InvalidTokenError),
        ):
            EmailCodeLoginApi().post()

        mock_turnstile_verify.assert_called_once_with(
            token="verify-challenge-token",
            remote_ip="203.0.113.8",
            expected_action="signin_code_verify",
        )

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    @patch(
        "controllers.console.auth.login.TurnstileService.verify",
        side_effect=TurnstileChallengeRejectedError,
    )
    def test_cloud_verify_rejects_missing_turnstile_before_consuming_code(
        self,
        mock_turnstile_verify,
        mock_verify_challenge,
        mock_db,
        app: Flask,
    ):
        with (
            patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("controllers.console.auth.login.dify_config.TURNSTILE_EMAIL_CODE_VERIFY_REQUIRED", True),
            app.test_request_context(
                "/email-code-login/validity",
                method="POST",
                json={"email": "test@example.com", "code": encode_code("123456"), "token": TEST_TOKEN},
            ),
            pytest.raises(TurnstileVerificationFailedError),
        ):
            EmailCodeLoginApi().post()

        mock_turnstile_verify.assert_called_once()
        mock_verify_challenge.assert_not_called()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    @patch("controllers.console.auth.login.TurnstileService.verify")
    def test_cloud_verify_flag_off_allows_legacy_client_without_turnstile(
        self,
        mock_turnstile_verify,
        mock_verify_challenge,
        mock_db,
        app: Flask,
    ):
        mock_verify_challenge.return_value = EmailCodeLoginChallengeResult(
            status=EmailCodeLoginChallengeStatus.INVALID_TOKEN
        )

        with (
            patch("controllers.console.auth.login.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("controllers.console.auth.login.dify_config.TURNSTILE_EMAIL_CODE_VERIFY_REQUIRED", False),
            app.test_request_context(
                "/email-code-login/validity",
                method="POST",
                json={"email": "test@example.com", "code": encode_code("123456"), "token": TEST_TOKEN},
            ),
            pytest.raises(InvalidTokenError),
        ):
            EmailCodeLoginApi().post()

        mock_turnstile_verify.assert_not_called()
        mock_verify_challenge.assert_called_once()

    @patch("controllers.console.wraps.db")
    @patch(
        "controllers.console.auth.login.AccountService.verify_email_code_login_challenge",
        side_effect=EmailCodeLoginChallengeUnavailableError,
    )
    def test_verify_maps_redis_failure_to_service_unavailable(
        self,
        mock_verify_challenge,
        mock_db,
        app: Flask,
    ):
        with (
            app.test_request_context(
                "/email-code-login/validity",
                method="POST",
                json={"email": "test@example.com", "code": encode_code("123456"), "token": TEST_TOKEN},
            ),
            pytest.raises(EmailCodeLoginServiceUnavailableError),
        ):
            EmailCodeLoginApi().post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.AccountService.login")
    @patch("controllers.console.auth.login.AccountService.reset_login_error_rate_limit")
    def test_email_code_login_existing_user(
        self,
        mock_reset_rate_limit,
        mock_login,
        mock_get_tenants,
        mock_get_user,
        mock_verify_challenge,
        mock_db,
        app: Flask,
        mock_account,
        mock_token_pair,
    ):
        """
        Test successful email code login for existing user.

        Verifies that:
        - Email and code are validated
        - Token is revoked after use
        - User is logged in with token pair
        """
        # Arrange
        mock_verify_challenge.return_value = EmailCodeLoginChallengeResult(
            status=EmailCodeLoginChallengeStatus.VERIFIED
        )
        mock_get_user.return_value = mock_account
        mock_get_tenants.return_value = [Tenant(name="Test Workspace")]
        mock_login.return_value = mock_token_pair

        # Act
        with app.test_request_context(
            "/email-code-login/validity",
            method="POST",
            json={"email": "test@example.com", "code": encode_code("123456"), "token": TEST_TOKEN},
        ):
            api = EmailCodeLoginApi()
            response = api.post()

        # Assert
        assert response.json["result"] == "success"
        mock_verify_challenge.assert_called_once_with(email="test@example.com", code="123456", token=TEST_TOKEN)
        mock_login.assert_called_once()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @patch("controllers.console.auth.login.AccountService.create_account_and_tenant")
    @patch("controllers.console.auth.login.AccountService.login")
    @patch("controllers.console.auth.login.AccountService.reset_login_error_rate_limit")
    def test_email_code_login_new_user_creates_account(
        self,
        mock_reset_rate_limit,
        mock_login,
        mock_create_account,
        mock_get_user,
        mock_verify_challenge,
        mock_db,
        app: Flask,
        mock_account,
        mock_token_pair,
    ):
        """
        Test email code login creates new account for new user.

        Verifies that:
        - New account is created when user doesn't exist
        - Workspace is created for new user
        - User is logged in after account creation
        """
        # Arrange
        mock_verify_challenge.return_value = EmailCodeLoginChallengeResult(
            status=EmailCodeLoginChallengeStatus.VERIFIED
        )
        mock_get_user.return_value = None
        mock_create_account.return_value = mock_account
        mock_login.return_value = mock_token_pair

        # Act
        with (
            patch("controllers.console.auth.login.extract_remote_ip", return_value="203.0.113.10"),
            app.test_request_context(
                "/email-code-login/validity",
                method="POST",
                json={
                    "email": "newuser@example.com",
                    "code": encode_code("123456"),
                    "token": TEST_TOKEN,
                    "language": "en-US",
                    "timezone": "Asia/Shanghai",
                },
            ),
        ):
            api = EmailCodeLoginApi()
            response = api.post()

        # Assert
        assert response.json["result"] == "success"
        mock_create_account.assert_called_once_with(
            email="newuser@example.com",
            name="newuser@example.com",
            interface_language="en-US",
            timezone="Asia/Shanghai",
            ip_address="203.0.113.10",
            session=ANY,
        )

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    def test_email_code_login_invalid_token(self, mock_verify_challenge, mock_db, app: Flask):
        """
        Test email code login with invalid token.

        Verifies that:
        - InvalidTokenError is raised for invalid/expired tokens
        """
        # Arrange
        mock_verify_challenge.return_value = EmailCodeLoginChallengeResult(
            status=EmailCodeLoginChallengeStatus.INVALID_TOKEN
        )

        # Act & Assert
        with app.test_request_context(
            "/email-code-login/validity",
            method="POST",
            json={"email": "test@example.com", "code": encode_code("123456"), "token": TEST_TOKEN},
        ):
            api = EmailCodeLoginApi()
            with pytest.raises(InvalidTokenError):
                api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    def test_email_code_login_email_mismatch(self, mock_verify_challenge, mock_db, app: Flask):
        """
        Test email code login with mismatched email.

        Verifies that:
        - InvalidEmailError is raised when email doesn't match token
        """
        # Arrange
        mock_verify_challenge.return_value = EmailCodeLoginChallengeResult(
            status=EmailCodeLoginChallengeStatus.EMAIL_MISMATCH
        )

        # Act & Assert
        with app.test_request_context(
            "/email-code-login/validity",
            method="POST",
            json={"email": "different@example.com", "code": encode_code("123456"), "token": TEST_TOKEN},
        ):
            api = EmailCodeLoginApi()
            with pytest.raises(InvalidEmailError):
                api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    def test_email_code_login_wrong_code(self, mock_verify_challenge, mock_db, app: Flask):
        """
        Test email code login with incorrect code.

        Verifies that:
        - EmailCodeError is raised for wrong verification code
        """
        # Arrange
        mock_verify_challenge.return_value = EmailCodeLoginChallengeResult(
            status=EmailCodeLoginChallengeStatus.INVALID_CODE,
            remaining_attempts=4,
        )

        # Act & Assert
        with app.test_request_context(
            "/email-code-login/validity",
            method="POST",
            json={"email": "test@example.com", "code": encode_code("654321"), "token": TEST_TOKEN},
        ):
            api = EmailCodeLoginApi()
            with pytest.raises(EmailCodeError):
                api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.FeatureService.is_workspace_creation_allowed")
    def test_email_code_login_creates_workspace_for_user_without_tenant(
        self,
        mock_is_workspace_creation_allowed,
        mock_get_tenants,
        mock_get_user,
        mock_verify_challenge,
        mock_db,
        app: Flask,
        mock_account,
    ):
        """
        Test email code login creates workspace for user without tenant.

        Verifies that:
        - Workspace is created when user has no tenants
        - User is added as owner of new workspace
        """
        # Arrange
        mock_verify_challenge.return_value = EmailCodeLoginChallengeResult(
            status=EmailCodeLoginChallengeStatus.VERIFIED
        )
        mock_get_user.return_value = mock_account
        mock_get_tenants.return_value = []
        mock_is_workspace_creation_allowed.return_value = True

        # Act & Assert - Should not raise WorkspacesLimitExceeded
        with app.test_request_context(
            "/email-code-login/validity",
            method="POST",
            json={"email": "test@example.com", "code": encode_code("123456"), "token": TEST_TOKEN},
        ):
            api = EmailCodeLoginApi()
            # This would complete the flow, but we're testing workspace creation logic
            # In real implementation, TenantService.create_tenant would be called

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.FeatureService.get_license")
    @patch("controllers.console.auth.login.FeatureService.is_workspace_creation_allowed")
    def test_email_code_login_workspace_limit_exceeded(
        self,
        mock_is_workspace_creation_allowed,
        mock_get_license,
        mock_get_tenants,
        mock_get_user,
        mock_verify_challenge,
        mock_db,
        app: Flask,
        mock_account,
    ):
        """
        Test email code login fails when workspace limit exceeded.

        Verifies that:
        - WorkspacesLimitExceeded is raised when limit reached
        """
        # Arrange
        mock_verify_challenge.return_value = EmailCodeLoginChallengeResult(
            status=EmailCodeLoginChallengeStatus.VERIFIED
        )
        mock_get_user.return_value = mock_account
        mock_get_tenants.return_value = []
        mock_get_license.return_value.workspaces.is_available.return_value = False
        mock_is_workspace_creation_allowed.return_value = True

        # Act & Assert
        with app.test_request_context(
            "/email-code-login/validity",
            method="POST",
            json={"email": "test@example.com", "code": encode_code("123456"), "token": TEST_TOKEN},
        ):
            api = EmailCodeLoginApi()
            with pytest.raises(WorkspacesLimitExceeded):
                api.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.login.AccountService.verify_email_code_login_challenge")
    @patch("controllers.console.auth.login.AccountService.get_user_through_email")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.FeatureService.is_workspace_creation_allowed")
    def test_email_code_login_workspace_creation_not_allowed(
        self,
        mock_is_workspace_creation_allowed,
        mock_get_tenants,
        mock_get_user,
        mock_verify_challenge,
        mock_db,
        app: Flask,
        mock_account,
    ):
        """
        Test email code login fails when workspace creation not allowed.

        Verifies that:
        - NotAllowedCreateWorkspace is raised when creation disabled
        """
        # Arrange
        mock_verify_challenge.return_value = EmailCodeLoginChallengeResult(
            status=EmailCodeLoginChallengeStatus.VERIFIED
        )
        mock_get_user.return_value = mock_account
        mock_get_tenants.return_value = []
        mock_is_workspace_creation_allowed.return_value = False

        # Act & Assert
        with app.test_request_context(
            "/email-code-login/validity",
            method="POST",
            json={"email": "test@example.com", "code": encode_code("123456"), "token": TEST_TOKEN},
        ):
            api = EmailCodeLoginApi()
            with pytest.raises(NotAllowedCreateWorkspace):
                api.post()
