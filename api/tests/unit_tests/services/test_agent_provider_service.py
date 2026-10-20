"""Workspace isolation and plugin-error compatibility for Agent provider reads."""

from unittest.mock import create_autospec, patch

import pytest

from core.plugin.impl.exc import PluginNotFoundError
from machinery.context import RequestContext
from services.agent_provider_gateway import PluginAgentProviderGateway
from services.agent_provider_service import AgentProviderGateway, AgentProviderService, AgentProviderUnavailableError


@pytest.mark.parametrize("workspace", ["workspace-a", "workspace-b"])
def test_provider_queries_use_the_admitted_workspace(workspace: str) -> None:
    gateway = create_autospec(AgentProviderGateway, instance=True)
    service = AgentProviderService(providers=gateway)
    context = RequestContext("request", None, "account", workspace)
    gateway.list_providers.return_value = list[object]()
    assert service.list_providers(context) == []
    gateway.list_providers.assert_called_once_with(workspace)
    assert service.get_provider(context, "org/plugin/strategy") is gateway.get_provider.return_value
    gateway.get_provider.assert_called_once_with(workspace, "org/plugin/strategy")


def test_gateway_preserves_provider_lookup_error_message() -> None:
    gateway = PluginAgentProviderGateway()
    with patch("services.agent_provider_gateway.PluginAgentClient") as client:
        client.return_value.fetch_agent_strategy_provider.side_effect = PluginNotFoundError("not installed")
        with pytest.raises(AgentProviderUnavailableError, match="not installed"):
            gateway.get_provider("workspace", "org/plugin/strategy")
        client.return_value.fetch_agent_strategy_provider.assert_called_once_with("workspace", "org/plugin/strategy")


def test_gateway_does_not_translate_unexpected_failures() -> None:
    gateway = PluginAgentProviderGateway()
    with patch("services.agent_provider_gateway.PluginAgentClient") as client:
        client.return_value.fetch_agent_strategy_providers.side_effect = RuntimeError("unavailable")
        with pytest.raises(RuntimeError, match="unavailable"):
            gateway.list_providers("workspace")
