import inspect
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
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
from core.plugin.impl.oauth import OAuthHandler
from graphon.model_runtime.errors.validate import CredentialsValidateFailedError
from services.datasource_provider_service import DatasourceProviderService
from services.plugin.oauth_service import OAuthProxyService

_PROVIDER_ID = "langgenius/notion_datasource/notion"


def _i18n(text: str) -> dict[str, str]:
    return {"en_US": text, "zh_Hans": text, "pt_BR": text, "ja_JP": text}


def _provider_config(name: str, type_: str, label: str, *, required: bool = True) -> dict:
    return {
        "type": type_,
        "name": name,
        "scope": None,
        "required": required,
        "default": None,
        "options": None,
        "multiple": False,
        "label": _i18n(label),
        "help": None,
        "url": None,
        "placeholder": None,
    }


def _datasource_credential(credential_id: str = "cred-1", *, is_default: bool = True) -> dict:
    return {
        "credential": {
            "api_key": "******",
            "workspace": "engineering",
            "database_id": "db-123",
        },
        "type": "api-key",
        "name": "API Key",
        "avatar_url": "https://cdn.example.com/notion.png",
        "id": credential_id,
        "is_default": is_default,
    }


def _datasource_auth() -> dict:
    return {
        "author": "Dify",
        "provider": "notion",
        "plugin_id": "langgenius/notion_datasource",
        "plugin_unique_identifier": "langgenius/notion_datasource:0.0.1",
        "icon": "icon.svg",
        "name": "notion",
        "label": _i18n("Notion"),
        "description": _i18n("Notion datasource"),
        "credential_schema": [
            _provider_config("api_key", "secret-input", "API key"),
        ],
        "oauth_schema": {
            "client_schema": [
                _provider_config("client_id", "text-input", "Client ID"),
            ],
            "credentials_schema": [
                _provider_config("access_token", "secret-input", "Access token"),
            ],
            "oauth_custom_client_params": {"client_id": "masked-client", "client_secret": "********"},
            "is_oauth_custom_client_enabled": True,
            "is_system_oauth_params_exists": True,
            "redirect_uri": "https://api.example.com/oauth/callback",
        },
        "credentials_list": [_datasource_credential(), _datasource_credential("cred-2", is_default=False)],
    }


def _success_response() -> dict[str, str]:
    return {"result": "success"}


class TestDatasourcePluginOAuthAuthorizationUrl:
    def test_get_success(self, app: Flask):
        api = DatasourcePluginOAuthAuthorizationUrl()
        method = inspect.unwrap(api.get)

        user = MagicMock(id="user-1")
        oauth_client = {"client_id": "abc", "client_secret": "shh", "scopes": ["read", "write"]}
        auth_url_payload = {
            "authorization_url": "https://auth.example.com/oauth?client_id=abc&state=xyz",
        }

        with (
            app.test_request_context("/?credential_id=cred-1"),
            patch.object(
                DatasourceProviderService,
                "get_oauth_client",
                return_value=oauth_client,
            ) as get_oauth_client,
            patch.object(
                OAuthProxyService,
                "create_proxy_context",
                return_value="ctx-1",
            ) as create_proxy_context,
            patch.object(
                OAuthHandler,
                "get_authorization_url",
                return_value=auth_url_payload,
            ) as get_authorization_url,
        ):
            response = method(api, "tenant-1", user, _PROVIDER_ID)

        assert response.status_code == 200
        assert response.get_json() == auth_url_payload
        assert "context_id=ctx-1" in response.headers.get("Set-Cookie")
        provider_id = get_oauth_client.call_args.kwargs["datasource_provider_id"]
        assert str(provider_id) == _PROVIDER_ID
        get_oauth_client.assert_called_once()
        create_proxy_context.assert_called_once_with(
            user_id="user-1",
            tenant_id="tenant-1",
            plugin_id="langgenius/notion_datasource",
            provider="notion",
            credential_id="cred-1",
        )
        get_authorization_url.assert_called_once()
        assert get_authorization_url.call_args.kwargs["tenant_id"] == "tenant-1"
        assert get_authorization_url.call_args.kwargs["user_id"] == "user-1"
        assert get_authorization_url.call_args.kwargs["plugin_id"] == "langgenius/notion_datasource"
        assert get_authorization_url.call_args.kwargs["provider"] == "notion"
        assert get_authorization_url.call_args.kwargs["system_credentials"] == oauth_client

    def test_get_no_oauth_config(self, app: Flask):
        api = DatasourcePluginOAuthAuthorizationUrl()
        method = inspect.unwrap(api.get)
        user = MagicMock(id="user-1")

        with (
            app.test_request_context("/"),
            patch.object(
                DatasourceProviderService,
                "get_oauth_client",
                return_value=None,
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "tenant-1", user, "notion")

    def test_get_without_credential_id_sets_cookie(self, app: Flask):
        api = DatasourcePluginOAuthAuthorizationUrl()
        method = inspect.unwrap(api.get)

        user = MagicMock(id="user-1")

        with (
            app.test_request_context("/"),
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
                return_value={"authorization_url": "http://auth"},
            ),
        ):
            response = method(api, "tenant-1", user, _PROVIDER_ID)

        assert response.status_code == 200
        assert "context_id" in response.headers.get("Set-Cookie")


