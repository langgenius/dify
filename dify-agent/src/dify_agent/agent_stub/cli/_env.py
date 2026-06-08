"""Environment-variable helpers for the client-safe Agent Stub CLI."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import os

from dify_agent.agent_stub.protocol.agent_stub import (
    AGENT_STUB_AUTH_JWE_ENV_VAR,
    AGENT_STUB_URL_ENV_VAR,
    normalize_agent_stub_url,
)


class MissingAgentStubEnvironmentError(RuntimeError):
    """Raised when the Agent Stub CLI environment is incomplete."""


@dataclass(slots=True)
class AgentStubEnvironment:
    """Validated environment values needed for one CLI forwarding request."""

    url: str
    auth_jwe: str


def has_agent_stub_environment(env: Mapping[str, str] | None = None) -> bool:
    """Return whether both required Agent Stub environment variables exist."""
    values = env or os.environ
    return bool(values.get(AGENT_STUB_URL_ENV_VAR) and values.get(AGENT_STUB_AUTH_JWE_ENV_VAR))


def read_agent_stub_environment(env: Mapping[str, str] | None = None) -> AgentStubEnvironment:
    """Read and validate the Agent Stub environment variables."""
    values = env or os.environ
    url = (values.get(AGENT_STUB_URL_ENV_VAR) or "").strip()
    auth_jwe = (values.get(AGENT_STUB_AUTH_JWE_ENV_VAR) or "").strip()
    missing: list[str] = []
    if not url:
        missing.append(AGENT_STUB_URL_ENV_VAR)
    if not auth_jwe:
        missing.append(AGENT_STUB_AUTH_JWE_ENV_VAR)
    if missing:
        names = ", ".join(missing)
        raise MissingAgentStubEnvironmentError(f"missing required Agent Stub environment variables: {names}")
    try:
        normalized_url = normalize_agent_stub_url(url)
    except ValueError as exc:
        raise MissingAgentStubEnvironmentError(f"invalid {AGENT_STUB_URL_ENV_VAR}: {exc}") from exc
    return AgentStubEnvironment(url=normalized_url, auth_jwe=auth_jwe)


__all__ = [
    "AgentStubEnvironment",
    "MissingAgentStubEnvironmentError",
    "has_agent_stub_environment",
    "read_agent_stub_environment",
]
