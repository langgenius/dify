from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.auth.oauth import (
    OAuthCallback,
    OAuthLogin,
    _generate_account,
    _get_account_by_openid_or_email,
    get_oauth_providers,
)
from libs.oauth import OAuthUserInfo
from models.account import AccountStatus
from services.errors.account import AccountRegisterError


class TestGetOAuthProviders:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

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
    @patch("controllers.console.auth.oauth.dify_config")
    def test_should_configure_oauth_providers_correctly(
        self, mock_config, app, github_config, google_config, expected_github, expected_google
    ):
        mock_config.GITHUB_CLIENT_ID = github_config["id"]
        mock_config.GITHUB_CLIENT_SECRET = github_config["secret"]
        mock_config.GOOGLE_CLIENT_ID = google_config["id"]
        mock_config.GOOGLE_CLIENT_SECRET = google_config["secret"]
        mock_config.CONSOLE_API_URL = "http://localhost"

        with app.app_context():
            providers = get_oauth_providers()

        assert (providers["github"] is not None) == expected_github
        assert (providers["google"] is not None) == expected_google


class TestOAuthLogin:
    @pytest.fixture
    def resource(self):
        return OAuthLogin()

    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

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
        resource,
        app,
        mock_oauth_provider,
        invite_token,
        expected_token,
    ):
        mock_get_providers.return_value = {"github": mock_oauth_provider, "google": None}

        query_string = f"invite_token={invite_token}" if invite_token else ""
        with app.test_request_context(f"/auth/oauth/github?{query_string}"):
            resource.get("github")

        mock_oauth_provider.get_authorization_url.assert_called_once_with(invite_token=expected_token)
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
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def oauth_setup(self):
        """Common OAuth setup for callback tests"""
        oauth_provider = MagicMock()
        oauth_provider.get_access_token.return_value = "access_token"
        oauth_provider.get_user_info.return_value = OAuthUserInfo(id="123", name="Test User", email="test@example.com")

        account = MagicMock()
        account.status = AccountStatus.ACTIVE

        token_pair = MagicMock()
        token_pair.access_token = "jwt_access_token"
        token_pair.refresh_token = "jwt_refresh_token"

        return {"provider": oauth_provider, "account": account, "token_pair": token_pair}

    @patch("controllers.console.auth.oauth.dify_config")
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
        mock_config,
        resource,
        app,
        oauth_setup,
    ):
        mock_config.CONSOLE_WEB_URL = "http://localhost:3000"
        mock_get_providers.return_value = {"github": oauth_setup["provider"]}
        mock_generate_account.return_value = oauth_setup["account"]
        mock_account_service.login.return_value = oauth_setup["token_pair"]

        with app.test_request_context("/auth/oauth/github/callback?code=test_code"):
            resource.get("github")

        oauth_setup["provider"].get_access_token.assert_called_once_with("test_code")
        oauth_setup["provider"].get_user_info.assert_called_once_with("access_token")
        mock_redirect.assert_called_once_with("http://localhost:3000")

    @pytest.mark.parametrize(
        ("exception", "expected_error"),
        [
            (Exception("OAuth error"), "OAuth process failed"),
            (ValueError("Invalid token"), "OAuth process failed"),
            (KeyError("Missing key"), "OAuth process failed"),
        ],
    )
    @patch("controllers.console.auth.oauth.db")
    @patch("controllers.console.auth.oauth.get_oauth_providers")
    def test_should_handle_oauth_exceptions(
        self, mock_get_providers, mock_db, resource, app, exception, expected_error
    ):
        # Mock database session
        mock_db.session = MagicMock()
        mock_db.session.rollback = MagicMock()

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

    @pytest.mark.parametrize(
        ("account_status", "expected_redirect"),
        [
            (AccountStatus.BANNED, "http://localhost:3000/signin?message=Account is banned."),
            # CLOSED status: Currently NOT handled, will proceed to login (security issue)
            # This documents actual behavior. See test_defensive_check_for_closed_account_status for details
            (
                AccountStatus.CLOSED.value,
                "http://localhost:3000",
            ),
        ],
    )
    @patch("controllers.console.auth.oauth.AccountService")
    @patch("controllers.console.auth.oauth.TenantService")
    @patch("controllers.console.auth.oauth.db")
    @patch("controllers.console.auth.oauth.dify_config")
    @patch("controllers.console.auth.oauth.get_oauth_providers")
    @patch("controllers.console.auth.oauth._generate_account")
    @patch("controllers.console.auth.oauth.redirect")
    def test_should_redirect_based_on_account_status(
        self,
        mock_redirect,
        mock_generate_account,
        mock_get_providers,
        mock_config,
        mock_db,
        mock_tenant_service,
        mock_account_service,
        resource,
        app,
        oauth_setup,
        account_status,
        expected_redirect,
    ):
        # Mock database session
        mock_db.session = MagicMock()
        mock_db.session.rollback = MagicMock()
        mock_db.session.commit = MagicMock()

        mock_config.CONSOLE_WEB_URL = "http://localhost:3000"
        mock_get_providers.return_value = {"github": oauth_setup["provider"]}

        account = MagicMock()
        account.status = account_status
        account.id = "123"
        mock_generate_account.return_value = account

        # Mock login for CLOSED status
        mock_token_pair = MagicMock()
        mock_token_pair.access_token = "jwt_access_token"
        mock_token_pair.refresh_token = "jwt_refresh_token"
        mock_token_pair.csrf_token = "csrf_token"
        mock_account_service.login.return_value = mock_token_pair

        with app.test_request_context("/auth/oauth/github/callback?code=test_code"):
            resource.get("github")

        mock_redirect.assert_called_once_with(expected_redirect)

    @patch("controllers.console.auth.oauth.dify_config")
    @patch("controllers.console.auth.oauth.get_oauth_providers")
    @patch("controllers.console.auth.oauth._generate_account")
    @patch("controllers.console.auth.oauth.db")
    @patch("controllers.console.auth.oauth.TenantService")
    @patch("controllers.console.auth.oauth.AccountService")
    def test_should_activate_pending_account(
        self,
        mock_account_service,
        mock_tenant_service,
        mock_db,
        mock_generate_account,
        mock_get_providers,
        mock_config,
        resource,
        app,
        oauth_setup,
    ):
        mock_get_providers.return_value = {"github": oauth_setup["provider"]}

        mock_account = MagicMock()
        mock_account.status = AccountStatus.PENDING
        mock_generate_account.return_value = mock_account

        mock_token_pair = MagicMock()
        mock_token_pair.access_token = "jwt_access_token"
        mock_token_pair.refresh_token = "jwt_refresh_token"
        mock_token_pair.csrf_token = "csrf_token"
        mock_account_service.login.return_value = mock_token_pair

        with app.test_request_context("/auth/oauth/github/callback?code=test_code"):
            resource.get("github")

        assert mock_account.status == AccountStatus.ACTIVE
        assert mock_account.initialized_at is not None
        mock_db.session.commit.assert_called_once()

    @patch("controllers.console.auth.oauth.dify_config")
    @patch("controllers.console.auth.oauth.get_oauth_providers")
    @patch("controllers.console.auth.oauth._generate_account")
    @patch("controllers.console.auth.oauth.db")
    @patch("controllers.console.auth.oauth.TenantService")
    @patch("controllers.console.auth.oauth.AccountService")
    @patch("controllers.console.auth.oauth.redirect")
    def test_defensive_check_for_closed_account_status(
        self,
        mock_redirect,
        mock_account_service,
        mock_tenant_service,
        mock_db,
        mock_generate_account,
        mock_get_providers,
        mock_config,
        resource,
        app,
        oauth_setup,
    ):
        """Defensive test for CLOSED account status handling in OAuth callback.

        This is a defensive test documenting expected security behavior for CLOSED accounts.

        Current behavior: CLOSED status is NOT checked, allowing closed accounts to login.
        Expected behavior: CLOSED accounts should be rejected like BANNED accounts.

        Context:
        - AccountStatus.CLOSED is defined in the enum but never used in production
        - The close_account() method exists but is never called
        - Account deletion uses external service instead of status change
        - All authentication services (OAuth, password, email) don't check CLOSED status

        TODO: If CLOSED status is implemented in the future:
        1. Update OAuth callback to check for CLOSED status
        2. Add similar checks to all authentication services for consistency
        3. Update this test to verify the rejection behavior

        Security consideration: Until properly implemented, CLOSED status provides no protection.
        """
        # Setup
        mock_config.CONSOLE_WEB_URL = "http://localhost:3000"
        mock_get_providers.return_value = {"github": oauth_setup["provider"]}

        # Create account with CLOSED status
        closed_account = MagicMock()
        closed_account.status = AccountStatus.CLOSED
        closed_account.id = "123"
        closed_account.name = "Closed Account"
        mock_generate_account.return_value = closed_account

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
        mock_redirect.assert_called_once_with("http://localhost:3000")
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
    def mock_account(self):
        account = MagicMock()
        account.name = "Test User"
        return account

    @patch("controllers.console.auth.oauth.db")
    @patch("controllers.console.auth.oauth.Account")
    @patch("controllers.console.auth.oauth.Session")
    @patch("controllers.console.auth.oauth.select")
    def test_should_get_account_by_openid_or_email(
        self, mock_select, mock_session, mock_account_model, mock_db, user_info, mock_account
    ):
        # Mock db.engine for Session creation
        mock_db.engine = MagicMock()

        # Test OpenID found
        mock_account_model.get_by_openid.return_value = mock_account
        result = _get_account_by_openid_or_email("github", user_info)
        assert result == mock_account
        mock_account_model.get_by_openid.assert_called_once_with("github", "123")

        # Test fallback to email
        mock_account_model.get_by_openid.return_value = None
        mock_session_instance = MagicMock()
        mock_session_instance.execute.return_value.scalar_one_or_none.return_value = mock_account
        mock_session.return_value.__enter__.return_value = mock_session_instance

        result = _get_account_by_openid_or_email("github", user_info)
        assert result == mock_account

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
    @patch("controllers.console.auth.oauth.db")
    def test_should_handle_account_generation_scenarios(
        self,
        mock_db,
        mock_tenant_service,
        mock_account_service,
        mock_register_service,
        mock_feature_service,
        mock_get_account,
        app,
        user_info,
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
                result = _generate_account("github", user_info)
                assert result == mock_account

                if should_create:
                    mock_register_service.register.assert_called_once_with(
                        email="test@example.com", name="Test User", password=None, open_id="123", provider="github"
                    )

    @patch("controllers.console.auth.oauth._get_account_by_openid_or_email")
    @patch("controllers.console.auth.oauth.TenantService")
    @patch("controllers.console.auth.oauth.FeatureService")
    @patch("controllers.console.auth.oauth.AccountService")
    @patch("controllers.console.auth.oauth.tenant_was_created")
    def test_should_create_workspace_for_account_without_tenant(
        self,
        mock_event,
        mock_account_service,
        mock_feature_service,
        mock_tenant_service,
        mock_get_account,
        app,
        user_info,
        mock_account,
    ):
        mock_get_account.return_value = mock_account
        mock_tenant_service.get_join_tenants.return_value = []
        mock_feature_service.get_system_features.return_value.is_allow_create_workspace = True

        mock_new_tenant = MagicMock()
        mock_tenant_service.create_tenant.return_value = mock_new_tenant

        with app.test_request_context(headers={"Accept-Language": "en-US,en;q=0.9"}):
            result = _generate_account("github", user_info)

            assert result == mock_account
            mock_tenant_service.create_tenant.assert_called_once_with("Test User's Workspace")
            mock_tenant_service.create_tenant_member.assert_called_once_with(
                mock_new_tenant, mock_account, role="owner"
            )
            mock_event.send.assert_called_once_with(mock_new_tenant)
