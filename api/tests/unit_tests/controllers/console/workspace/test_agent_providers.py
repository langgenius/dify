from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.error import AccountNotFound
from controllers.console.workspace.agent_providers import (
    AgentProviderApi,
)


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def mock_decorators():
    """Mock decorators that require database access."""
    with (
        patch("controllers.console.wraps.db"),
        patch("controllers.console.wraps.dify_config.EDITION", "CLOUD"),
        patch("libs.login.dify_config.LOGIN_DISABLED", False),
        patch("libs.login.check_csrf_token") as mock_csrf,
        patch("libs.login._get_user") as mock_get_user,
    ):
        mock_csrf.return_value = None
        mock_get_user.return_value = MagicMock()
        yield


class TestAgentProviderApi:
    def test_get_success(self, app: Flask):
        api = AgentProviderApi()
        method = unwrap(api.get)

        user = MagicMock(id="user1")
        tenant_id = "tenant1"
        provider_name = "openai"
        provider_data = {"name": "openai", "models": ["gpt-4"]}

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.agent_providers.AgentService.get_agent_provider",
                return_value=provider_data,
            ),
        ):
            result = method(api, tenant_id, user, provider_name)

        assert result == provider_data

    def test_get_provider_not_found(self, app: Flask):
        api = AgentProviderApi()
        method = unwrap(api.get)

        user = MagicMock(id="user1")
        tenant_id = "tenant1"
        provider_name = "unknown"

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.agent_providers.AgentService.get_agent_provider",
                return_value=None,
            ),
        ):
            result = method(api, tenant_id, user, provider_name)

        assert result is None

    def test_get_account_not_found(self, app: Flask, mock_decorators):
        api = AgentProviderApi()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.wraps.current_account_with_tenant",
                side_effect=AccountNotFound(),
            ),
        ):
            with pytest.raises(AccountNotFound):
                api.get("openai")
