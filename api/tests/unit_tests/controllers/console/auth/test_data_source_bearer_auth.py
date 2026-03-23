from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.auth.data_source_bearer_auth import (
    ApiKeyAuthDataSource,
    ApiKeyAuthDataSourceBinding,
    ApiKeyAuthDataSourceBindingDelete,
)
from controllers.console.auth.error import ApiKeyAuthFailedError


class TestApiKeyAuthDataSource:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["WTF_CSRF_ENABLED"] = False
        return app

    @patch("libs.login.check_csrf_token")
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.get_provider_auth_list")
    def test_get_api_key_auth_data_source(self, mock_get_list, mock_db, mock_csrf, app):
        from models.account import Account, AccountStatus

        mock_account = MagicMock(spec=Account)
        mock_account.id = "user_123"
        mock_account.status = AccountStatus.ACTIVE
        mock_account.is_admin_or_owner = True
        mock_account.current_tenant.current_role = "owner"

        mock_binding = MagicMock()
        mock_binding.id = "bind_123"
        mock_binding.category = "api_key"
        mock_binding.provider = "custom_provider"
        mock_binding.disabled = False
        mock_binding.created_at.timestamp.return_value = 1620000000
        mock_binding.updated_at.timestamp.return_value = 1620000001

        mock_get_list.return_value = [mock_binding]

        with (
            patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_account, "tenant_123")),
            patch(
                "controllers.console.auth.data_source_bearer_auth.current_account_with_tenant",
                return_value=(mock_account, "tenant_123"),
            ),
        ):
            with app.test_request_context("/console/api/api-key-auth/data-source", method="GET"):
                proxy_mock = MagicMock()
                proxy_mock._get_current_object.return_value = mock_account
                with patch("libs.login.current_user", proxy_mock):
                    api_instance = ApiKeyAuthDataSource()
                    response = api_instance.get()

        assert "sources" in response
        assert len(response["sources"]) == 1
        assert response["sources"][0]["provider"] == "custom_provider"

    @patch("libs.login.check_csrf_token")
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.get_provider_auth_list")
    def test_get_api_key_auth_data_source_empty(self, mock_get_list, mock_db, mock_csrf, app):
        from models.account import Account, AccountStatus

        mock_account = MagicMock(spec=Account)
        mock_account.id = "user_123"
        mock_account.status = AccountStatus.ACTIVE
        mock_account.is_admin_or_owner = True
        mock_account.current_tenant.current_role = "owner"

        mock_get_list.return_value = None

        with (
            patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_account, "tenant_123")),
            patch(
                "controllers.console.auth.data_source_bearer_auth.current_account_with_tenant",
                return_value=(mock_account, "tenant_123"),
            ),
        ):
            with app.test_request_context("/console/api/api-key-auth/data-source", method="GET"):
                proxy_mock = MagicMock()
                proxy_mock._get_current_object.return_value = mock_account
                with patch("libs.login.current_user", proxy_mock):
                    api_instance = ApiKeyAuthDataSource()
                    response = api_instance.get()

        assert "sources" in response
        assert len(response["sources"]) == 0


class TestApiKeyAuthDataSourceBinding:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["WTF_CSRF_ENABLED"] = False
        return app

    @patch("libs.login.check_csrf_token")
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.create_provider_auth")
    @patch("controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.validate_api_key_auth_args")
    def test_create_binding_successful(self, mock_validate, mock_create, mock_db, mock_csrf, app):
        from models.account import Account, AccountStatus

        mock_account = MagicMock(spec=Account)
        mock_account.id = "user_123"
        mock_account.status = AccountStatus.ACTIVE
        mock_account.is_admin_or_owner = True
        mock_account.current_tenant.current_role = "owner"

        with (
            patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_account, "tenant_123")),
            patch(
                "controllers.console.auth.data_source_bearer_auth.current_account_with_tenant",
                return_value=(mock_account, "tenant_123"),
            ),
        ):
            with app.test_request_context(
                "/console/api/api-key-auth/data-source/binding",
                method="POST",
                json={"category": "api_key", "provider": "custom", "credentials": {"key": "value"}},
            ):
                proxy_mock = MagicMock()
                proxy_mock._get_current_object.return_value = mock_account
                with patch("libs.login.current_user", proxy_mock), patch("flask_login.current_user", proxy_mock):
                    api_instance = ApiKeyAuthDataSourceBinding()
                    response = api_instance.post()

        assert response[0]["result"] == "success"
        assert response[1] == 200
        mock_validate.assert_called_once()
        mock_create.assert_called_once()

    @patch("libs.login.check_csrf_token")
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.create_provider_auth")
    @patch("controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.validate_api_key_auth_args")
    def test_create_binding_failure(self, mock_validate, mock_create, mock_db, mock_csrf, app):
        from models.account import Account, AccountStatus

        mock_account = MagicMock(spec=Account)
        mock_account.id = "user_123"
        mock_account.status = AccountStatus.ACTIVE
        mock_account.is_admin_or_owner = True
        mock_account.current_tenant.current_role = "owner"

        mock_create.side_effect = ValueError("Invalid structure")

        with (
            patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_account, "tenant_123")),
            patch(
                "controllers.console.auth.data_source_bearer_auth.current_account_with_tenant",
                return_value=(mock_account, "tenant_123"),
            ),
        ):
            with app.test_request_context(
                "/console/api/api-key-auth/data-source/binding",
                method="POST",
                json={"category": "api_key", "provider": "custom", "credentials": {"key": "value"}},
            ):
                proxy_mock = MagicMock()
                proxy_mock._get_current_object.return_value = mock_account
                with patch("libs.login.current_user", proxy_mock), patch("flask_login.current_user", proxy_mock):
                    api_instance = ApiKeyAuthDataSourceBinding()
                    with pytest.raises(ApiKeyAuthFailedError, match="Invalid structure"):
                        api_instance.post()


class TestApiKeyAuthDataSourceBindingDelete:
    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["WTF_CSRF_ENABLED"] = False
        return app

    @patch("libs.login.check_csrf_token")
    @patch("controllers.console.wraps.db")
    @patch("controllers.console.auth.data_source_bearer_auth.ApiKeyAuthService.delete_provider_auth")
    def test_delete_binding_successful(self, mock_delete, mock_db, mock_csrf, app):
        from models.account import Account, AccountStatus

        mock_account = MagicMock(spec=Account)
        mock_account.id = "user_123"
        mock_account.status = AccountStatus.ACTIVE
        mock_account.is_admin_or_owner = True
        mock_account.current_tenant.current_role = "owner"

        with (
            patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_account, "tenant_123")),
            patch(
                "controllers.console.auth.data_source_bearer_auth.current_account_with_tenant",
                return_value=(mock_account, "tenant_123"),
            ),
        ):
            with app.test_request_context("/console/api/api-key-auth/data-source/binding_123", method="DELETE"):
                proxy_mock = MagicMock()
                proxy_mock._get_current_object.return_value = mock_account
                with patch("libs.login.current_user", proxy_mock), patch("flask_login.current_user", proxy_mock):
                    api_instance = ApiKeyAuthDataSourceBindingDelete()
                    response = api_instance.delete("binding_123")

        assert response[0]["result"] == "success"
        assert response[1] == 204
        mock_delete.assert_called_once_with("tenant_123", "binding_123")
