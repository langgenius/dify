from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

from controllers.console import console_ns
from controllers.console.datasets.rag_pipeline.datasource_auth import (
    DatasourceAuth,
    DatasourceAuthDefaultApi,
    DatasourceAuthDeleteApi,
    DatasourceAuthListApi,
    DatasourceAuthOauthCustomClient,
    DatasourceAuthUpdateApi,
    DatasourceHardCodeAuthListApi,
    DatasourceOAuthCallback,
    DatasourcePluginOAuthAuthorizationUrl,
    DatasourceUpdateProviderNameApi,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.plugin.impl.oauth import OAuthHandler
from services.datasource_provider_service import DatasourceProviderService
from services.plugin.oauth_service import OAuthProxyService


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestDatasourcePluginOAuthAuthorizationUrl:
    def test_get_success(self, app):
        api = DatasourcePluginOAuthAuthorizationUrl()
        method = unwrap(api.get)

        user = MagicMock(id="user-1")

        with (
            app.test_request_context("/?credential_id=cred-1"),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "get_oauth_client",
                return_value={"client_id": "abc"},
            ),
            patch.object(
                OAuthProxyService,
                "create_proxy_context",
                return_value="ctx-1",
            ),
            patch.object(
                OAuthHandler,
                "get_authorization_url",
                return_value={"url": "http://auth"},
            ),
        ):
            response = method(api, "notion")

        assert response.status_code == 200

    def test_get_no_oauth_config(self, app):
        api = DatasourcePluginOAuthAuthorizationUrl()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "get_oauth_client",
                return_value=None,
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "notion")

    def test_get_without_credential_id_sets_cookie(self, app):
        api = DatasourcePluginOAuthAuthorizationUrl()
        method = unwrap(api.get)

        user = MagicMock(id="user-1")

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "get_oauth_client",
                return_value={"client_id": "abc"},
            ),
            patch.object(
                OAuthProxyService,
                "create_proxy_context",
                return_value="ctx-123",
            ),
            patch.object(
                OAuthHandler,
                "get_authorization_url",
                return_value={"url": "http://auth"},
            ),
        ):
            response = method(api, "notion")

        assert response.status_code == 200
        assert "context_id" in response.headers.get("Set-Cookie")


