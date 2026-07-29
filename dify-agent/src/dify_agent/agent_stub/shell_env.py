"""Client-safe shell environment helpers for Agent Stub forwarding.

Only user-visible ``shell.run`` commands receive these variables. Internal
lifecycle commands remain free of Agent Stub credentials and drive-base
defaults so workspace setup and cleanup cannot accidentally inherit
user-facing forwarding state. The module stays server-extra-free because the
shell runtime and provider factory use it in sandbox-visible paths.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit

from dify_agent.agent_stub._constants import AGENT_STUB_DRIVE_BASE_ENV_VAR
from dify_agent.agent_stub.protocol.agent_stub import (
    AGENT_STUB_API_BASE_URL_ENV_VAR,
    AGENT_STUB_AUTH_JWE_ENV_VAR,
    agent_stub_drive_base_for_ref,
    normalize_agent_stub_api_base_url,
)
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from shellctl.shared.schemas import Credential, HTTPHeaderInject, InjectPolicy

# Placeholder pattern used to reference the JWE credential in env vars.
_JWE_CREDENTIAL_REF = "dify_agent_stub/auth_jwe"
_JWE_PLACEHOLDER = f"__secret:{_JWE_CREDENTIAL_REF}__"


class ShellAgentStubTokenFactory(Protocol):
    """Callable boundary for server-side Agent Stub token issuance."""

    def __call__(self, execution_context: DifyExecutionContextLayerConfig, *, session_id: str | None) -> str: ...


@dataclass(frozen=True, slots=True)
class ShellAgentStubEnvResult:
    """Result of building the agent stub shell environment.

    ``env`` holds the environment variables (with placeholder for JWE).
    ``credentials`` holds the structured credentials for the credential proxy.
    """

    env: dict[str, str]
    credentials: list[Credential]


def build_shell_agent_stub_env(
    *,
    agent_stub_api_base_url: str | None,
    agent_stub_drive_ref: str | None = None,
    execution_context: DifyExecutionContextLayerConfig | None,
    token_factory: ShellAgentStubTokenFactory | None,
    session_id: str | None,
    use_egressproxy: bool = False,
) -> dict[str, str] | None:
    """Build the shell-visible Agent Stub environment for one user command.

    ``agent_stub_drive_ref`` is the storage reference from the bound
    ``dify.drive`` layer. The sandbox-local base is fixed by the Agent Stub
    contract and derived here at shell-run injection time.

    When ``use_egressproxy`` is False (default), the returned dict contains the
    raw JWE token. When True, the JWE is replaced with a placeholder so the
    egress proxy can inject the real credential at request time.
    """
    if agent_stub_api_base_url is None or execution_context is None or token_factory is None:
        return None
    jwe = token_factory(execution_context, session_id=session_id)
    env: dict[str, str] = {
        AGENT_STUB_API_BASE_URL_ENV_VAR: normalize_agent_stub_api_base_url(agent_stub_api_base_url),
        AGENT_STUB_AUTH_JWE_ENV_VAR: _JWE_PLACEHOLDER if use_egressproxy else jwe,
        AGENT_STUB_DRIVE_BASE_ENV_VAR: agent_stub_drive_base_for_ref(agent_stub_drive_ref),
    }
    return env


def build_shell_agent_stub_credentials(
    *,
    agent_stub_api_base_url: str,
    execution_context: DifyExecutionContextLayerConfig,
    token_factory: ShellAgentStubTokenFactory,
    session_id: str | None,
) -> list[Credential]:
    """Build structured credentials for the JWE token with header injection.

    The returned credential instructs the sandbox credential proxy to inject
    an ``Authorization: Bearer <jwe>`` header on outbound HTTP requests
    matching the agent stub domain.
    """
    jwe = token_factory(execution_context, session_id=session_id)
    parsed = urlsplit(normalize_agent_stub_api_base_url(agent_stub_api_base_url))
    domain = parsed.hostname or ""

    return [
        Credential(
            provider="dify_agent_stub",
            name="auth_jwe",
            value=jwe,
            inject=InjectPolicy(
                type="http-header",
                http_header=HTTPHeaderInject(
                    name="Authorization",
                    prefix="Bearer ",
                    domains=[domain] if domain else [],
                ),
            ),
        ),
    ]


__all__ = [
    "AGENT_STUB_AUTH_JWE_ENV_VAR",
    "AGENT_STUB_DRIVE_BASE_ENV_VAR",
    "AGENT_STUB_API_BASE_URL_ENV_VAR",
    "ShellAgentStubEnvResult",
    "ShellAgentStubTokenFactory",
    "build_shell_agent_stub_credentials",
    "build_shell_agent_stub_env",
]
