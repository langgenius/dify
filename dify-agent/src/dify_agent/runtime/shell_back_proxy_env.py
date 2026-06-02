"""Server-side environment injection helpers for shell back proxy forwarding.

Only user-visible ``shell.run`` commands receive these variables. Internal
lifecycle commands remain free of back proxy credentials so workspace setup and
cleanup cannot accidentally inherit user-facing forwarding state.
"""

from __future__ import annotations

from typing import Protocol

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol.back_proxy import (
    BACK_PROXY_AUTH_JWE_ENV_VAR,
    BACK_PROXY_URL_ENV_VAR,
    normalize_back_proxy_base_url,
)


class ShellBackProxyTokenFactory(Protocol):
    """Callable boundary for server-side shell back proxy token issuance."""

    def __call__(self, execution_context: DifyExecutionContextLayerConfig, *, session_id: str | None) -> str: ...


def build_shell_back_proxy_env(
    *,
    public_url: str | None,
    execution_context: DifyExecutionContextLayerConfig | None,
    token_factory: ShellBackProxyTokenFactory | None,
    session_id: str | None,
) -> dict[str, str] | None:
    """Build the shell-visible back proxy environment for one user command."""
    if public_url is None or execution_context is None or token_factory is None:
        return None
    return {
        BACK_PROXY_URL_ENV_VAR: normalize_back_proxy_base_url(public_url),
        BACK_PROXY_AUTH_JWE_ENV_VAR: token_factory(execution_context, session_id=session_id),
    }


__all__ = [
    "BACK_PROXY_AUTH_JWE_ENV_VAR",
    "BACK_PROXY_URL_ENV_VAR",
    "ShellBackProxyTokenFactory",
    "build_shell_back_proxy_env",
]