class TestDatasourceOAuthCallback:
    def test_callback_success_new_credential(self, app: Flask):
        api = DatasourceOAuthCallback()
        method = inspect.unwrap(api.get)

        oauth_response = MagicMock()
        oauth_response.credentials = {"token": "abc"}
        expires_at = datetime(2024, 1, 2, 3, 4, 5, tzinfo=UTC)
        oauth_response.expires_at = expires_at
        oauth_response.metadata = {"name": "Workspace Bot", "avatar_url": "https://avatar.example.com/bot.png"}

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
                return_value={"client_id": "abc", "client_secret": "secret"},
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
            ) as add_oauth_provider,
        ):
            response = method(api, _PROVIDER_ID)

        assert response.status_code == 302
        assert "/oauth-callback" in response.location
        add_oauth_provider.assert_called_once()
        assert add_oauth_provider.call_args.kwargs == {
            "tenant_id": "tenant-1",
            "provider_id": add_oauth_provider.call_args.kwargs["provider_id"],
            "avatar_url": "https://avatar.example.com/bot.png",
            "name": "Workspace Bot",
            "expire_at": expires_at,
            "credentials": {"token": "abc"},
        }
        assert str(add_oauth_provider.call_args.kwargs["provider_id"]) == _PROVIDER_ID

    def test_callback_missing_context(self, app: Flask):
        api = DatasourceOAuthCallback()
        method = inspect.unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, "notion")

    def test_callback_invalid_context(self, app: Flask):
        api = DatasourceOAuthCallback()
        method = inspect.unwrap(api.get)

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

    def test_callback_oauth_config_not_found(self, app: Flask):
        api = DatasourceOAuthCallback()
        method = inspect.unwrap(api.get)

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

    def test_callback_reauthorize_existing_credential(self, app: Flask):
        api = DatasourceOAuthCallback()
        method = inspect.unwrap(api.get)

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
            ) as reauthorize_provider,
        ):
            response = method(api, _PROVIDER_ID)

        assert response.status_code == 302
        assert "/oauth-callback" in response.location
        reauthorize_provider.assert_called_once()
        assert str(reauthorize_provider.call_args.kwargs["provider_id"]) == _PROVIDER_ID
        assert reauthorize_provider.call_args.kwargs["credential_id"] == "cred-1"
        assert reauthorize_provider.call_args.kwargs["credentials"] == {"token": "abc"}

    def test_callback_context_id_from_cookie(self, app: Flask):
        api = DatasourceOAuthCallback()
        method = inspect.unwrap(api.get)

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
    def test_post_success(self, app: Flask):
        api = DatasourceAuth()
        method = inspect.unwrap(api.post)

        payload = {
            "name": "Engineering Notion",
            "credentials": {
                "api_key": "secret-token",
                "workspace": "engineering",
                "database_id": "db-123",
            },
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasourceProviderService,
                "add_datasource_api_key_provider",
                return_value=None,
            ) as add_api_key_provider,
        ):
            response, status = method(api, "tenant-1", _PROVIDER_ID)

        assert response == _success_response()
        assert status == 200
        add_api_key_provider.assert_called_once()
        assert add_api_key_provider.call_args.kwargs["tenant_id"] == "tenant-1"
        assert str(add_api_key_provider.call_args.kwargs["provider_id"]) == _PROVIDER_ID
        assert add_api_key_provider.call_args.kwargs["credentials"] == payload["credentials"]
        assert add_api_key_provider.call_args.kwargs["name"] == "Engineering Notion"

    def test_post_invalid_credentials(self, app: Flask):
        api = DatasourceAuth()
        method = inspect.unwrap(api.post)

        payload = {"credentials": {"key": "bad"}}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasourceProviderService,
                "add_datasource_api_key_provider",
                side_effect=CredentialsValidateFailedError("invalid"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "tenant-1", "notion")

    def test_get_success(self, app: Flask):
        api = DatasourceAuth()
        method = inspect.unwrap(api.get)
        user = MagicMock(id="user-1")

        with (
            app.test_request_context("/"),
            patch.object(
                DatasourceProviderService,
                "list_datasource_credentials",
                return_value=[_datasource_credential()],
            ),
        ):
            response, status = method(api, "tenant-1", user, _PROVIDER_ID)

        assert status == 200
        assert response == {"result": [_datasource_credential()]}

    def test_post_missing_credentials(self, app: Flask):
        api = DatasourceAuth()
        method = inspect.unwrap(api.post)

        payload: dict[str, object] = {}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(ValueError):
                method(api, "tenant-1", "notion")

    def test_get_empty_list(self, app: Flask):
        api = DatasourceAuth()
        method = inspect.unwrap(api.get)
        user = MagicMock(id="user-1")

        with (
            app.test_request_context("/"),
            patch.object(
                DatasourceProviderService,
                "list_datasource_credentials",
                return_value=[],
            ),
        ):
            response, status = method(api, "tenant-1", user, "notion")

        assert status == 200
        assert response["result"] == []