class TestDatasourceOAuthCallback:
    def test_callback_success_new_credential(self, app):
        api = DatasourceOAuthCallback()
        method = unwrap(api.get)

        oauth_response = MagicMock()
        oauth_response.credentials = {"token": "abc"}
        oauth_response.expires_at = None
        oauth_response.metadata = {"name": "test"}

        context = {
            "user_id": "user-1",
            "tenant_id": "tenant-1",
            "credential_id": None,
        }

        with (
            app.test_request_context("/?context_id=ctx"),
            patch.object(
                OAuthProxyService,
                "use_proxy_context",
                return_value=context,
            ),
            patch.object(
                DatasourceProviderService,
                "get_oauth_client",
                return_value={"client_id": "abc"},
            ),
            patch.object(
                OAuthHandler,
                "get_credentials",
                return_value=oauth_response,
            ),
            patch.object(
                DatasourceProviderService,
                "add_datasource_oauth_provider",
                return_value=None,
            ),
        ):
            response = method(api, "notion")

        assert response.status_code == 302

    def test_callback_missing_context(self, app):
        api = DatasourceOAuthCallback()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, "notion")

    def test_callback_invalid_context(self, app):
        api = DatasourceOAuthCallback()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?context_id=bad"),
            patch.object(
                OAuthProxyService,
                "use_proxy_context",
                return_value=None,
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "notion")

    def test_callback_oauth_config_not_found(self, app):
        api = DatasourceOAuthCallback()
        method = unwrap(api.get)

        context = {"user_id": "u", "tenant_id": "t"}

        with (
            app.test_request_context("/?context_id=ctx"),
            patch.object(
                OAuthProxyService,
                "use_proxy_context",
                return_value=context,
            ),
            patch.object(
                DatasourceProviderService,
                "get_oauth_client",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "notion")

    def test_callback_reauthorize_existing_credential(self, app):
        api = DatasourceOAuthCallback()
        method = unwrap(api.get)

        oauth_response = MagicMock()
        oauth_response.credentials = {"token": "abc"}
        oauth_response.expires_at = None
        oauth_response.metadata = {}  # avatar + name missing

        context = {
            "user_id": "user-1",
            "tenant_id": "tenant-1",
            "credential_id": "cred-1",
        }

        with (
            app.test_request_context("/?context_id=ctx"),
            patch.object(
                OAuthProxyService,
                "use_proxy_context",
                return_value=context,
            ),
            patch.object(
                DatasourceProviderService,
                "get_oauth_client",
                return_value={"client_id": "abc"},
            ),
            patch.object(
                OAuthHandler,
                "get_credentials",
                return_value=oauth_response,
            ),
            patch.object(
                DatasourceProviderService,
                "reauthorize_datasource_oauth_provider",
                return_value=None,
            ),
        ):
            response = method(api, "notion")

        assert response.status_code == 302
        assert "/oauth-callback" in response.location

    def test_callback_context_id_from_cookie(self, app):
        api = DatasourceOAuthCallback()
        method = unwrap(api.get)

        oauth_response = MagicMock()
        oauth_response.credentials = {"token": "abc"}
        oauth_response.expires_at = None
        oauth_response.metadata = {}

        context = {
            "user_id": "user-1",
            "tenant_id": "tenant-1",
            "credential_id": None,
        }

        with (
            app.test_request_context("/", headers={"Cookie": "context_id=ctx"}),
            patch.object(
                OAuthProxyService,
                "use_proxy_context",
                return_value=context,
            ),
            patch.object(
                DatasourceProviderService,
                "get_oauth_client",
                return_value={"client_id": "abc"},
            ),
            patch.object(
                OAuthHandler,
                "get_credentials",
                return_value=oauth_response,
            ),
            patch.object(
                DatasourceProviderService,
                "add_datasource_oauth_provider",
                return_value=None,
            ),
        ):
            response = method(api, "notion")

        assert response.status_code == 302


class TestDatasourceAuth:
    def test_post_success(self, app):
        api = DatasourceAuth()
        method = unwrap(api.post)

        payload = {"credentials": {"key": "val"}}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "add_datasource_api_key_provider",
                return_value=None,
            ),
        ):
            response, status = method(api, "notion")

        assert status == 200

    def test_post_invalid_credentials(self, app):
        api = DatasourceAuth()
        method = unwrap(api.post)

        payload = {"credentials": {"key": "bad"}}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "add_datasource_api_key_provider",
                side_effect=CredentialsValidateFailedError("invalid"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "notion")

    def test_get_success(self, app):
        api = DatasourceAuth()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "list_datasource_credentials",
                return_value=[{"id": "1"}],
            ),
        ):
            response, status = method(api, "notion")

        assert status == 200
        assert response["result"]

    def test_post_missing_credentials(self, app):
        api = DatasourceAuth()
        method = unwrap(api.post)

        payload = {}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "notion")

    def test_get_empty_list(self, app):
        api = DatasourceAuth()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "list_datasource_credentials",
                return_value=[],
            ),
        ):
            response, status = method(api, "notion")

        assert status == 200
        assert response["result"] == []


class TestDatasourceAuthDeleteApi:
    def test_delete_success(self, app):
        api = DatasourceAuthDeleteApi()
        method = unwrap(api.post)

        payload = {"credential_id": "cred-1"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "remove_datasource_credentials",
                return_value=None,
            ),
        ):
            response, status = method(api, "notion")

        assert status == 200

    def test_delete_missing_credential_id(self, app):
        api = DatasourceAuthDeleteApi()
        method = unwrap(api.post)

        payload = {}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "notion")


class TestDatasourceAuthUpdateApi:
    def test_update_success(self, app):
        api = DatasourceAuthUpdateApi()
        method = unwrap(api.post)

        payload = {"credential_id": "id", "credentials": {"k": "v"}}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "update_datasource_credentials",
                return_value=None,
            ),
        ):
            response, status = method(api, "notion")

        assert status == 201

    def test_update_with_credentials_none(self, app):
        api = DatasourceAuthUpdateApi()
        method = unwrap(api.post)

        payload = {"credential_id": "id", "credentials": None}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "update_datasource_credentials",
                return_value=None,
            ) as update_mock,
        ):
            response, status = method(api, "notion")

        update_mock.assert_called_once()
        assert status == 201

    def test_update_name_only(self, app):
        api = DatasourceAuthUpdateApi()
        method = unwrap(api.post)

        payload = {"credential_id": "id", "name": "New Name"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "update_datasource_credentials",
                return_value=None,
            ),
        ):
            _, status = method(api, "notion")

        assert status == 201

    def test_update_with_empty_credentials_dict(self, app):
        api = DatasourceAuthUpdateApi()
        method = unwrap(api.post)

        payload = {"credential_id": "id", "credentials": {}}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "update_datasource_credentials",
                return_value=None,
            ) as update_mock,
        ):
            _, status = method(api, "notion")

        update_mock.assert_called_once()
        assert status == 201


