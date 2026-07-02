"""Factories for API-side Agent backend clients."""

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
    # When neither AGENT_BACKEND_BASE_URL is set nor AGENT_BACKEND_USE_FAKE is enabled,
    # fall back to the deterministic in-process fake client instead of raising. This
    # keeps the Agent app generator usable out of the box for self-hosted deployments
    # that have not yet wired up a real Agent backend (issue #38283).
    if use_fake or base_url is None or not base_url.strip():
        return FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario(fake_scenario))
    return DifyAgentBackendRunClient(Client(base_url=base_url))
