"""Agent provider delegation has no database dependencies."""

from dataclasses import dataclass

import pytest

from core.plugin.impl.exc import PluginDaemonClientSideError
from services import agent_service


@dataclass
class Provider:
    plugin_id: str


class PluginClient:
    def __init__(self):
        self.provider = Provider("plugin")
        self.calls = []
        self.failure = None

    def fetch_agent_strategy_providers(self, tenant_id):
        self.calls.append((tenant_id, None))
        return [self.provider]

    def fetch_agent_strategy_provider(self, tenant_id, name):
        self.calls.append((tenant_id, name))
        if self.failure:
            raise self.failure
        return self.provider


def test_agent_provider_queries_preserve_scope_and_errors(monkeypatch):
    client = PluginClient()
    monkeypatch.setattr(agent_service, "PluginAgentClient", lambda: client)
    assert agent_service.AgentService.list_agent_providers("user", "tenant") == [client.provider]
    assert agent_service.AgentService.get_agent_provider("user", "tenant", "name") is client.provider
    client.failure = PluginDaemonClientSideError("Plugin not found")
    with pytest.raises(ValueError, match="Plugin not found"):
        agent_service.AgentService.get_agent_provider("user", "tenant", "missing")
    assert client.calls == [("tenant", None), ("tenant", "name"), ("tenant", "missing")]
