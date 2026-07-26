"""Unit tests for controllers.console.workspace.trigger_providers endpoints."""

from __future__ import annotations

from datetime import datetime
from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest, Forbidden

from controllers.common.errors import NotFoundError
from controllers.console.workspace.trigger_providers import (
    TriggerOAuthAuthorizeApi,
    TriggerOAuthCallbackApi,
    TriggerOAuthClientManageApi,
    TriggerProviderIconApi,
    TriggerProviderInfoApi,
    TriggerProviderListApi,
    TriggerSubscriptionBuilderBuildApi,
    TriggerSubscriptionBuilderCreateApi,
    TriggerSubscriptionBuilderGetApi,
    TriggerSubscriptionBuilderLogsApi,
    TriggerSubscriptionBuilderUpdateApi,
    TriggerSubscriptionBuilderVerifyApi,
    TriggerSubscriptionListApi,
    TriggerSubscriptionUpdateApi,
    TriggerSubscriptionVerifyApi,
)
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.api_entities import SubscriptionBuilderApiEntity, TriggerProviderApiEntity
from core.trigger.entities.entities import RequestLog
from models.account import Account


def mock_user() -> Account:
    user = Account(name="User", email="user.com")
    user.id = "u1"
    return user


def trigger_provider() -> TriggerProviderApiEntity:
    return TriggerProviderApiEntity(
        author="Dify",
        name="github",
        label={"en_US": "GitHub"},
        description={"en_US": "GitHub trigger provider"},
        icon="icon.svg",
        icon_dark=None,
        tags=["code"],
        plugin_id="plugin",
        plugin_unique_identifier="plugin:github",
        supported_creation_methods=[],
        subscription_constructor=None,
        subscription_schema=[],
        events=[],
    )


def subscription_builder() -> SubscriptionBuilderApiEntity:
    return SubscriptionBuilderApiEntity(
        id="b1",
        name="Builder",
        provider="github",
        endpoint="b1",
        parameters={"repo": "dify"},
        properties={"branch": "main"},
        credentials={"token": "secret"},
        credential_type=CredentialType.UNAUTHORIZED,
    )


def request_log() -> RequestLog:
    return RequestLog(
        id="log1",
        endpoint="/hooks/b1",
        request={"headers": {}, "body": {"event": "push"}},
        response={"status": 200, "body": {"ok": True}},
        created_at=datetime(2024, 1, 1),
    )


class TestTriggerProviderApis:
    def test_icon_success(self, app: Flask) -> None:
        api = TriggerProviderIconApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerManager.get_trigger_plugin_icon",
                return_value="icon",
            ),
        ):
            assert method(api, "t1", "github") == "icon"

    def test_list_providers(self, app: Flask) -> None:
        api = TriggerProviderListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.list_trigger_providers",
                return_value=[],
            ),
        ):
            assert method(api, "t1") == []

    def test_provider_info(self, app: Flask) -> None:
        api = TriggerProviderInfoApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_trigger_provider",
                return_value=trigger_provider(),
            ),
        ):
            assert method(api, "t1", "github")["name"] == "github"


class TestTriggerSubscriptionListApi:
    def test_list_success(self, app: Flask) -> None:
        api = TriggerSubscriptionListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.list_trigger_provider_subscriptions",
                return_value=[],
            ),
        ):
            assert method(api, "t1", mock_user(), "github") == []

    def test_list_invalid_provider(self, app: Flask) -> None:
        api = TriggerSubscriptionListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.list_trigger_provider_subscriptions",
                side_effect=ValueError("bad"),
            ),
        ):
            result, status = method(api, "t1", mock_user(), "bad")
            assert status == 404


