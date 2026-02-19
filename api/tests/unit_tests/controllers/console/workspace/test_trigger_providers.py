from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import BadRequest, Forbidden

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
    TriggerSubscriptionDeleteApi,
    TriggerSubscriptionListApi,
    TriggerSubscriptionUpdateApi,
    TriggerSubscriptionVerifyApi,
)
from controllers.web.error import NotFoundError
from core.plugin.entities.plugin_daemon import CredentialType
from models.account import Account


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def mock_user():
    user = MagicMock(spec=Account)
    user.id = "u1"
    user.current_tenant_id = "t1"
    return user


class TestTriggerProviderApis:
    def test_icon_success(self, app):
        api = TriggerProviderIconApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerManager.get_trigger_plugin_icon",
                return_value="icon",
            ),
        ):
            assert method(api, "github") == "icon"

    def test_list_providers(self, app):
        api = TriggerProviderListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.list_trigger_providers",
                return_value=[],
            ),
        ):
            assert method(api) == []

    def test_provider_info(self, app):
        api = TriggerProviderInfoApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_trigger_provider",
                return_value={"id": "p1"},
            ),
        ):
            assert method(api, "github") == {"id": "p1"}


class TestTriggerSubscriptionListApi:
    def test_list_success(self, app):
        api = TriggerSubscriptionListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.list_trigger_provider_subscriptions",
                return_value=[],
            ),
        ):
            assert method(api, "github") == []

    def test_list_invalid_provider(self, app):
        api = TriggerSubscriptionListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.list_trigger_provider_subscriptions",
                side_effect=ValueError("bad"),
            ),
        ):
            result, status = method(api, "bad")
            assert status == 404


class TestTriggerSubscriptionBuilderApis:
    def test_create_builder(self, app):
        api = TriggerSubscriptionBuilderCreateApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credential_type": "UNAUTHORIZED"}),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.create_trigger_subscription_builder",
                return_value={"id": "b1"},
            ),
        ):
            result = method(api, "github")
            assert "subscription_builder" in result

    def test_get_builder(self, app):
        api = TriggerSubscriptionBuilderGetApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.get_subscription_builder_by_id",
                return_value={"id": "b1"},
            ),
        ):
            assert method(api, "github", "b1") == {"id": "b1"}

    def test_verify_builder(self, app):
        api = TriggerSubscriptionBuilderVerifyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credentials": {"a": 1}}),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.update_and_verify_builder",
                return_value={"ok": True},
            ),
        ):
            assert method(api, "github", "b1") == {"ok": True}

    def test_verify_builder_error(self, app):
        api = TriggerSubscriptionBuilderVerifyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credentials": {}}),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.update_and_verify_builder",
                side_effect=Exception("err"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "github", "b1")

    def test_update_builder(self, app):
        api = TriggerSubscriptionBuilderUpdateApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"name": "n"}),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.update_trigger_subscription_builder",
                return_value={"id": "b1"},
            ),
        ):
            assert method(api, "github", "b1") == {"id": "b1"}

    def test_logs(self, app):
        api = TriggerSubscriptionBuilderLogsApi()
        method = unwrap(api.get)

        log = MagicMock()
        log.model_dump.return_value = {"a": 1}

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.list_logs",
                return_value=[log],
            ),
        ):
            assert "logs" in method(api, "github", "b1")

    def test_build(self, app):
        api = TriggerSubscriptionBuilderBuildApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"name": "x"}),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.update_and_build_builder",
                return_value=None,
            ),
        ):
            assert method(api, "github", "b1") == 200


