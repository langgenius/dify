"""Unit tests for services.plugin.plugin_parameter_service.PluginParameterService.

Covers: dynamic select options via tool and trigger credential paths,
HIDDEN_VALUE replacement, and error handling for missing records.
"""

from __future__ import annotations

from collections.abc import Iterator
from threading import Lock
from unittest.mock import MagicMock, patch

import pytest
from redis import Redis
from sqlalchemy.orm import Session, sessionmaker

import contexts
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import delete_cache_for_subscription
from extensions.ext_redis import RedisClientWrapper
from models.provider_ids import TriggerProviderID
from repositories.trigger.subscription_builder_repository import RedisTriggerSubscriptionBuilderRepository
from repositories.trigger.subscription_repository import RedisTriggerSubscriptionLocks, TriggerSubscriptionRepository
from services.plugin.plugin_parameter_service import PluginParameterService
from services.trigger.subscription_codec import ProviderTriggerSubscriptionCodec
from services.trigger.subscription_gateway import PluginTriggerSubscriptionGateway
from services.trigger.subscription_service import TriggerSubscriptionService
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService
from tests.unit_tests.core.trigger.conftest import make_controller

TOOL_IDENTIFIER = "org/plugin:1.0.0@" + "a" * 32


@pytest.fixture(autouse=True)
def trigger_declaration() -> Iterator[None]:
    provider_id = TriggerProviderID("org/plugin/github")
    controller = make_controller(tenant_id="t1", provider_id=str(provider_id))
    controller.plugin_id = provider_id.plugin_id
    controller.plugin_unique_identifier = f"{provider_id.plugin_id}:1.0.0@{'a' * 32}"
    previous_providers = contexts.plugin_trigger_providers.get({})
    previous_lock = contexts.plugin_trigger_providers_lock.get(Lock())
    contexts.plugin_trigger_providers.set({str(provider_id): controller})
    contexts.plugin_trigger_providers_lock.set(Lock())
    try:
        yield
    finally:
        contexts.plugin_trigger_providers.set(previous_providers)
        contexts.plugin_trigger_providers_lock.set(previous_lock)


@pytest.fixture
def builders(sqlite_session_factory: sessionmaker[Session]) -> Iterator[TriggerSubscriptionBuilderService]:
    # Tool-provider paths receive the real dependency but must not query builder Redis.
    with Redis(socket_connect_timeout=0.1) as client:
        redis = RedisClientWrapper()
        redis.initialize(client)
        subscription_management = TriggerSubscriptionService(
            subscriptions=TriggerSubscriptionRepository(session_factory=sqlite_session_factory),
            providers=PluginTriggerSubscriptionGateway(),
            locks=RedisTriggerSubscriptionLocks(redis=redis),
            codec=ProviderTriggerSubscriptionCodec(),
            invalidate_cache=delete_cache_for_subscription,
        )
        yield TriggerSubscriptionBuilderService(
            builders=RedisTriggerSubscriptionBuilderRepository(redis=redis),
            get_provider=TriggerManager.get_trigger_provider,
            subscribe=TriggerManager.subscribe_trigger,
            create_subscription=subscription_management.create,
        )


class TestGetDynamicSelectOptionsTool:
    @patch("services.plugin.plugin_parameter_service.DynamicSelectClient")
    @patch("services.plugin.plugin_parameter_service.BuiltinToolManageService")
    def test_no_credentials_needed(
        self, mock_builtin_tool_service, mock_client_cls, builders: TriggerSubscriptionBuilderService
    ) -> None:
        """Given a credential-free tool, retain its scoped provider and exact package in dispatch."""
        mock_builtin_tool_service.get_builtin_tool_provider_runtime_credentials.return_value = (
            {},
            "unauthorized",
            TOOL_IDENTIFIER,
        )
        mock_client_cls.return_value.fetch_dynamic_select_options.return_value.options = ["opt1"]

        result = PluginParameterService.get_dynamic_select_options(
            tenant_id="t1",
            user_id="u1",
            plugin_id="org/plugin",
            provider="google",
            action="search",
            parameter="engine",
            credential_id=None,
            provider_type="tool",
            builders=builders,
        )

        assert result == ["opt1"]
        call_kwargs = mock_client_cls.return_value.fetch_dynamic_select_options.call_args
        assert call_kwargs[0][5] == {}  # empty credentials
        assert call_kwargs[0][3] == "org/plugin/google"
        assert call_kwargs.kwargs["plugin_unique_identifier"] == TOOL_IDENTIFIER
        mock_builtin_tool_service.get_builtin_tool_provider_runtime_credentials.assert_called_once_with(
            tenant_id="t1", provider="org/plugin/google", credential_id=None
        )

    @patch("services.plugin.plugin_parameter_service.DynamicSelectClient")
    @patch("services.plugin.plugin_parameter_service.BuiltinToolManageService")
    def test_fetches_credentials_with_credential_id(
        self, mock_builtin_tool_service, mock_client_cls, builders: TriggerSubscriptionBuilderService
    ) -> None:
        """Given a selected tool credential, dispatch options with the resolved credential."""
        mock_builtin_tool_service.get_builtin_tool_provider_runtime_credentials.return_value = (
            {"api_key": "decrypted"},
            "api-key",
            TOOL_IDENTIFIER,
        )
        mock_client_cls.return_value.fetch_dynamic_select_options.return_value.options = ["opt1"]

        result = PluginParameterService.get_dynamic_select_options(
            tenant_id="t1",
            user_id="u1",
            plugin_id="org/plugin",
            provider="google",
            action="search",
            parameter="engine",
            credential_id="cred-id",
            provider_type="tool",
            builders=builders,
        )

        assert result == ["opt1"]

    @patch("services.plugin.plugin_parameter_service.BuiltinToolManageService")
    def test_raises_when_tool_provider_not_found(
        self, mock_builtin_tool_service, builders: TriggerSubscriptionBuilderService
    ) -> None:
        """Given an unavailable tool provider, fail without contacting the plugin daemon."""
        mock_builtin_tool_service.get_builtin_tool_provider_runtime_credentials.side_effect = ValueError("not found")

        with pytest.raises(ValueError, match="not found"):
            PluginParameterService.get_dynamic_select_options(
                tenant_id="t1",
                user_id="u1",
                plugin_id="org/plugin",
                provider="google",
                action="search",
                parameter="engine",
                credential_id=None,
                provider_type="tool",
                builders=builders,
            )


