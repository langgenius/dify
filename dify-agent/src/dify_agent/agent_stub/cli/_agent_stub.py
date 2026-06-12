"""CLI-facing wrapper around the client-safe Agent Stub transport facade."""

from __future__ import annotations

from dify_agent.agent_stub.cli._env import read_agent_stub_environment
from dify_agent.agent_stub.client._agent_stub import connect_agent_stub_sync
from dify_agent.agent_stub.protocol.agent_stub import AgentStubConnectResponse


def connect_from_environment(*, argv: list[str]) -> AgentStubConnectResponse:
    """Connect to the configured Agent Stub using the current environment."""
    environment = read_agent_stub_environment()
    return connect_agent_stub_sync(
        url=environment.url,
        auth_jwe=environment.auth_jwe,
        argv=argv,
    )


__all__ = ["connect_from_environment"]
