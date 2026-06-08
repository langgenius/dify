"""CLI-facing wrapper around the client-safe shell back proxy HTTP helper."""

from __future__ import annotations

from dify_agent.agent_stub.cli._env import read_back_proxy_environment
from dify_agent.agent_stub.client._back_proxy import connect_back_proxy_sync
from dify_agent.agent_stub.protocol.back_proxy import BackProxyConnectResponse


def connect_from_environment(*, argv: list[str]) -> BackProxyConnectResponse:
    """Connect to the configured shell back proxy using the current environment."""
    environment = read_back_proxy_environment()
    return connect_back_proxy_sync(
        base_url=environment.base_url,
        auth_jwe=environment.auth_jwe,
        argv=argv,
    )


__all__ = ["connect_from_environment"]
