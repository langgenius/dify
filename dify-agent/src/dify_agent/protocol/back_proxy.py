"""Client-safe DTOs and constants for the shell back proxy protocol.

The shell back proxy contract is shared by the FastAPI server, the client-safe
CLI forwarding code, and tests. This module intentionally carries only wire
shapes plus environment-variable names. Token issuance, key derivation, and JWE
validation stay under ``dify_agent.server.tokens.back_proxy`` so default package
imports remain free of server-only crypto dependencies.
"""

from __future__ import annotations

from typing import ClassVar, Final, Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, JsonValue, Field


BACK_PROXY_PROTOCOL_VERSION: Final[int] = 1
BACK_PROXY_URL_ENV_VAR: Final[str] = "DIFY_AGENT_BACK_PROXY_URL"
BACK_PROXY_AUTH_JWE_ENV_VAR: Final[str] = "DIFY_AGENT_BACK_PROXY_AUTH_JWE"


def normalize_back_proxy_base_url(base_url: str) -> str:
    """Return a validated back proxy base URL without a trailing slash.

    Callers rely on this helper as the shared validation boundary for settings,
    CLI env parsing, and client URL composition. The value must therefore be a
    real HTTP(S) URL with a host/netloc, must not include a query string or
    fragment, and is normalized only by trimming whitespace and removing a final
    trailing slash from the path.
    """
    stripped = base_url.strip()
    if not stripped:
        raise ValueError("back proxy base URL must not be empty")
    parsed = urlsplit(stripped)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("back proxy base URL must use http or https")
    if not parsed.netloc:
        raise ValueError("back proxy base URL must include a host")
    if parsed.query or parsed.fragment:
        raise ValueError("back proxy base URL must not include a query string or fragment")
    normalized_path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme, parsed.netloc, normalized_path, "", ""))


def back_proxy_connections_url(base_url: str) -> str:
    """Return the stable ``/connections`` endpoint URL for one base URL."""
    return f"{normalize_back_proxy_base_url(base_url)}/connections"


class BackProxyConnectRequest(BaseModel):
    """Request body for establishing one shell back proxy connection."""

    protocol_version: Literal[1] = BACK_PROXY_PROTOCOL_VERSION
    argv: list[str]
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BackProxyConnectResponse(BaseModel):
    """Connection placeholder response returned by the server."""

    connection_id: str
    status: Literal["connected"] = "connected"

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "BACK_PROXY_AUTH_JWE_ENV_VAR",
    "BACK_PROXY_PROTOCOL_VERSION",
    "BACK_PROXY_URL_ENV_VAR",
    "BackProxyConnectRequest",
    "BackProxyConnectResponse",
    "back_proxy_connections_url",
    "normalize_back_proxy_base_url",
]
