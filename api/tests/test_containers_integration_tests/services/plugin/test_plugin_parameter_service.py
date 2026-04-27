"""Tests for services.plugin.plugin_parameter_service.PluginParameterService.

Covers: dynamic select options via tool and trigger credential paths,
HIDDEN_VALUE replacement, and error handling for missing records.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.plugin.plugin_parameter_service import PluginParameterService


class TestGetDynamicSelectOptionsTool:
    @patch("services.plugin.plugin_parameter_service.DynamicSelectClient")
    @patch("services.plugin.plugin_parameter_service.BuiltinToolManageService")
    def test_no_credentials_needed(self, mock_builtin_tool_service, mock_client_cls):
        mock_builtin_tool_service.get_builtin_tool_provider_runtime_credentials.return_value = ({}, "unauthorized")
        mock_client_cls.return_value.fetch_dynamic_select_options.return_value.options = ["opt1"]

        result = PluginParameterService.get_dynamic_select_options(
            tenant_id="t1",
            user_id="u1",
            plugin_id="p1",
            provider="google",
            action="search",
            parameter="engine",
            credential_id=None,
            provider_type="tool",
        )

        assert result == ["opt1"]
        call_kwargs = mock_client_cls.return_value.fetch_dynamic_select_options.call_args
        assert call_kwargs[0][5] == {}  # empty credentials

    @patch("services.plugin.plugin_parameter_service.DynamicSelectClient")
    @patch("services.plugin.plugin_parameter_service.BuiltinToolManageService")
    def test_fetches_credentials_with_credential_id(self, mock_builtin_tool_service, mock_client_cls):
        mock_builtin_tool_service.get_builtin_tool_provider_runtime_credentials.return_value = (
            {"api_key": "decrypted"},
            "api-key",
        )
        mock_client_cls.return_value.fetch_dynamic_select_options.return_value.options = ["opt1"]

        result = PluginParameterService.get_dynamic_select_options(
            tenant_id="t1",
            user_id="u1",
            plugin_id="p1",
            provider="google",
            action="search",
            parameter="engine",
            credential_id="cred-id",
            provider_type="tool",
        )

        assert result == ["opt1"]

    @patch("services.plugin.plugin_parameter_service.BuiltinToolManageService")
    def test_raises_when_tool_provider_not_found(self, mock_builtin_tool_service):
        mock_builtin_tool_service.get_builtin_tool_provider_runtime_credentials.side_effect = ValueError(
            "not found"
        )

        with pytest.raises(ValueError, match="not found"):
            PluginParameterService.get_dynamic_select_options(
                tenant_id="t1",
                user_id="u1",
                plugin_id="p1",
                provider="google",
                action="search",
                parameter="engine",
                credential_id=None,
                provider_type="tool",
            )


class TestGetDynamicSelectOptionsTrigger:
    @patch("services.plugin.plugin_parameter_service.DynamicSelectClient")
    @patch("services.plugin.plugin_parameter_service.TriggerSubscriptionBuilderService")
    def test_uses_subscription_builder_when_credential_id(self, mock_builder_svc, mock_client_cls):
        sub = MagicMock()
        sub.credentials = {"token": "abc"}
        sub.credential_type = "api_key"
        mock_builder_svc.get_subscription_builder.return_value = sub
        mock_client_cls.return_value.fetch_dynamic_select_options.return_value.options = ["opt"]

        result = PluginParameterService.get_dynamic_select_options(
            tenant_id="t1",
            user_id="u1",
            plugin_id="p1",
            provider="github",
            action="on_push",
            parameter="branch",
            credential_id="builder-1",
            provider_type="trigger",
        )

        assert result == ["opt"]

    @patch("services.plugin.plugin_parameter_service.DynamicSelectClient")
    @patch("services.plugin.plugin_parameter_service.TriggerProviderService")
    @patch("services.plugin.plugin_parameter_service.TriggerSubscriptionBuilderService")
    def test_falls_back_to_trigger_service(self, mock_builder_svc, mock_provider_svc, mock_client_cls):
        mock_builder_svc.get_subscription_builder.return_value = None
        trigger_sub = MagicMock()
        api_entity = MagicMock()
        api_entity.credentials = {"token": "abc"}
        api_entity.credential_type = "api_key"
        trigger_sub.to_api_entity.return_value = api_entity
        mock_provider_svc.get_subscription_by_id.return_value = trigger_sub
        mock_client_cls.return_value.fetch_dynamic_select_options.return_value.options = ["opt"]

        result = PluginParameterService.get_dynamic_select_options(
            tenant_id="t1",
            user_id="u1",
            plugin_id="p1",
            provider="github",
            action="on_push",
            parameter="branch",
            credential_id="sub-1",
            provider_type="trigger",
        )

        assert result == ["opt"]

    @patch("services.plugin.plugin_parameter_service.TriggerProviderService")
    @patch("services.plugin.plugin_parameter_service.TriggerSubscriptionBuilderService")
    def test_raises_when_no_subscription_found(self, mock_builder_svc, mock_provider_svc):
        mock_builder_svc.get_subscription_builder.return_value = None
        mock_provider_svc.get_subscription_by_id.return_value = None

        with pytest.raises(ValueError, match="not found"):
            PluginParameterService.get_dynamic_select_options(
                tenant_id="t1",
                user_id="u1",
                plugin_id="p1",
                provider="github",
                action="on_push",
                parameter="branch",
                credential_id="nonexistent",
                provider_type="trigger",
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
            plugin_id="p1",
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

    @patch("services.plugin.plugin_parameter_service.TriggerProviderService")
    def test_raises_when_subscription_not_found(self, mock_provider_svc):
        mock_provider_svc.get_subscription_by_id.return_value = None

        with pytest.raises(ValueError, match="not found"):
            PluginParameterService.get_dynamic_select_options_with_credentials(
                tenant_id="t1",
                user_id="u1",
                plugin_id="p1",
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
        mock_builtin_tool_service.get_builtin_tool_provider_runtime_credentials.return_value = ({}, "unauthorized")
        mock_client_cls.return_value.fetch_dynamic_select_options.return_value.options = ["opt1"]

        result = PluginParameterService.get_dynamic_tree_select_options(
            tenant_id="t1",
            user_id="u1",
            plugin_id="p1",
            provider="google",
            action="search",
            parameter="engine",
            credential_id=None,
        )

        assert result == ["opt1"]
