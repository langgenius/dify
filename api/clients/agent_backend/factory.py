"""Factories for API-side Agent backend clients."""

from __future__ import annotations

from dify_agent.client import Client

from clients.agent_backend.client import AgentBackendRunClient, DifyAgentBackendRunClient
from clients.agent_backend.fake_client import FakeAgentBackendRunClient, FakeAgentBackendScenario


def create_agent_backend_client(
    *,
    base_url: str,
    api_token: str | None = None,
    stream_timeout: float = 30,
    timeout: float = 30.0,
    binding_file_download_timeout: float = 240,
) -> Client:
    api_token = api_token.strip() if api_token else None
    headers = {"Authorization": f"Bearer {api_token}"} if api_token else None
    return Client(
        base_url=base_url,
        stream_timeout=stream_timeout,
        timeout=timeout,
        binding_file_download_timeout=binding_file_download_timeout,
        headers=headers,
    )


def create_agent_backend_run_client(
    *,
    base_url: str | None = None,
    api_token: str | None = None,
    use_fake: bool = False,
    fake_scenario: str | FakeAgentBackendScenario = FakeAgentBackendScenario.SUCCESS,
    stream_read_timeout_seconds: float = 30,
    stream_max_reconnects: int = 3,
) -> AgentBackendRunClient:
    """Create the API-side run client without hiding the ``dify-agent`` protocol."""
    if use_fake:
        return FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario(fake_scenario))
    if base_url is None:
        raise ValueError("base_url is required when creating a real Agent backend client")
    return DifyAgentBackendRunClient(
        create_agent_backend_client(
            base_url=base_url,
            api_token=api_token,
            stream_timeout=stream_read_timeout_seconds,
        ),
        stream_max_reconnects=stream_max_reconnects,
    )