class TestDatasourceAuthDeleteApi:
    def test_delete_success(self, app: Flask):
        api = DatasourceAuthDeleteApi()
        method = inspect.unwrap(api.post)

        payload = {"credential_id": "cred-1"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasourceProviderService,
                "remove_datasource_credentials",
                return_value=None,
            ) as remove_datasource_credentials,
        ):
            response, status = method(api, "tenant-1", _PROVIDER_ID)

        assert response == _success_response()
        assert status == 200
        remove_datasource_credentials.assert_called_once_with(
            tenant_id="tenant-1",
            auth_id="cred-1",
            provider="notion",
            plugin_id="langgenius/notion_datasource",
        )

    def test_delete_missing_credential_id(self, app: Flask):
        api = DatasourceAuthDeleteApi()
        method = inspect.unwrap(api.post)

        payload: dict[str, object] = {}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(ValueError):
                method(api, "tenant-1", "notion")


class TestDatasourceAuthUpdateApi:
    def test_update_success(self, app: Flask):
        api = DatasourceAuthUpdateApi()
        method = inspect.unwrap(api.post)

        payload = {
            "credential_id": "cred-1",
            "name": "Updated Notion",
            "credentials": {"api_key": "new-secret", "database_id": "db-456"},
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasourceProviderService,
                "update_datasource_credentials",
                return_value=None,
            ) as update_datasource_credentials,
        ):
            response, status = method(api, "tenant-1", _PROVIDER_ID)

        assert response == _success_response()
        assert status == 201
        update_datasource_credentials.assert_called_once_with(
            tenant_id="tenant-1",
            auth_id="cred-1",
            provider="notion",
            plugin_id="langgenius/notion_datasource",
            credentials=payload["credentials"],
            name="Updated Notion",
        )

    def test_update_with_credentials_none(self, app: Flask):
        api = DatasourceAuthUpdateApi()
        method = inspect.unwrap(api.post)

        payload = {"credential_id": "id", "credentials": None}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasourceProviderService,
                "update_datasource_credentials",
                return_value=None,
            ) as update_mock,
        ):
            response, status = method(api, "tenant-1", "notion")

        assert response == _success_response()
        update_mock.assert_called_once()
        assert update_mock.call_args.kwargs["credentials"] == {}
        assert status == 201

    def test_update_name_only(self, app: Flask):
        api = DatasourceAuthUpdateApi()
        method = inspect.unwrap(api.post)

        payload = {"credential_id": "id", "name": "New Name"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasourceProviderService,
                "update_datasource_credentials",
                return_value=None,
            ),
        ):
            response, status = method(api, "tenant-1", "notion")

        assert response == _success_response()
        assert status == 201

    def test_update_with_empty_credentials_dict(self, app: Flask):
        api = DatasourceAuthUpdateApi()
        method = inspect.unwrap(api.post)

        payload = {"credential_id": "id", "credentials": {}}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasourceProviderService,
                "update_datasource_credentials",
                return_value=None,
            ) as update_mock,
        ):
            response, status = method(api, "tenant-1", "notion")

        assert response == _success_response()
        update_mock.assert_called_once()
        assert status == 201


