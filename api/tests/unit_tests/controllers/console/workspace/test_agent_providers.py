from unittest.mock import MagicMock, patch

import pytest

from controllers.console.error import AccountNotFound
from controllers.console.workspace.agent_providers import (
    AgentProviderApi,
    AgentProviderListApi,
)


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestAgentProviderListApi:
    def test_get_success(self, app):
        api = AgentProviderListApi()
        method = unwrap(api.get)

        user = MagicMock(id="user1")
        tenant_id = "tenant1"
        providers = [{"name": "openai"}, {"name": "anthropic"}]

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.agent_providers.current_account_with_tenant",
                return_value=(user, tenant_id),
            ),
            patch(
                "controllers.console.workspace.agent_providers.AgentService.list_agent_providers",
                return_value=providers,
            ),
        ):
            result = method(api)

        assert result == providers

    def test_get_empty_list(self, app):
        api = AgentProviderListApi()
        method = unwrap(api.get)

        user = MagicMock(id="user1")
        tenant_id = "tenant1"

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.agent_providers.current_account_with_tenant",
                return_value=(user, tenant_id),
            ),
            patch(
                "controllers.console.workspace.agent_providers.AgentService.list_agent_providers",
                return_value=[],
            ),
        ):
            result = method(api)

        assert result == []

    def test_get_account_not_found(self, app):
        api = AgentProviderListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.agent_providers.current_account_with_tenant",
                side_effect=AccountNotFound(),
            ),
        ):
            with pytest.raises(AccountNotFound):
                method(api)


class TestAgentProviderApi:
    def test_get_success(self, app):
        api = AgentProviderApi()
        method = unwrap(api.get)

        user = MagicMock(id="user1")
        tenant_id = "tenant1"
        provider_name = "openai"
        provider_data = {"name": "openai", "models": ["gpt-4"]}

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.agent_providers.current_account_with_tenant",
                return_value=(user, tenant_id),
            ),
            patch(
                "controllers.console.workspace.agent_providers.AgentService.get_agent_provider",
                return_value=provider_data,
            ),
        ):
            result = method(api, provider_name)

        assert result == provider_data

    def test_get_provider_not_found(self, app):
        api = AgentProviderApi()
        method = unwrap(api.get)

        user = MagicMock(id="user1")
        tenant_id = "tenant1"
        provider_name = "unknown"

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.agent_providers.current_account_with_tenant",
                return_value=(user, tenant_id),
            ),
            patch(
                "controllers.console.workspace.agent_providers.AgentService.get_agent_provider",
                return_value=None,
            ),
        ):
            result = method(api, provider_name)

        assert result is None

    def test_get_account_not_found(self, app):
        api = AgentProviderApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.agent_providers.current_account_with_tenant",
                side_effect=AccountNotFound(),
            ),
        ):
            with pytest.raises(AccountNotFound):
                method(api, "openai")