class TestTriggerSubscriptionCrud:
    def test_update_rename_only(self, app):
        api = TriggerSubscriptionUpdateApi()
        method = unwrap(api.post)

        sub = MagicMock()
        sub.provider_id = "github"
        sub.credential_type = CredentialType.UNAUTHORIZED

        with (
            app.test_request_context("/", json={"name": "x"}),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_subscription_by_id",
                return_value=sub,
            ),
            patch("controllers.console.workspace.trigger_providers.TriggerProviderService.update_trigger_subscription"),
        ):
            assert method(api, "s1") == 200

    def test_update_not_found(self, app):
        api = TriggerSubscriptionUpdateApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"name": "x"}),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_subscription_by_id",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFoundError):
                method(api, "x")

    def test_update_rebuild(self, app):
        api = TriggerSubscriptionUpdateApi()
        method = unwrap(api.post)

        sub = MagicMock()
        sub.provider_id = "github"
        sub.credential_type = CredentialType.OAUTH2
        sub.credentials = {}
        sub.parameters = {}

        with (
            app.test_request_context("/", json={"credentials": {}}),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_subscription_by_id",
                return_value=sub,
            ),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.rebuild_trigger_subscription"
            ),
        ):
            assert method(api, "s1") == 200

    def test_delete_subscription(self, app):
        api = TriggerSubscriptionDeleteApi()
        method = unwrap(api.post)

        mock_session = MagicMock()

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch("controllers.console.workspace.trigger_providers.db") as mock_db,
            patch("controllers.console.workspace.trigger_providers.Session") as mock_session_cls,
            patch("controllers.console.workspace.trigger_providers.TriggerProviderService.delete_trigger_provider"),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionOperatorService.delete_plugin_trigger_by_subscription"
            ),
        ):
            mock_db.engine = MagicMock()
            mock_session_cls.return_value.__enter__.return_value = mock_session

            result = method(api, "sub1")

        assert result["result"] == "success"

    def test_delete_subscription_value_error(self, app):
        api = TriggerSubscriptionDeleteApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch("controllers.console.workspace.trigger_providers.db") as mock_db,
            patch("controllers.console.workspace.trigger_providers.Session") as session_cls,
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.delete_trigger_provider",
                side_effect=ValueError("bad"),
            ),
        ):
            mock_db.engine = MagicMock()
            session_cls.return_value.__enter__.return_value = MagicMock()

            with pytest.raises(BadRequest):
                method(api, "sub1")


class TestTriggerOAuthApis:
    def test_oauth_authorize_success(self, app):
        api = TriggerOAuthAuthorizeApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_oauth_client",
                return_value={"a": 1},
            ),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerSubscriptionBuilderService.create_trigger_subscription_builder",
                return_value=MagicMock(id="b1"),
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
            resp = method(api, "github")
            assert resp.status_code == 200

    def test_oauth_authorize_no_client(self, app):
        api = TriggerOAuthAuthorizeApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_oauth_client",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFoundError):
                method(api, "github")

    def test_oauth_callback_forbidden(self, app):
        api = TriggerOAuthCallbackApi()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, "github")

    def test_oauth_callback_success(self, app):
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

    def test_oauth_callback_no_oauth_client(self, app):
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

    def test_oauth_callback_empty_credentials(self, app):
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
    def test_get_client(self, app):
        api = TriggerOAuthClientManageApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
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
                return_value=MagicMock(get_oauth_client_schema=lambda: {}),
            ),
        ):
            result = method(api, "github")
            assert "configured" in result

    def test_post_client(self, app):
        api = TriggerOAuthClientManageApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"enabled": True}),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.save_custom_oauth_client_params",
                return_value={"ok": True},
            ),
        ):
            assert method(api, "github") == {"ok": True}

    def test_delete_client(self, app):
        api = TriggerOAuthClientManageApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.delete_custom_oauth_client_params",
                return_value={"ok": True},
            ),
        ):
            assert method(api, "github") == {"ok": True}

    def test_oauth_client_post_value_error(self, app):
        api = TriggerOAuthClientManageApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"enabled": True}),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.save_custom_oauth_client_params",
                side_effect=ValueError("bad"),
            ),
        ):
            with pytest.raises(BadRequest):
                method(api, "github")


class TestTriggerSubscriptionVerifyApi:
    def test_verify_success(self, app):
        api = TriggerSubscriptionVerifyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credentials": {}}),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.verify_subscription_credentials",
                return_value={"ok": True},
            ),
        ):
            assert method(api, "github", "s1") == {"ok": True}

    @pytest.mark.parametrize("raised_exception", [ValueError("bad"), Exception("boom")])
    def test_verify_errors(self, app, raised_exception):
        api = TriggerSubscriptionVerifyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credentials": {}}),
            patch("controllers.console.workspace.trigger_providers.current_user", mock_user()),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.verify_subscription_credentials",
                side_effect=raised_exception,
            ),
        ):
            with pytest.raises(BadRequest):
                method(api, "github", "s1")
