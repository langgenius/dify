from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.local import LocalProxy

from controllers.console.auth.data_source_oauth import (
    OAuthDataSource,
    OAuthDataSourceBinding,
    OAuthDataSourceCallback,
    OAuthDataSourceSync,
)


class TestOAuthDataSource:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.console.auth.data_source_oauth.get_oauth_providers")
    @patch("flask_login.current_user")
    @patch("libs.login.current_user")
    @patch("libs.login.check_csrf_token")
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.data_source_oauth.dify_config.NOTION_INTEGRATION_TYPE", None)
    def test_get_oauth_url_successful(
        self, mock_db, mock_csrf, mock_libs_user, mock_flask_user, mock_get_providers, app
    ):
        mock_oauth_provider = MagicMock()
        mock_oauth_provider.get_authorization_url.return_value = "http://oauth.provider/auth"
        mock_get_providers.return_value = {"notion": mock_oauth_provider}

        from models.account import Account, AccountStatus

        mock_account = MagicMock(spec=Account)
        mock_account.id = "user_123"
        mock_account.status = AccountStatus.ACTIVE
        mock_account.is_admin_or_owner = True
        mock_account.current_tenant.current_role = "owner"
        mock_libs_user.return_value = mock_account
        mock_flask_user.return_value = mock_account

        # also patch current_account_with_tenant
        with patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_account, MagicMock())):
            with app.test_request_context("/console/api/oauth/data-source/notion", method="GET"):
                proxy_mock = LocalProxy(lambda: mock_account)
                with patch("libs.login.current_user", proxy_mock):
                    api_instance = OAuthDataSource()
                    response = api_instance.get("notion")

        assert response[0]["data"] == "http://oauth.provider/auth"
        assert response[1] == 200
        mock_oauth_provider.get_authorization_url.assert_called_once()

    @patch("controllers.console.auth.data_source_oauth.get_oauth_providers")
    @patch("flask_login.current_user")
    @patch("libs.login.check_csrf_token")
    @patch("controllers.console.wraps.db")
    def test_get_oauth_url_invalid_provider(self, mock_db, mock_csrf, mock_flask_user, mock_get_providers, app):
        mock_get_providers.return_value = {"notion": MagicMock()}

        from models.account import Account, AccountStatus

        mock_account = MagicMock(spec=Account)
        mock_account.id = "user_123"
        mock_account.status = AccountStatus.ACTIVE
        mock_account.is_admin_or_owner = True
        mock_account.current_tenant.current_role = "owner"

        with patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_account, MagicMock())):
            with app.test_request_context("/console/api/oauth/data-source/unknown_provider", method="GET"):
                proxy_mock = LocalProxy(lambda: mock_account)
                with patch("libs.login.current_user", proxy_mock):
                    api_instance = OAuthDataSource()
                    response = api_instance.get("unknown_provider")

        assert response[0]["error"] == "Invalid provider"
        assert response[1] == 400


class TestOAuthDataSourceCallback:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.console.auth.data_source_oauth.get_oauth_providers")
    def test_oauth_callback_successful(self, mock_get_providers, app):
        provider_mock = MagicMock()
        mock_get_providers.return_value = {"notion": provider_mock}

        with app.test_request_context("/console/api/oauth/data-source/notion/callback?code=mock_code", method="GET"):
            api_instance = OAuthDataSourceCallback()
            response = api_instance.get("notion")

        assert response.status_code == 302
        assert "code=mock_code" in response.location

    @patch("controllers.console.auth.data_source_oauth.get_oauth_providers")
    def test_oauth_callback_missing_code(self, mock_get_providers, app):
        provider_mock = MagicMock()
        mock_get_providers.return_value = {"notion": provider_mock}

        with app.test_request_context("/console/api/oauth/data-source/notion/callback", method="GET"):
            api_instance = OAuthDataSourceCallback()
            response = api_instance.get("notion")

        assert response.status_code == 302
        assert "error=Access denied" in response.location

    @patch("controllers.console.auth.data_source_oauth.get_oauth_providers")
    def test_oauth_callback_invalid_provider(self, mock_get_providers, app):
        mock_get_providers.return_value = {"notion": MagicMock()}

        with app.test_request_context("/console/api/oauth/data-source/invalid/callback?code=mock_code", method="GET"):
            api_instance = OAuthDataSourceCallback()
            response = api_instance.get("invalid")

        assert response[0]["error"] == "Invalid provider"
        assert response[1] == 400


class TestOAuthDataSourceBinding:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.console.auth.data_source_oauth.get_oauth_providers")
    def test_get_binding_successful(self, mock_get_providers, app):
        mock_provider = MagicMock()
        mock_provider.get_access_token.return_value = None
        mock_get_providers.return_value = {"notion": mock_provider}

        with app.test_request_context("/console/api/oauth/data-source/notion/binding?code=auth_code_123", method="GET"):
            api_instance = OAuthDataSourceBinding()
            response = api_instance.get("notion")

        assert response[0]["result"] == "success"
        assert response[1] == 200
        mock_provider.get_access_token.assert_called_once_with("auth_code_123")

    @patch("controllers.console.auth.data_source_oauth.get_oauth_providers")
    def test_get_binding_missing_code(self, mock_get_providers, app):
        mock_get_providers.return_value = {"notion": MagicMock()}

        with app.test_request_context("/console/api/oauth/data-source/notion/binding?code=", method="GET"):
            api_instance = OAuthDataSourceBinding()
            response = api_instance.get("notion")

        assert response[0]["error"] == "Invalid code"
        assert response[1] == 400


class TestOAuthDataSourceSync:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.console.auth.data_source_oauth.get_oauth_providers")
    @patch("libs.login.check_csrf_token")
    @patch("controllers.console.wraps.db")
    def test_sync_successful(self, mock_db, mock_csrf, mock_get_providers, app):
        mock_provider = MagicMock()
        mock_provider.sync_data_source.return_value = None
        mock_get_providers.return_value = {"notion": mock_provider}

        from models.account import Account, AccountStatus

        mock_account = MagicMock(spec=Account)
        mock_account.id = "user_123"
        mock_account.status = AccountStatus.ACTIVE
        mock_account.is_admin_or_owner = True
        mock_account.current_tenant.current_role = "owner"

        with patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_account, MagicMock())):
            with app.test_request_context("/console/api/oauth/data-source/notion/binding_123/sync", method="GET"):
                proxy_mock = LocalProxy(lambda: mock_account)
                with patch("libs.login.current_user", proxy_mock):
                    api_instance = OAuthDataSourceSync()
                    # The route pattern uses <uuid:binding_id>, so we just pass a string for unit testing
                    response = api_instance.get("notion", "binding_123")

        assert response[0]["result"] == "success"
        assert response[1] == 200
        mock_provider.sync_data_source.assert_called_once_with("binding_123")
