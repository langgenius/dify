"""Unit tests for OAuth controller endpoints."""

from __future__ import annotations

from unittest.mock import ANY, MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from controllers.console.auth.oauth import (
    OAuthCallback,
    OAuthLogin,
    _generate_account,
    _get_account_by_openid_or_email,
    get_oauth_providers,
)
from enums import DeploymentEdition
from libs.oauth import OAuthUserInfo, encode_oauth_state
from models.account import Account, AccountIntegrate, AccountStatus, Tenant
from services.errors.account import AccountRegisterError
from services.errors.account import (
    EmailDomainSuspendedError as EmailDomainSuspendedRegistrationError,
)


@pytest.fixture(autouse=True)
def _oauth_config(config_overrides) -> None:
    config_overrides(CONSOLE_WEB_URL="http://localhost:3000")


class TestGetOAuthProviders:
    @pytest.mark.parametrize(
        ("github_config", "google_config", "expected_github", "expected_google"),
        [
            # Both providers configured
            (
                {"id": "github_id", "secret": "github_secret"},
                {"id": "google_id", "secret": "google_secret"},
                True,
                True,
            ),
            # Only GitHub configured
            ({"id": "github_id", "secret": "github_secret"}, {"id": None, "secret": None}, True, False),
            # Only Google configured
            ({"id": None, "secret": None}, {"id": "google_id", "secret": "google_secret"}, False, True),
            # No providers configured
            ({"id": None, "secret": None}, {"id": None, "secret": None}, False, False),
        ],
    )
    def test_should_configure_oauth_providers_correctly(
        self, app: Flask, github_config, google_config, expected_github, expected_google, config_overrides
    ):
        config_overrides(
            GITHUB_CLIENT_ID=github_config["id"],
            GITHUB_CLIENT_SECRET=github_config["secret"],
            GOOGLE_CLIENT_ID=google_config["id"],
            GOOGLE_CLIENT_SECRET=google_config["secret"],
            CONSOLE_API_URL="http://localhost",
        )

        with app.app_context():
            providers = get_oauth_providers()

        assert (providers["github"] is not None) == expected_github
        assert (providers["google"] is not None) == expected_google


class TestOAuthLogin:
    @pytest.fixture
    def resource(self):
        return OAuthLogin()

    @pytest.fixture
    def mock_oauth_provider(self):
        provider = MagicMock()
        provider.get_authorization_url.return_value = "https://github.com/login/oauth/authorize?..."
        return provider

    @pytest.mark.parametrize(
        ("invite_token", "expected_token"),
        [
            (None, None),
            ("test_invite_token", "test_invite_token"),
            ("", None),
        ],
    )
    @patch("controllers.console.auth.oauth.get_oauth_providers")
    @patch("controllers.console.auth.oauth.redirect")
    def test_should_handle_oauth_login_with_various_tokens(
        self,
        mock_redirect,
        mock_get_providers,
        resource: OAuthLogin,
        app: Flask,
        mock_oauth_provider,
        invite_token,
        expected_token,
    ):
        mock_get_providers.return_value = {"github": mock_oauth_provider, "google": None}

        query_string = f"invite_token={invite_token}" if invite_token else ""
        with app.test_request_context(f"/auth/oauth/github?{query_string}"):
            resource.get("github")

        mock_oauth_provider.get_authorization_url.assert_called_once_with(
            invite_token=expected_token,
            timezone=None,
            language=None,
            redirect_url=None,
        )
        mock_redirect.assert_called_once_with("https://github.com/login/oauth/authorize?...")

    @patch("controllers.console.auth.oauth.get_oauth_providers")
    @patch("controllers.console.auth.oauth.redirect")
    def test_should_pass_timezone_to_oauth_state(
        self,
        mock_redirect,
        mock_get_providers,
        resource: OAuthLogin,
        app: Flask,
        mock_oauth_provider,
    ):
        mock_get_providers.return_value = {"github": mock_oauth_provider, "google": None}

        with app.test_request_context("/auth/oauth/github?timezone=Asia/Shanghai"):
            resource.get("github")

        mock_oauth_provider.get_authorization_url.assert_called_once_with(
            invite_token=None,
            timezone="Asia/Shanghai",
            language=None,
            redirect_url=None,
        )
        mock_redirect.assert_called_once_with("https://github.com/login/oauth/authorize?...")

    @patch("controllers.console.auth.oauth.get_oauth_providers")
    @patch("controllers.console.auth.oauth.redirect")
    def test_should_pass_language_to_oauth_state(
        self,
        mock_redirect,
        mock_get_providers,
        resource: OAuthLogin,
        app: Flask,
        mock_oauth_provider,
    ):
        mock_get_providers.return_value = {"github": mock_oauth_provider, "google": None}

        with app.test_request_context("/auth/oauth/github?language=zh-Hans"):
            resource.get("github")

        mock_oauth_provider.get_authorization_url.assert_called_once_with(
            invite_token=None,
            timezone=None,
            language="zh-Hans",
            redirect_url=None,
        )
        mock_redirect.assert_called_once_with("https://github.com/login/oauth/authorize?...")

    @pytest.mark.parametrize(
        ("provider", "expected_error"),
        [
            ("invalid_provider", "Invalid provider"),
            ("github", "Invalid provider"),  # When GitHub is not configured
            ("google", "Invalid provider"),  # When Google is not configured
        ],
    )
    @patch("controllers.console.auth.oauth.get_oauth_providers")
    def test_should_return_error_for_invalid_providers(
        self, mock_get_providers, resource, app, provider, expected_error
    ):
        mock_get_providers.return_value = {"github": None, "google": None}

        with app.test_request_context(f"/auth/oauth/{provider}"):
            response, status_code = resource.get(provider)

        assert status_code == 400
        assert response["error"] == expected_error