class TestTriggerSubscriptionBuilderApis:
    def test_create_builder(self, app: Flask) -> None:
        api = TriggerSubscriptionBuilderCreateApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credential_type": "UNAUTHORIZED"}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.create_trigger_subscription_builder",
                return_value=subscription_builder(),
            ),
        ):
            result = method(api, "t1", mock_user(), "github")
            assert result["subscription_builder"]["id"] == "b1"

    def test_get_builder(self, app: Flask) -> None:
        api = TriggerSubscriptionBuilderGetApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.get_subscription_builder_by_id",
                return_value=subscription_builder(),
            ),
        ):
            assert method(api, "github", "b1")["id"] == "b1"

    def test_verify_builder(self, app: Flask) -> None:
        api = TriggerSubscriptionBuilderVerifyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credentials": {"a": 1}}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.update_and_verify_builder",
                return_value={"verified": True},
            ),
        ):
            assert method(api, "t1", mock_user(), "github", "b1") == {"verified": True}

    def test_verify_builder_error(self, app: Flask) -> None:
        api = TriggerSubscriptionBuilderVerifyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credentials": {}}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.update_and_verify_builder",
                side_effect=Exception("err"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "t1", mock_user(), "github", "b1")

    def test_update_builder(self, app: Flask) -> None:
        api = TriggerSubscriptionBuilderUpdateApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"name": "n"}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.update_trigger_subscription_builder",
                return_value=subscription_builder(),
            ),
        ):
            assert method(api, "t1", "github", "b1")["id"] == "b1"

    def test_logs(self, app: Flask) -> None:
        api = TriggerSubscriptionBuilderLogsApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.list_logs",
                return_value=[request_log()],
            ),
        ):
            result = method(api, "github", "b1")
            assert result["logs"][0]["id"] == "log1"

    def test_build(self, app: Flask) -> None:
        api = TriggerSubscriptionBuilderBuildApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"name": "x"}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.update_and_build_builder",
                return_value=None,
            ),
        ):
            assert method(api, "t1", mock_user(), "github", "b1") == {"result": "success"}


class TestTriggerSubscriptionCrud:
    def test_update_rename_only(self, app: Flask) -> None:
        api = TriggerSubscriptionUpdateApi()
        method = unwrap(api.post)

        sub = MagicMock()
        sub.provider_id = "github"
        sub.credential_type = CredentialType.UNAUTHORIZED

        with (
            app.test_request_context("/", json={"name": "x"}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_subscription_by_id",
                return_value=sub,
            ),
            patch("controllers.console.workspace.trigger_providers.TriggerProviderService.update_trigger_subscription"),
        ):
            assert method(api, "t1", "s1") == {"result": "success"}

    def test_update_not_found(self, app: Flask) -> None:
        api = TriggerSubscriptionUpdateApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"name": "x"}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_subscription_by_id",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFoundError):
                method(api, "t1", "x")

    def test_update_rebuild(self, app: Flask) -> None:
        api = TriggerSubscriptionUpdateApi()
        method = unwrap(api.post)

        sub = MagicMock()
        sub.provider_id = "github"
        sub.credential_type = CredentialType.OAUTH2
        sub.credentials = {"token": "old"}
        sub.parameters = {"repo": "demo"}

        with (
            app.test_request_context("/", json={"credentials": {}}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_subscription_by_id",
                return_value=sub,
            ),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.rebuild_trigger_subscription"
            ),
        ):
            assert method(api, "t1", "s1") == {"result": "success"}