class TestDatasourceAuthListApi:
    def test_list_success(self, app):
        api = DatasourceAuthListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "get_all_datasource_credentials",
                return_value=[{"id": "1"}],
            ),
        ):
            response, status = method(api)

        assert status == 200

    def test_auth_list_empty(self, app):
        api = DatasourceAuthListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "get_all_datasource_credentials",
                return_value=[],
            ),
        ):
            response, status = method(api)

        assert status == 200
        assert response["result"] == []

    def test_hardcode_list_empty(self, app):
        api = DatasourceHardCodeAuthListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "get_hard_code_datasource_credentials",
                return_value=[],
            ),
        ):
            response, status = method(api)

        assert status == 200
        assert response["result"] == []


class TestDatasourceHardCodeAuthListApi:
    def test_list_success(self, app):
        api = DatasourceHardCodeAuthListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "get_hard_code_datasource_credentials",
                return_value=[{"id": "1"}],
            ),
        ):
            response, status = method(api)

        assert status == 200


class TestDatasourceAuthOauthCustomClient:
    def test_post_success(self, app):
        api = DatasourceAuthOauthCustomClient()
        method = unwrap(api.post)

        payload = {"client_params": {}, "enable_oauth_custom_client": True}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "setup_oauth_custom_client_params",
                return_value=None,
            ),
        ):
            response, status = method(api, "notion")

        assert status == 200

    def test_delete_success(self, app):
        api = DatasourceAuthOauthCustomClient()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "remove_oauth_custom_client_params",
                return_value=None,
            ),
        ):
            response, status = method(api, "notion")

        assert status == 200

    def test_post_empty_payload(self, app):
        api = DatasourceAuthOauthCustomClient()
        method = unwrap(api.post)

        payload = {}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "setup_oauth_custom_client_params",
                return_value=None,
            ),
        ):
            _, status = method(api, "notion")

        assert status == 200

    def test_post_disabled_flag(self, app):
        api = DatasourceAuthOauthCustomClient()
        method = unwrap(api.post)

        payload = {
            "client_params": {"a": 1},
            "enable_oauth_custom_client": False,
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "setup_oauth_custom_client_params",
                return_value=None,
            ) as setup_mock,
        ):
            _, status = method(api, "notion")

        setup_mock.assert_called_once()
        assert status == 200


class TestDatasourceAuthDefaultApi:
    def test_set_default_success(self, app):
        api = DatasourceAuthDefaultApi()
        method = unwrap(api.post)

        payload = {"id": "cred-1"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "set_default_datasource_provider",
                return_value=None,
            ),
        ):
            response, status = method(api, "notion")

        assert status == 200

    def test_default_missing_id(self, app):
        api = DatasourceAuthDefaultApi()
        method = unwrap(api.post)

        payload = {}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "notion")


class TestDatasourceUpdateProviderNameApi:
    def test_update_name_success(self, app):
        api = DatasourceUpdateProviderNameApi()
        method = unwrap(api.post)

        payload = {"credential_id": "id", "name": "New Name"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                DatasourceProviderService,
                "update_datasource_provider_name",
                return_value=None,
            ),
        ):
            response, status = method(api, "notion")

        assert status == 200

    def test_update_name_too_long(self, app):
        api = DatasourceUpdateProviderNameApi()
        method = unwrap(api.post)

        payload = {
            "credential_id": "id",
            "name": "x" * 101,
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "notion")

    def test_update_name_missing_credential_id(self, app):
        api = DatasourceUpdateProviderNameApi()
        method = unwrap(api.post)

        payload = {"name": "Valid"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.datasource_auth.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "notion")