class TestOAuthCallback:
    @pytest.fixture
    def resource(self):
        return OAuthCallback()

    @pytest.fixture
    def oauth_setup(self):
        """Common OAuth setup for callback tests"""
        oauth_provider = MagicMock()
        oauth_provider.get_access_token.return_value = "access_token"
        oauth_provider.get_user_info.return_value = OAuthUserInfo(id="123", name="Test User", email="test@example.com")

        account = Account(name="Test User", email="test@example.com", status=AccountStatus.ACTIVE)
        account.id = "123"

        token_pair = MagicMock()
        token_pair.access_token = "jwt_access_token"
        token_pair.refresh_token = "jwt_refresh_token"

        return {"provider": oauth_provider, "account": account, "token_pair": token_pair}

    @patch("controllers.console.auth.oauth.get_oauth_providers")
    @patch("controllers.console.auth.oauth._generate_account")
    @patch("controllers.console.auth.oauth.AccountService")
    @patch("controllers.console.auth.oauth.TenantService")
    @patch("controllers.console.auth.oauth.redirect")
    def test_should_handle_successful_oauth_callback(
        self,
        mock_redirect,
        mock_tenant_service,
        mock_account_service,
        mock_generate_account,
        mock_get_providers,
        resource: OAuthCallback,
        app: Flask,
        oauth_setup,
    ):
        mock_get_providers.return_value = {"github": oauth_setup["provider"]}
        mock_generate_account.return_value = (oauth_setup["account"], True)
        mock_account_service.login.return_value = oauth_setup["token_pair"]

        with (
            patch("controllers.console.auth.oauth.extract_remote_ip", return_value="203.0.113.10"),
            app.test_request_context("/auth/oauth/github/callback?code=test_code"),
        ):
            resource.get("github")

        oauth_setup["provider"].get_access_token.assert_called_once_with("test_code")
        oauth_setup["provider"].get_user_info.assert_called_once_with("access_token")
        mock_generate_account.assert_called_once_with(
            "github",
            oauth_setup["provider"].get_user_info.return_value,
            timezone=None,
            language=None,
            ip_address="203.0.113.10",
        )
        mock_redirect.assert_called_once_with("http://localhost:3000?oauth_new_user=true")

    @pytest.mark.parametrize(
        ("service_error", "expected_message"),
        [
            (
                EmailDomainSuspendedRegistrationError(),
                "This email domain has been suspended.",
            ),
            (AccountRegisterError("This email account is frozen."), "This email account is frozen."),
        ],
    )
    @patch("controllers.console.auth.oauth.get_oauth_providers")
    @patch("controllers.console.auth.oauth._generate_account")
    @patch("controllers.console.auth.oauth.redirect")
    def test_should_translate_registration_freeze_errors(
        self,
        mock_redirect,
        mock_generate_account,
        mock_get_providers,
        resource: OAuthCallback,
        app: Flask,
        oauth_setup,
        service_error,
        expected_message,
    ):
        mock_get_providers.return_value = {"github": oauth_setup["provider"]}
        mock_generate_account.side_effect = service_error

        with app.test_request_context("/auth/oauth/github/callback?code=test_code"):
            resource.get("github")

        mock_redirect.assert_called_once_with(f"http://localhost:3000/signin?message={expected_message}")

    @pytest.mark.parametrize(
        ("exception", "expected_error"),
        [
            (Exception("OAuth error"), "OAuth process failed"),
            (ValueError("Invalid token"), "OAuth process failed"),
            (KeyError("Missing key"), "OAuth process failed"),
        ],
    )
    @patch("controllers.console.auth.oauth.get_oauth_providers")
    def test_should_handle_oauth_exceptions(
        self, mock_get_providers, resource: OAuthCallback, app: Flask, exception, expected_error
    ):
        # Import the real requests module to create a proper exception
        import httpx

        request_exception = httpx.RequestError("OAuth error")
        request_exception.response = MagicMock()
        request_exception.response.text = str(exception)

        mock_oauth_provider = MagicMock()
        mock_oauth_provider.get_access_token.side_effect = request_exception
        mock_get_providers.return_value = {"github": mock_oauth_provider}

        with app.test_request_context("/auth/oauth/github/callback?code=test_code"):
            response, status_code = resource.get("github")

        assert status_code == 400
        assert response["error"] == expected_error

    @patch("controllers.console.auth.oauth.get_oauth_providers")
    @patch("controllers.console.auth.oauth.RegisterService")
    @patch("controllers.console.auth.oauth.AccountService")
    @patch("controllers.console.auth.oauth.redirect")
    def test_invitation_comparison_is_case_insensitive(
        self,
        mock_redirect,
        mock_account_service,
        mock_register_service,
        mock_get_providers,
        resource: OAuthCallback,
        app: Flask,
        oauth_setup,
    ):
        oauth_setup["provider"].get_user_info.return_value = OAuthUserInfo(
            id="123", name="Test User", email="User@Example.com"
        )
        mock_get_providers.return_value = {"github": oauth_setup["provider"]}
        mock_register_service.is_valid_invite_token.return_value = True
        mock_register_service.get_invitation_if_token_valid.return_value = {
            "account": oauth_setup["account"],
            "data": {"email": "user@example.com"},
            "tenant": Tenant(name="Invited Workspace"),
        }
        mock_account_service.login.return_value = oauth_setup["token_pair"]

        state = encode_oauth_state(invite_token="invite123", timezone="Asia/Shanghai")
        with app.test_request_context(f"/auth/oauth/github/callback?code=test_code&state={state}"):
            resource.get("github")

        mock_register_service.get_invitation_if_token_valid.assert_called_once_with(
            None, None, "invite123", session=ANY
        )
        mock_redirect.assert_called_once_with("http://localhost:3000/signin/invite-settings?invite_token=invite123")

    @pytest.mark.parametrize(
        ("account_status", "expected_redirect"),
        [
            (AccountStatus.BANNED, "http://localhost:3000/signin?message=Account is banned."),
            # CLOSED status: Currently NOT handled, will proceed to login (security issue)
            # This documents actual behavior. See test_defensive_check_for_closed_account_status for details
            (
                AccountStatus.CLOSED.value,
                "http://localhost:3000?oauth_new_user=false",
            ),
        ],
    )
    @patch("controllers.console.auth.oauth.AccountService")
    @patch("controllers.console.auth.oauth.TenantService")
    @patch("controllers.console.auth.oauth.get_oauth_providers")
    @patch("controllers.console.auth.oauth._generate_account")
    @patch("controllers.console.auth.oauth.redirect")
    def test_should_redirect_based_on_account_status(
        self,
        mock_redirect,
        mock_generate_account,
        mock_get_providers,
        mock_tenant_service,
        mock_account_service,
        resource: OAuthCallback,
        app: Flask,
        oauth_setup,
        account_status,
        expected_redirect,
    ):

        mock_get_providers.return_value = {"github": oauth_setup["provider"]}

        account = Account(name="Test User", email="test@example.com", status=account_status)
        account.id = "123"
        mock_generate_account.return_value = (account, False)

        # Mock login for CLOSED status
        mock_token_pair = MagicMock()
        mock_token_pair.access_token = "jwt_access_token"
        mock_token_pair.refresh_token = "jwt_refresh_token"
        mock_token_pair.csrf_token = "csrf_token"
        mock_account_service.login.return_value = mock_token_pair

        with app.test_request_context("/auth/oauth/github/callback?code=test_code"):
            resource.get("github")

        mock_redirect.assert_called_once_with(expected_redirect)

    @patch("controllers.console.auth.oauth.get_oauth_providers")
    @patch("controllers.console.auth.oauth._generate_account")
    @patch("controllers.console.auth.oauth.TenantService")
    @patch("controllers.console.auth.oauth.AccountService")
    def test_should_activate_pending_account(
        self,
        mock_account_service,
        mock_tenant_service,
        mock_generate_account,
        mock_get_providers,
        resource: OAuthCallback,
        app: Flask,
        oauth_setup,
    ):
        mock_get_providers.return_value = {"github": oauth_setup["provider"]}

        mock_account = Account(name="Test User", email="test@example.com", status=AccountStatus.PENDING)
        mock_generate_account.return_value = (mock_account, False)

        mock_token_pair = MagicMock()
        mock_token_pair.access_token = "jwt_access_token"
        mock_token_pair.refresh_token = "jwt_refresh_token"
        mock_token_pair.csrf_token = "csrf_token"
        mock_account_service.login.return_value = mock_token_pair

        with app.test_request_context("/auth/oauth/github/callback?code=test_code"):
            resource.get("github")

        assert mock_account.status == AccountStatus.ACTIVE
        assert mock_account.initialized_at is not None

    @patch("controllers.console.auth.oauth.get_oauth_providers")
    @patch("controllers.console.auth.oauth._generate_account")
    @patch("controllers.console.auth.oauth.TenantService")
    @patch("controllers.console.auth.oauth.AccountService")
    @patch("controllers.console.auth.oauth.redirect")
    def test_defensive_check_for_closed_account_status(
        self,
        mock_redirect,
        mock_account_service,
        mock_tenant_service,
        mock_generate_account,
        mock_get_providers,
        resource: OAuthCallback,
        app: Flask,
        oauth_setup,
    ):
        """Defensive test for CLOSED account status handling in OAuth callback.

        This is a defensive test documenting expected security behavior for CLOSED accounts.

        Current behavior: CLOSED status is NOT checked, allowing closed accounts to login.
        Expected behavior: CLOSED accounts should be rejected like BANNED accounts.

        Context:
        - AccountStatus.CLOSED is defined in the enum but never used in production
        - No production service path sets accounts to CLOSED
        - Account deletion uses external service instead of status change
        - All authentication services (OAuth, password, email) don't check CLOSED status

        TODO: If CLOSED status is implemented in the future:
        1. Update OAuth callback to check for CLOSED status
        2. Add similar checks to all authentication services for consistency
        3. Update this test to verify the rejection behavior

        Security consideration: Until properly implemented, CLOSED status provides no protection.
        """
        # Setup
        mock_get_providers.return_value = {"github": oauth_setup["provider"]}

        # Create account with CLOSED status
        closed_account = Account(name="Closed Account", email="closed@example.com", status=AccountStatus.CLOSED)
        closed_account.id = "123"
        mock_generate_account.return_value = (closed_account, False)

        # Mock successful login (current behavior)
        mock_token_pair = MagicMock()
        mock_token_pair.access_token = "jwt_access_token"
        mock_token_pair.refresh_token = "jwt_refresh_token"
        mock_token_pair.csrf_token = "csrf_token"
        mock_account_service.login.return_value = mock_token_pair

        # Execute OAuth callback
        with app.test_request_context("/auth/oauth/github/callback?code=test_code"):
            resource.get("github")

        # Verify current behavior: login succeeds (this is NOT ideal)
        mock_redirect.assert_called_once_with("http://localhost:3000?oauth_new_user=false")
        mock_account_service.login.assert_called_once()

        # Document expected behavior in comments:
        # Expected: mock_redirect.assert_called_once_with(
        #     "http://localhost:3000/signin?message=Account is closed."
        # )
        # Expected: mock_account_service.login.assert_not_called()


