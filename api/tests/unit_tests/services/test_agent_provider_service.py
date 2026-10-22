"""Workspace isolation and plugin-error compatibility for Agent provider reads."""

from unittest.mock import create_autospec, patch

import pytest

from core.plugin.entities.plugin_daemon import PluginAgentProviderEntity
from core.plugin.impl.agent import PluginAgentClient
from core.plugin.impl.exc import PluginNotFoundError
from machinery.context import RequestContext
from services.agent_provider_gateway import PluginAgentProviderGateway
from services.agent_provider_service import AgentProviderGateway, AgentProviderService, AgentProviderUnavailableError


@pytest.mark.parametrize("workspace", ["workspace-a", "workspace-b"])
@pytest.mark.parametrize("detail", [False, True])
def test_plugin_discovery_preserves_declarations_and_normalizes_provider_ids(workspace: str, detail: bool) -> None:
    provider = PluginAgentProviderEntity.model_validate(
        {
            "provider": "agent",
            "plugin_id": "langgenius/agent",
            "plugin_unique_identifier": "langgenius/agent:0.0.2@checksum",
            "meta": {},
            "declaration": {
                "identity": {
                    "author": "langgenius",
                    "name": "agent",
                    "label": {"en_US": "Agent"},
                    "description": {"en_US": "Agent strategies"},
                    "icon": "icon.svg",
                },
                "strategies": [
                    {
                        "identity": {
                            "author": "langgenius",
                            "name": "reasoning",
                            "provider": "agent",
                            "label": {"en_US": "Reasoning"},
                        },
                        "description": {"en_US": "Reason with tools"},
                        "parameters": [],
                    }
                ],
            },
        }
    )
    service = AgentProviderService(providers=PluginAgentProviderGateway())
    context = RequestContext("request", None, "account", workspace)
    with patch.object(
        PluginAgentClient, "_request_with_plugin_daemon_response", return_value=provider if detail else [provider]
    ) as request:
        if detail:
            result = service.get_provider(context, "langgenius/agent/agent")
            assert request.call_args.args[1] == f"plugin/{workspace}/management/agent_strategy"
            assert request.call_args.kwargs["params"] == {"provider": "agent", "plugin_id": "langgenius/agent"}
        else:
            [result] = service.list_providers(context)
            assert request.call_args.args[1] == f"plugin/{workspace}/management/agent_strategies"
            assert request.call_args.kwargs["params"] == {"page": 1, "page_size": 256}
    assert result is provider
    assert result.declaration.identity.name == "langgenius/agent/agent"
    assert result.declaration.strategies[0].identity.provider == "langgenius/agent/agent"
    assert result.declaration.strategies[0].identity.name == "reasoning"
    assert result.declaration.identity.icon == "icon.svg"


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
