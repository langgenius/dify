"""Server-side environment injection helpers for Agent Stub forwarding.

Only user-visible ``shell.run`` commands receive these variables. Internal
lifecycle commands remain free of Agent Stub credentials and drive-base defaults
so workspace setup and cleanup cannot accidentally inherit user-facing forwarding
state.
"""

from __future__ import annotations

from typing import Protocol

from dify_agent.agent_stub.protocol.agent_stub import (
    AGENT_STUB_AUTH_JWE_ENV_VAR,
    AGENT_STUB_DRIVE_BASE_ENV_VAR,
    AGENT_STUB_API_BASE_URL_ENV_VAR,
    agent_stub_drive_base_for_ref,
    normalize_agent_stub_api_base_url,
)
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


class ShellAgentStubTokenFactory(Protocol):
    """Callable boundary for server-side Agent Stub token issuance."""

    def __call__(self, execution_context: DifyExecutionContextLayerConfig, *, session_id: str | None) -> str: ...


def build_shell_agent_stub_env(
    *,
    agent_stub_api_base_url: str | None,
    agent_stub_drive_ref: str | None = None,
    execution_context: DifyExecutionContextLayerConfig | None,
    token_factory: ShellAgentStubTokenFactory | None,
    session_id: str | None,
) -> dict[str, str] | None:
    """Build the shell-visible Agent Stub environment for one user command.

    ``agent_stub_drive_ref`` is the storage reference from the bound
    ``dify.drive`` layer. The sandbox-local base is fixed by the Agent Stub
    contract and derived here at shell-run injection time.
    """
    if agent_stub_api_base_url is None or execution_context is None or token_factory is None:
        return None
    return {
        AGENT_STUB_API_BASE_URL_ENV_VAR: normalize_agent_stub_api_base_url(agent_stub_api_base_url),
        AGENT_STUB_AUTH_JWE_ENV_VAR: token_factory(execution_context, session_id=session_id),
        AGENT_STUB_DRIVE_BASE_ENV_VAR: agent_stub_drive_base_for_ref(agent_stub_drive_ref),
    }


__all__ = [
    "AGENT_STUB_AUTH_JWE_ENV_VAR",
    "AGENT_STUB_DRIVE_BASE_ENV_VAR",
    "AGENT_STUB_API_BASE_URL_ENV_VAR",
    "ShellAgentStubTokenFactory",
    "build_shell_agent_stub_env",
]
