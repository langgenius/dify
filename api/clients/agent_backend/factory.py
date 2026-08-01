"""Factories for API-side Agent backend clients."""

from __future__ import annotations

from dify_agent.client import Client

from clients.agent_backend.client import AgentBackendRunClient, DifyAgentBackendRunClient
from clients.agent_backend.fake_client import FakeAgentBackendRunClient, FakeAgentBackendScenario


def create_agent_backend_run_client(
    *,
    base_url: str | None = None,
    api_token: str | None = None,
    use_fake: bool = False,
    fake_scenario: str | FakeAgentBackendScenario = FakeAgentBackendScenario.SUCCESS,
    stream_read_timeout_seconds: float = 30,
    stream_max_reconnects: int = 3,
    stream_run_timeout_seconds: float = 1200,
) -> AgentBackendRunClient:
    """Create the API-side run client without hiding the ``dify-agent`` protocol."""
    if use_fake:
        return FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario(fake_scenario))
    if base_url is None:
        raise ValueError(
            "AGENT_BACKEND_BASE_URL is not configured. The Chatflow/Workflow Agent node "
            "requires a separately deployed Agent backend service. Set the "
            "AGENT_BACKEND_BASE_URL environment variable to the service's URL, "
            "or use the classic Agent-type app (mode: agent-chat) which runs "
            "in-process and does not require this service."
        )
    headers: dict[str, str] = {}
    if api_token:
        headers["Authorization"] = f"Bearer {api_token}"
    return DifyAgentBackendRunClient(
        Client(base_url=base_url, stream_timeout=stream_read_timeout_seconds, headers=headers),
        stream_max_reconnects=stream_max_reconnects,
        stream_timeout_seconds=stream_run_timeout_seconds,
    )
