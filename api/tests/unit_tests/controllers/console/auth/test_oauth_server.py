from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console.auth.oauth_server import (
    OAuthServerAppApi,
    OAuthServerUserAccountApi,
    OAuthServerUserAuthorizeApi,
    OAuthServerUserTokenApi,
)


class TestOAuthServerAppApi:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_oauth_provider_app(self):
        from models.model import OAuthProviderApp

        oauth_app = MagicMock(spec=OAuthProviderApp)
        oauth_app.client_id = "test_client_id"
        oauth_app.redirect_uris = ["http://localhost/callback"]
        oauth_app.app_icon = "icon_url"
        oauth_app.app_label = "Test App"
        oauth_app.scope = "read,write"
        return oauth_app

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    def test_successful_post(self, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        with app.test_request_context(
            "/oauth/provider",
            method="POST",
            json={"client_id": "test_client_id", "redirect_uri": "http://localhost/callback"},
        ):
            api_instance = OAuthServerAppApi()
            response = api_instance.post()

        assert response["app_icon"] == "icon_url"
        assert response["app_label"] == "Test App"
        assert response["scope"] == "read,write"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    def test_invalid_redirect_uri(self, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        with app.test_request_context(
            "/oauth/provider",
            method="POST",
            json={"client_id": "test_client_id", "redirect_uri": "http://invalid/callback"},
        ):
            api_instance = OAuthServerAppApi()
            with pytest.raises(BadRequest, match="redirect_uri is invalid"):
                api_instance.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    def test_invalid_client_id(self, mock_get_app, mock_db, app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = None

        with app.test_request_context(
            "/oauth/provider",
            method="POST",
            json={"client_id": "test_invalid_client_id", "redirect_uri": "http://localhost/callback"},
        ):
            api_instance = OAuthServerAppApi()
            with pytest.raises(NotFound, match="client_id is invalid"):
                api_instance.post()


class TestOAuthServerUserAuthorizeApi:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_oauth_provider_app(self):
        oauth_app = MagicMock()
        oauth_app.client_id = "test_client_id"
        return oauth_app

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    @patch("controllers.console.auth.oauth_server.current_account_with_tenant")
    @patch("controllers.console.wraps.current_account_with_tenant")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.sign_oauth_authorization_code")
    @patch("libs.login.check_csrf_token")
    def test_successful_authorize(
        self, mock_csrf, mock_sign, mock_wrap_current, mock_current, mock_get_app, mock_db, app, mock_oauth_provider_app
    ):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        mock_account = MagicMock()
        mock_account.id = "user_123"
        from models.account import AccountStatus

        mock_account.status = AccountStatus.ACTIVE

        mock_current.return_value = (mock_account, MagicMock())
        mock_wrap_current.return_value = (mock_account, MagicMock())

        mock_sign.return_value = "auth_code_123"

        with app.test_request_context("/oauth/provider/authorize", method="POST", json={"client_id": "test_client_id"}):
            with patch("libs.login.current_user", mock_account):
                api_instance = OAuthServerUserAuthorizeApi()
                response = api_instance.post()

        assert response["code"] == "auth_code_123"
        mock_sign.assert_called_once_with("test_client_id", "user_123")


class TestOAuthServerUserTokenApi:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_oauth_provider_app(self):
        from models.model import OAuthProviderApp

        oauth_app = MagicMock(spec=OAuthProviderApp)
        oauth_app.client_id = "test_client_id"
        oauth_app.client_secret = "test_secret"
        oauth_app.redirect_uris = ["http://localhost/callback"]
        return oauth_app

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.sign_oauth_access_token")
    def test_authorization_code_grant(self, mock_sign, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app
        mock_sign.return_value = ("access_123", "refresh_123")

        with app.test_request_context(
            "/oauth/provider/token",
            method="POST",
            json={
                "client_id": "test_client_id",
                "grant_type": "authorization_code",
                "code": "auth_code",
                "client_secret": "test_secret",
                "redirect_uri": "http://localhost/callback",
            },
        ):
            api_instance = OAuthServerUserTokenApi()
            response = api_instance.post()

        assert response["access_token"] == "access_123"
        assert response["refresh_token"] == "refresh_123"
        assert response["token_type"] == "Bearer"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    def test_authorization_code_grant_missing_code(self, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        with app.test_request_context(
            "/oauth/provider/token",
            method="POST",
            json={
                "client_id": "test_client_id",
                "grant_type": "authorization_code",
                "client_secret": "test_secret",
                "redirect_uri": "http://localhost/callback",
            },
        ):
            api_instance = OAuthServerUserTokenApi()
            with pytest.raises(BadRequest, match="code is required"):
                api_instance.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    def test_authorization_code_grant_invalid_secret(self, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        with app.test_request_context(
            "/oauth/provider/token",
            method="POST",
            json={
                "client_id": "test_client_id",
                "grant_type": "authorization_code",
                "code": "auth_code",
                "client_secret": "invalid_secret",
                "redirect_uri": "http://localhost/callback",
            },
        ):
            api_instance = OAuthServerUserTokenApi()
            with pytest.raises(BadRequest, match="client_secret is invalid"):
                api_instance.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    def test_authorization_code_grant_invalid_redirect_uri(self, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        with app.test_request_context(
            "/oauth/provider/token",
            method="POST",
            json={
                "client_id": "test_client_id",
                "grant_type": "authorization_code",
                "code": "auth_code",
                "client_secret": "test_secret",
                "redirect_uri": "http://invalid/callback",
            },
        ):
            api_instance = OAuthServerUserTokenApi()
            with pytest.raises(BadRequest, match="redirect_uri is invalid"):
                api_instance.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.sign_oauth_access_token")
    def test_refresh_token_grant(self, mock_sign, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app
        mock_sign.return_value = ("new_access", "new_refresh")

        with app.test_request_context(
            "/oauth/provider/token",
            method="POST",
            json={"client_id": "test_client_id", "grant_type": "refresh_token", "refresh_token": "refresh_123"},
        ):
            api_instance = OAuthServerUserTokenApi()
            response = api_instance.post()

        assert response["access_token"] == "new_access"
        assert response["refresh_token"] == "new_refresh"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    def test_refresh_token_grant_missing_token(self, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        with app.test_request_context(
            "/oauth/provider/token",
            method="POST",
            json={
                "client_id": "test_client_id",
                "grant_type": "refresh_token",
            },
        ):
            api_instance = OAuthServerUserTokenApi()
            with pytest.raises(BadRequest, match="refresh_token is required"):
                api_instance.post()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    def test_invalid_grant_type(self, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        with app.test_request_context(
            "/oauth/provider/token",
            method="POST",
            json={
                "client_id": "test_client_id",
                "grant_type": "invalid_grant",
            },
        ):
            api_instance = OAuthServerUserTokenApi()
            with pytest.raises(BadRequest, match="invalid grant_type"):
                api_instance.post()


class TestOAuthServerUserAccountApi:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_oauth_provider_app(self):
        from models.model import OAuthProviderApp

        oauth_app = MagicMock(spec=OAuthProviderApp)
        oauth_app.client_id = "test_client_id"
        return oauth_app

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.validate_oauth_access_token")
    def test_successful_account_retrieval(self, mock_validate, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        mock_account = MagicMock()
        mock_account.name = "Test User"
        mock_account.email = "test@example.com"
        mock_account.avatar = "avatar_url"
        mock_account.interface_language = "en-US"
        mock_account.timezone = "UTC"
        mock_validate.return_value = mock_account

        with app.test_request_context(
            "/oauth/provider/account",
            method="POST",
            json={"client_id": "test_client_id"},
            headers={"Authorization": "Bearer valid_access_token"},
        ):
            api_instance = OAuthServerUserAccountApi()
            response = api_instance.post()

        assert response["name"] == "Test User"
        assert response["email"] == "test@example.com"
        assert response["avatar"] == "avatar_url"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    def test_missing_authorization_header(self, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        with app.test_request_context("/oauth/provider/account", method="POST", json={"client_id": "test_client_id"}):
            api_instance = OAuthServerUserAccountApi()
            response = api_instance.post()

        assert response.status_code == 401
        assert response.json["error"] == "Authorization header is required"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    def test_invalid_authorization_header_format(self, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        with app.test_request_context(
            "/oauth/provider/account",
            method="POST",
            json={"client_id": "test_client_id"},
            headers={"Authorization": "InvalidFormat"},
        ):
            api_instance = OAuthServerUserAccountApi()
            response = api_instance.post()

        assert response.status_code == 401
        assert response.json["error"] == "Invalid Authorization header format"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    def test_invalid_token_type(self, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        with app.test_request_context(
            "/oauth/provider/account",
            method="POST",
            json={"client_id": "test_client_id"},
            headers={"Authorization": "Basic something"},
        ):
            api_instance = OAuthServerUserAccountApi()
            response = api_instance.post()

        assert response.status_code == 401
        assert response.json["error"] == "token_type is invalid"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    def test_missing_access_token(self, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app

        with app.test_request_context(
            "/oauth/provider/account",
            method="POST",
            json={"client_id": "test_client_id"},
            headers={"Authorization": "Bearer   "},
        ):
            api_instance = OAuthServerUserAccountApi()
            response = api_instance.post()

        assert response.status_code == 401
        assert response.json["error"] == "Invalid Authorization header format"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.get_oauth_provider_app")
    @patch("controllers.console.auth.oauth_server.OAuthServerService.validate_oauth_access_token")
    def test_invalid_access_token(self, mock_validate, mock_get_app, mock_db, app, mock_oauth_provider_app):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        mock_get_app.return_value = mock_oauth_provider_app
        mock_validate.return_value = None

        with app.test_request_context(
            "/oauth/provider/account",
            method="POST",
            json={"client_id": "test_client_id"},
            headers={"Authorization": "Bearer invalid_token"},
        ):
            api_instance = OAuthServerUserAccountApi()
            response = api_instance.post()

        assert response.status_code == 401
        assert response.json["error"] == "access_token or client_id is invalid"