class TestDatasourceAuthListApi:
    def test_list_success(self, app: Flask):
        api = DatasourceAuthListApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                DatasourceProviderService,
                "get_all_datasource_credentials",
                return_value=[_datasource_auth()],
            ),
        ):
            response, status = method(api, "tenant-1")

        assert status == 200
        assert response == {"result": [_datasource_auth()]}

    def test_auth_list_empty(self, app: Flask):
        api = DatasourceAuthListApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                DatasourceProviderService,
                "get_all_datasource_credentials",
                return_value=[],
            ),
        ):
            response, status = method(api, "tenant-1")

        assert status == 200
        assert response["result"] == []

    def test_hardcode_list_empty(self, app: Flask):
        api = DatasourceHardCodeAuthListApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                DatasourceProviderService,
                "get_hard_code_datasource_credentials",
                return_value=[],
            ),
        ):
            response, status = method(api, "tenant-1")

        assert status == 200
        assert response["result"] == []


class TestDatasourceHardCodeAuthListApi:
    def test_list_success(self, app: Flask):
        api = DatasourceHardCodeAuthListApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                DatasourceProviderService,
                "get_hard_code_datasource_credentials",
                return_value=[_datasource_auth()],
            ),
        ):
            response, status = method(api, "tenant-1")

        assert status == 200