class TestAccountGeneration:
    @pytest.fixture
    def user_info(self):
        return OAuthUserInfo(id="123", name="Test User", email="test@example.com")

    @pytest.fixture
    def mock_account(self) -> Account:
        return Account(name="Test User", email="test@example.com")

    @patch("controllers.console.auth.oauth.AccountService.get_account_by_email_with_case_fallback")
    def test_should_get_account_by_openid_or_email(
        self,
        mock_get_account,
        app: Flask,
        user_info: OAuthUserInfo,
        sqlite_session: Session,
    ):
        account = Account(name="Test User", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.flush()
        sqlite_session.add(
            AccountIntegrate(
                account_id=account.id,
                provider="github",
                open_id="123",
                encrypted_token="encrypted-token",
            )
        )
        sqlite_session.commit()
        database_session = scoped_session(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))

        with patch("controllers.console.auth.oauth.db.session", database_session), app.test_request_context("/"):
            # Test OpenID found
            result = _get_account_by_openid_or_email("github", user_info)
            assert result is not None
            assert result.id == account.id
            mock_get_account.assert_not_called()

            # Test fallback to email lookup
            mock_get_account.return_value = account

            result = _get_account_by_openid_or_email("google", user_info)
            assert result is account
            mock_get_account.assert_called_once()
        database_session.remove()

    @pytest.mark.parametrize(
        ("allow_register", "existing_account", "should_create"),
        [
            (True, None, True),  # New account creation allowed
            (True, "existing", False),  # Existing account
            (False, None, False),  # Registration not allowed
        ],
    )
    @patch("controllers.console.auth.oauth._get_account_by_openid_or_email")
    @patch("controllers.console.auth.oauth.FeatureService")
    @patch("controllers.console.auth.oauth.RegisterService")
    @patch("controllers.console.auth.oauth.AccountService")
    @patch("controllers.console.auth.oauth.TenantService")
    def test_should_handle_account_generation_scenarios(
        self,
        mock_tenant_service: MagicMock,
        mock_account_service: MagicMock,
        mock_register_service: MagicMock,
        mock_feature_service: MagicMock,
        mock_get_account: MagicMock,
        app: Flask,
        user_info: OAuthUserInfo,
        mock_account,
        allow_register,
        existing_account,
        should_create,
    ):
        mock_get_account.return_value = mock_account if existing_account else None
        mock_feature_service.get_system_features.return_value.is_allow_register = allow_register
        mock_register_service.register.return_value = mock_account

        with app.test_request_context(headers={"Accept-Language": "en-US,en;q=0.9"}):
            if not allow_register and not existing_account:
                with pytest.raises(AccountRegisterError):
                    _generate_account("github", user_info)
            else:
                result, oauth_new_user = _generate_account("github", user_info)
                assert result == mock_account
                assert oauth_new_user == should_create

                if should_create:
                    mock_register_service.register.assert_called_once_with(
                        email="test@example.com",
                        name="Test User",
                        password=None,
                        open_id="123",
                        provider="github",
                        language="en-US",
                        timezone=None,
                        ip_address=None,
                        session=ANY,
                    )
                else:
                    mock_register_service.register.assert_not_called()

    @pytest.mark.parametrize(
        ("freeze_type", "expected_error"),
        [
            ("email_domain_suspended", EmailDomainSuspendedRegistrationError),
            ("freeze", AccountRegisterError),
        ],
    )
    @patch("controllers.console.auth.oauth.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    @patch("controllers.console.auth.oauth.BillingService.get_email_freeze_type")
    @patch("controllers.console.auth.oauth._get_account_by_openid_or_email", return_value=None)
    @patch("controllers.console.auth.oauth.FeatureService")
    def test_should_reject_registration_for_frozen_email(
        self,
        mock_feature_service,
        mock_get_account,
        mock_get_freeze_type,
        freeze_type,
        expected_error,
        app: Flask,
        user_info: OAuthUserInfo,
    ):
        mock_feature_service.get_system_features.return_value.is_allow_register = False
        mock_get_freeze_type.return_value = freeze_type

        with app.test_request_context("/"):
            with pytest.raises(expected_error):
                _generate_account("github", user_info)

        mock_get_freeze_type.assert_called_once_with("test@example.com")

    @patch("controllers.console.auth.oauth._get_account_by_openid_or_email", return_value=None)
    @patch("controllers.console.auth.oauth.FeatureService")
    @patch("controllers.console.auth.oauth.RegisterService")
    @patch("controllers.console.auth.oauth.AccountService")
    @patch("controllers.console.auth.oauth.TenantService")
    def test_should_register_with_lowercase_email(
        self,
        mock_tenant_service: MagicMock,
        mock_account_service: MagicMock,
        mock_register_service: MagicMock,
        mock_feature_service: MagicMock,
        mock_get_account: MagicMock,
        app: Flask,
    ):
        user_info = OAuthUserInfo(id="123", name="Test User", email="Upper@Example.com")
        mock_feature_service.get_system_features.return_value.is_allow_register = True
        mock_register_service.register.return_value = Account(name="Test User", email="upper@example.com")

        with app.test_request_context(headers={"Accept-Language": "en-US"}):
            _generate_account("github", user_info)

        mock_register_service.register.assert_called_once_with(
            email="upper@example.com",
            name="Test User",
            password=None,
            open_id="123",
            provider="github",
            language="en-US",
            timezone=None,
            ip_address=None,
            session=ANY,
        )

    @patch("controllers.console.auth.oauth._get_account_by_openid_or_email", return_value=None)
    @patch("controllers.console.auth.oauth.FeatureService")
    @patch("controllers.console.auth.oauth.RegisterService")
    @patch("controllers.console.auth.oauth.AccountService")
    @patch("controllers.console.auth.oauth.TenantService")
    def test_should_register_with_browser_timezone(
        self,
        mock_tenant_service: MagicMock,
        mock_account_service: MagicMock,
        mock_register_service: MagicMock,
        mock_feature_service: MagicMock,
        mock_get_account: MagicMock,
        app: Flask,
        user_info: OAuthUserInfo,
    ):
        mock_feature_service.get_system_features.return_value.is_allow_register = True
        mock_register_service.register.return_value = Account(name="Test User", email="test@example.com")

        with app.test_request_context(headers={"Accept-Language": "zh-Hans,zh;q=0.9"}):
            _generate_account("github", user_info, timezone="Asia/Shanghai")

        mock_register_service.register.assert_called_once_with(
            email="test@example.com",
            name="Test User",
            password=None,
            open_id="123",
            provider="github",
            language="zh-Hans",
            timezone="Asia/Shanghai",
            ip_address=None,
            session=ANY,
        )

    @patch("controllers.console.auth.oauth._get_account_by_openid_or_email", return_value=None)
    @patch("controllers.console.auth.oauth.FeatureService")
    @patch("controllers.console.auth.oauth.RegisterService")
    @patch("controllers.console.auth.oauth.AccountService")
    @patch("controllers.console.auth.oauth.TenantService")
    def test_should_register_with_state_language(
        self,
        mock_tenant_service: MagicMock,
        mock_account_service: MagicMock,
        mock_register_service: MagicMock,
        mock_feature_service: MagicMock,
        mock_get_account: MagicMock,
        app: Flask,
        user_info: OAuthUserInfo,
    ):
        mock_feature_service.get_system_features.return_value.is_allow_register = True
        mock_register_service.register.return_value = Account(name="Test User", email="test@example.com")

        with app.test_request_context(headers={"Accept-Language": "en-US,en;q=0.9"}):
            _generate_account("github", user_info, language="zh-Hans")

        mock_register_service.register.assert_called_once_with(
            email="test@example.com",
            name="Test User",
            password=None,
            open_id="123",
            provider="github",
            language="zh-Hans",
            timezone=None,
            ip_address=None,
            session=ANY,
        )

    @patch("controllers.console.auth.oauth._get_account_by_openid_or_email")
    @patch("controllers.console.auth.oauth.TenantService")
    @patch("controllers.console.auth.oauth.FeatureService")
    @patch("controllers.console.auth.oauth.AccountService")
    def test_should_create_workspace_for_account_without_tenant(
        self,
        mock_account_service: MagicMock,
        mock_feature_service: MagicMock,
        mock_tenant_service: MagicMock,
        mock_get_account: MagicMock,
        app: Flask,
        user_info: OAuthUserInfo,
        mock_account,
    ):
        mock_get_account.return_value = mock_account
        mock_tenant_service.get_join_tenants.return_value = []
        mock_feature_service.is_workspace_creation_allowed.return_value = True

        with app.test_request_context(headers={"Accept-Language": "en-US,en;q=0.9"}):
            result, oauth_new_user = _generate_account("github", user_info)

            assert result == mock_account
            assert oauth_new_user is False
            mock_tenant_service.create_owner_tenant.assert_called_once_with(mock_account, session=ANY)