class TestTriggerOAuthApis:
    def test_oauth_authorize_success(self, app: Flask) -> None:
        api = TriggerOAuthAuthorizeApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_oauth_client",
                return_value={"a": 1},
            ),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.create_trigger_subscription_builder",
                return_value=subscription_builder(),
            ),
            patch(
                "controllers.console.workspace.trigger_providers.OAuthProxyService.create_proxy_context",
                return_value="ctx",
            ),
            patch(
                "controllers.console.workspace.trigger_providers.OAuthHandler.get_authorization_url",
                return_value=MagicMock(authorization_url="url"),
            ),
        ):
            resp = method(api, "t1", mock_user(), "github")
            assert resp.status_code == 200

    def test_oauth_authorize_no_client(self, app: Flask) -> None:
        api = TriggerOAuthAuthorizeApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_oauth_client",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFoundError):
                method(api, "t1", mock_user(), "github")

    def test_oauth_callback_forbidden(self, app: Flask) -> None:
        api = TriggerOAuthCallbackApi()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, "github")

    def test_oauth_callback_success(self, app: Flask) -> None:
        api = TriggerOAuthCallbackApi()
        method = unwrap(api.get)

        ctx = {
            "user_id": "u1",
            "tenant_id": "t1",
            "subscription_builder_id": "b1",
        }

        with (
            app.test_request_context("/", headers={"Cookie": "context_id=ctx"}),
            patch(
                "controllers.console.workspace.trigger_providers.OAuthProxyService.use_proxy_context", return_value=ctx
            ),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_oauth_client",
                return_value={"a": 1},
            ),
            patch(
                "controllers.console.workspace.trigger_providers.OAuthHandler.get_credentials",
                return_value=MagicMock(credentials={"a": 1}, expires_at=1),
            ),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.update_trigger_subscription_builder"
            ),
        ):
            resp = method(api, "github")
            assert resp.status_code == 302

    def test_oauth_callback_no_oauth_client(self, app: Flask) -> None:
        api = TriggerOAuthCallbackApi()
        method = unwrap(api.get)

        ctx = {
            "user_id": "u1",
            "tenant_id": "t1",
            "subscription_builder_id": "b1",
        }

        with (
            app.test_request_context("/", headers={"Cookie": "context_id=ctx"}),
            patch(
                "controllers.console.workspace.trigger_providers.OAuthProxyService.use_proxy_context",
                return_value=ctx,
            ),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_oauth_client",
                return_value=None,
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "github")

    def test_oauth_callback_empty_credentials(self, app: Flask) -> None:
        api = TriggerOAuthCallbackApi()
        method = unwrap(api.get)

        ctx = {
            "user_id": "u1",
            "tenant_id": "t1",
            "subscription_builder_id": "b1",
        }

        with (
            app.test_request_context("/", headers={"Cookie": "context_id=ctx"}),
            patch(
                "controllers.console.workspace.trigger_providers.OAuthProxyService.use_proxy_context",
                return_value=ctx,
            ),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_oauth_client",
                return_value={"a": 1},
            ),
            patch(
                "controllers.console.workspace.trigger_providers.OAuthHandler.get_credentials",
                return_value=MagicMock(credentials=None, expires_at=None),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "github")


class TestTriggerOAuthClientManageApi:
    def test_get_client(self, app: Flask) -> None:
        api = TriggerOAuthClientManageApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_custom_oauth_client_params",
                return_value={},
            ),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.is_oauth_custom_client_enabled",
                return_value=False,
            ),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.is_oauth_system_client_exists",
                return_value=True,
            ),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerManager.get_trigger_provider",
                return_value=MagicMock(get_oauth_client_schema=lambda: []),
            ),
        ):
            result = method(api, "t1", "github")
            assert "configured" in result

    def test_post_client(self, app: Flask) -> None:
        api = TriggerOAuthClientManageApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"enabled": True}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.save_custom_oauth_client_params",
                return_value={"result": "success"},
            ),
        ):
            assert method(api, "t1", "github") == {"result": "success"}

    def test_delete_client(self, app: Flask) -> None:
        api = TriggerOAuthClientManageApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.delete_custom_oauth_client_params",
                return_value={"result": "success"},
            ),
        ):
            assert method(api, "t1", "github") == {"result": "success"}

    def test_oauth_client_post_value_error(self, app: Flask) -> None:
        api = TriggerOAuthClientManageApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"enabled": True}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.save_custom_oauth_client_params",
                side_effect=ValueError("bad"),
            ),
        ):
            with pytest.raises(BadRequest):
                method(api, "t1", "github")


class TestTriggerSubscriptionVerifyApi:
    def test_verify_success(self, app: Flask) -> None:
        api = TriggerSubscriptionVerifyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credentials": {}}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.verify_subscription_credentials",
                return_value={"verified": True},
            ),
        ):
            assert method(api, "t1", mock_user(), "github", "s1") == {"verified": True}

    @pytest.mark.parametrize("raised_exception", [ValueError("bad"), Exception("boom")])
    def test_verify_errors(self, app: Flask, raised_exception: Exception) -> None:
        api = TriggerSubscriptionVerifyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credentials": {}}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.verify_subscription_credentials",
                side_effect=raised_exception,
            ),
        ):
            with pytest.raises(BadRequest):
                method(api, "t1", mock_user(), "github", "s1")