class TestDatasourceAuthOauthCustomClient:
    def test_post_success(self, app: Flask):
        api = DatasourceAuthOauthCustomClient()
        method = inspect.unwrap(api.post)

        payload = {
            "client_params": {
                "client_id": "custom-client",
                "client_secret": "custom-secret",
                "authorize_url": "https://auth.example.com/authorize",
            },
            "enable_oauth_custom_client": True,
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasourceProviderService,
                "setup_oauth_custom_client_params",
                return_value=None,
            ) as setup_custom_client,
        ):
            response, status = method(api, "tenant-1", _PROVIDER_ID)

        assert response == _success_response()
        assert status == 200
        setup_custom_client.assert_called_once()
        assert setup_custom_client.call_args.kwargs["tenant_id"] == "tenant-1"
        assert str(setup_custom_client.call_args.kwargs["datasource_provider_id"]) == _PROVIDER_ID
        assert setup_custom_client.call_args.kwargs["client_params"] == payload["client_params"]
        assert setup_custom_client.call_args.kwargs["enabled"] is True

    def test_delete_success(self, app: Flask):
        api = DatasourceAuthOauthCustomClient()
        method = inspect.unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch.object(
                DatasourceProviderService,
                "remove_oauth_custom_client_params",
                return_value=None,
            ) as remove_custom_client,
        ):
            response, status = method(api, "tenant-1", _PROVIDER_ID)

        assert response == _success_response()
        assert status == 200
        remove_custom_client.assert_called_once()
        assert str(remove_custom_client.call_args.kwargs["datasource_provider_id"]) == _PROVIDER_ID

    def test_post_empty_payload(self, app: Flask):
        api = DatasourceAuthOauthCustomClient()
        method = inspect.unwrap(api.post)

        payload: dict[str, object] = {}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasourceProviderService,
                "setup_oauth_custom_client_params",
                return_value=None,
            ),
        ):
            response, status = method(api, "tenant-1", "notion")

        assert response == _success_response()
        assert status == 200

    def test_post_disabled_flag(self, app: Flask):
        api = DatasourceAuthOauthCustomClient()
        method = inspect.unwrap(api.post)

        payload = {
            "client_params": {"a": 1},
            "enable_oauth_custom_client": False,
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasourceProviderService,
                "setup_oauth_custom_client_params",
                return_value=None,
            ) as setup_mock,
        ):
            response, status = method(api, "tenant-1", "notion")

        assert response == _success_response()
        setup_mock.assert_called_once()
        assert setup_mock.call_args.kwargs["client_params"] == {"a": 1}
        assert setup_mock.call_args.kwargs["enabled"] is False
        assert status == 200


class TestDatasourceAuthDefaultApi:
    def test_set_default_success(self, app: Flask):
        api = DatasourceAuthDefaultApi()
        method = inspect.unwrap(api.post)

        payload = {"id": "cred-1"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasourceProviderService,
                "set_default_datasource_provider",
                return_value=None,
            ) as set_default_datasource_provider,
        ):
            response, status = method(api, "tenant-1", _PROVIDER_ID)

        assert response == _success_response()
        assert status == 200
        set_default_datasource_provider.assert_called_once()
        assert set_default_datasource_provider.call_args.kwargs["tenant_id"] == "tenant-1"
        assert str(set_default_datasource_provider.call_args.kwargs["datasource_provider_id"]) == _PROVIDER_ID
        assert set_default_datasource_provider.call_args.kwargs["credential_id"] == "cred-1"

    def test_default_missing_id(self, app: Flask):
        api = DatasourceAuthDefaultApi()
        method = inspect.unwrap(api.post)

        payload: dict[str, object] = {}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(ValueError):
                method(api, "tenant-1", "notion")


class TestDatasourceUpdateProviderNameApi:
    def test_update_name_success(self, app: Flask):
        api = DatasourceUpdateProviderNameApi()
        method = inspect.unwrap(api.post)

        payload = {"credential_id": "cred-1", "name": "New Name"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasourceProviderService,
                "update_datasource_provider_name",
                return_value=None,
            ) as update_datasource_provider_name,
        ):
            response, status = method(api, "tenant-1", _PROVIDER_ID)

        assert response == _success_response()
        assert status == 200
        update_datasource_provider_name.assert_called_once()
        assert update_datasource_provider_name.call_args.kwargs["tenant_id"] == "tenant-1"
        assert str(update_datasource_provider_name.call_args.kwargs["datasource_provider_id"]) == _PROVIDER_ID
        assert update_datasource_provider_name.call_args.kwargs["name"] == "New Name"
        assert update_datasource_provider_name.call_args.kwargs["credential_id"] == "cred-1"

    def test_update_name_too_long(self, app: Flask):
        api = DatasourceUpdateProviderNameApi()
        method = inspect.unwrap(api.post)

        payload = {
            "credential_id": "id",
            "name": "x" * 101,
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(ValueError):
                method(api, "tenant-1", "notion")

    def test_update_name_missing_credential_id(self, app: Flask):
        api = DatasourceUpdateProviderNameApi()
        method = inspect.unwrap(api.post)

        payload = {"name": "Valid"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(ValueError):
                method(api, "tenant-1", "notion")
