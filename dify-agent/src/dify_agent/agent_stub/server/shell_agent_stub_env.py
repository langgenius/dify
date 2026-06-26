"""Server-side environment injection helpers for Agent Stub forwarding.

Only user-visible ``shell.run`` commands receive these variables. Internal
lifecycle commands remain free of Agent Stub credentials so workspace setup and
cleanup cannot accidentally inherit user-facing forwarding state.
"""

from __future__ import annotations

from typing import Protocol

from dify_agent.agent_stub.protocol.agent_stub import (
    AGENT_STUB_AUTH_JWE_ENV_VAR,
    AGENT_STUB_URL_ENV_VAR,
    normalize_agent_stub_url,
)
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


class ShellAgentStubTokenFactory(Protocol):
    """Callable boundary for server-side Agent Stub token issuance."""

    def __call__(self, execution_context: DifyExecutionContextLayerConfig, *, session_id: str | None) -> str: ...


def build_shell_agent_stub_env(
    *,
    agent_stub_url: str | None,
    execution_context: DifyExecutionContextLayerConfig | None,
    token_factory: ShellAgentStubTokenFactory | None,
    session_id: str | None,
) -> dict[str, str] | None:
    """Build the shell-visible Agent Stub environment for one user command."""
    if agent_stub_url is None or execution_context is None or token_factory is None:
        return None
    return {
        AGENT_STUB_URL_ENV_VAR: normalize_agent_stub_url(agent_stub_url),
        AGENT_STUB_AUTH_JWE_ENV_VAR: token_factory(execution_context, session_id=session_id),
    }


__all__ = [
    "AGENT_STUB_AUTH_JWE_ENV_VAR",
    "AGENT_STUB_URL_ENV_VAR",
    "ShellAgentStubTokenFactory",
    "build_shell_agent_stub_env",
]