class TestGetDynamicSelectOptionsWithCredentials:
    @patch("services.plugin.plugin_parameter_service.DynamicSelectClient")
    @patch("services.plugin.plugin_parameter_service.TriggerProviderService")
    def test_replaces_hidden_values(self, mock_provider_svc, mock_client_cls):
        from constants import HIDDEN_VALUE

        original = MagicMock()
        original.credentials = {"token": "real-secret", "name": "real-name"}
        original.credential_type = "api_key"
        mock_provider_svc.get_subscription_by_id.return_value = original
        mock_client_cls.return_value.fetch_dynamic_select_options.return_value.options = ["opt"]

        result = PluginParameterService.get_dynamic_select_options_with_credentials(
            tenant_id="t1",
            user_id="u1",
            plugin_id="org/plugin",
            provider="github",
            action="on_push",
            parameter="branch",
            credential_id="cred-1",
            credentials={"token": HIDDEN_VALUE, "name": "new-name"},
        )

        assert result == ["opt"]
        call_args = mock_client_cls.return_value.fetch_dynamic_select_options.call_args[0]
        resolved = call_args[5]
        assert resolved["token"] == "real-secret"  # replaced
        assert resolved["name"] == "new-name"  # kept as-is
        call = mock_client_cls.return_value.fetch_dynamic_select_options.call_args
        assert call.kwargs["plugin_unique_identifier"] == TOOL_IDENTIFIER
        assert call.args[3] == "org/plugin/github"
        subscription_call = mock_provider_svc.get_subscription_by_id.call_args
        assert subscription_call.args == ("t1", "cred-1")
        assert str(subscription_call.kwargs["provider_id"]) == "org/plugin/github"

    @patch("services.plugin.plugin_parameter_service.TriggerProviderService")
    def test_raises_when_subscription_not_found(self, mock_provider_svc):
        mock_provider_svc.get_subscription_by_id.return_value = None

        with pytest.raises(ValueError, match="not found"):
            PluginParameterService.get_dynamic_select_options_with_credentials(
                tenant_id="t1",
                user_id="u1",
                plugin_id="org/plugin",
                provider="github",
                action="on_push",
                parameter="branch",
                credential_id="nonexistent",
                credentials={"token": "val"},
            )


class TestGetDynamicTreeSelectOptions:
    @patch("services.plugin.plugin_parameter_service.DynamicSelectClient")
    @patch("services.plugin.plugin_parameter_service.BuiltinToolManageService")
    def test_no_credentials_needed(self, mock_builtin_tool_service, mock_client_cls):
        mock_builtin_tool_service.get_builtin_tool_provider_runtime_credentials.return_value = (
            {},
            "unauthorized",
            TOOL_IDENTIFIER,
        )
        mock_client_cls.return_value.fetch_dynamic_select_options.return_value.options = ["opt1"]

        result = PluginParameterService.get_dynamic_tree_select_options(
            tenant_id="t1",
            user_id="u1",
            plugin_id="org/plugin",
            provider="google",
            action="search",
            parameter="engine",
            credential_id=None,
            parameter_values={"region": "us"},
        )

        assert result == ["opt1"]
        call = mock_client_cls.return_value.fetch_dynamic_select_options.call_args
        assert call.args[3] == "org/plugin/google"
        assert call.kwargs["plugin_unique_identifier"] == TOOL_IDENTIFIER
        assert call.kwargs["parameter_values"] == {"region": "us"}
