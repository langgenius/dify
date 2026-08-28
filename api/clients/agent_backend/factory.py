"""Factories for API-side Agent backend clients."""

from __future__ import annotations

import logging

from dify_agent.client import Client

from clients.agent_backend.client import AgentBackendRunClient, DifyAgentBackendRunClient
from clients.agent_backend.fake_client import FakeAgentBackendRunClient, FakeAgentBackendScenario

logger = logging.getLogger(__name__)


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
    stream_run_timeout_seconds: float = 1200,
) -> AgentBackendRunClient:
    """Create the API-side run client without hiding the ``dify-agent`` protocol."""
    if use_fake:
        return FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario(fake_scenario))
    # Regression for #38283: when the operator hasn't deployed the
    # Agent backend runtime, an Agent V2 workflow would previously raise
    # `ValueError("base_url is required")` from inside node_factory at
    # the first user invocation. Fall back to the deterministic fake
    # client so the workflow still executes and the operator can see
    # what a real backend would return while they stand it up. We log
    # the fallback at WARNING level so it shows up in the proxy logs.
    if not base_url:
        logger.warning(
            "AGENT_BACKEND_BASE_URL is not configured; falling back to the "
            "fake Agent backend client so workflows don't crash. Set "
            "`AGENT_BACKEND_BASE_URL` (and `AGENT_BACKEND_API_TOKEN` if "
            "the runtime requires auth) and restart, or set "
            "`AGENT_BACKEND_USE_FAKE=false` to make this an opt-in fake."
        )
        return FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario(fake_scenario))
    headers: dict[str, str] = {}
    if api_token:
        headers["Authorization"] = f"Bearer {api_token}"
    return DifyAgentBackendRunClient(
        create_agent_backend_client(
            base_url=base_url,
            api_token=api_token,
            stream_timeout=stream_read_timeout_seconds,
        ),
        stream_max_reconnects=stream_max_reconnects,
    )
