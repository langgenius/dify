"""Factories for API-side Agent backend clients.

Only the run lifecycle surface keeps an API-side factory because it still wraps
the shared ``dify-agent`` run client for API-specific error normalization.
Sandbox services now construct ``dify_agent.client.Client`` directly where
needed, so no parallel sandbox factory remains here.
"""

from __future__ import annotations

from dify_agent.client import Client

from clients.agent_backend.client import AgentBackendRunClient, DifyAgentBackendRunClient
from clients.agent_backend.fake_client import FakeAgentBackendRunClient, FakeAgentBackendScenario


def create_agent_backend_run_client(
    *,
    base_url: str | None = None,
    use_fake: bool = False,
    fake_scenario: str | FakeAgentBackendScenario = FakeAgentBackendScenario.SUCCESS,
) -> AgentBackendRunClient:
    """Create the API-side run client without hiding the ``dify-agent`` protocol."""
    if use_fake:
        return FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario(fake_scenario))
    if base_url is None:
        raise ValueError("base_url is required when creating a real Agent backend client")
    return DifyAgentBackendRunClient(Client(base_url=base_url))
