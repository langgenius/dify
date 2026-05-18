from __future__ import annotations

from clients.agent_backend.client import AgentBackendClient
from clients.agent_backend.mock_client import MockAgentBackendClient, MockAgentBackendScenario


def create_agent_backend_client(*, use_mock: bool = True, mock_scenario: str | None = None) -> AgentBackendClient:
    if use_mock:
        scenario = MockAgentBackendScenario(mock_scenario) if mock_scenario else MockAgentBackendScenario.SUCCESS_TEXT
        return MockAgentBackendClient(scenario=scenario)

    raise NotImplementedError("Real agent backend client is not implemented in phase 0")
