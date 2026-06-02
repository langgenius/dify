"""Environment-variable helpers for the client-safe shell back proxy CLI."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import os

from dify_agent.protocol.back_proxy import (
    BACK_PROXY_AUTH_JWE_ENV_VAR,
    BACK_PROXY_URL_ENV_VAR,
    normalize_back_proxy_base_url,
)


class MissingBackProxyEnvironmentError(RuntimeError):
    """Raised when the shell back proxy CLI environment is incomplete."""


@dataclass(slots=True)
class BackProxyEnvironment:
    """Validated environment values needed for one CLI forwarding request."""

    base_url: str
    auth_jwe: str


def has_back_proxy_environment(env: Mapping[str, str] | None = None) -> bool:
    """Return whether both required shell back proxy environment variables exist."""
    values = env or os.environ
    return bool(values.get(BACK_PROXY_URL_ENV_VAR) and values.get(BACK_PROXY_AUTH_JWE_ENV_VAR))


def read_back_proxy_environment(env: Mapping[str, str] | None = None) -> BackProxyEnvironment:
    """Read and validate the shell back proxy environment variables."""
    values = env or os.environ
    base_url = (values.get(BACK_PROXY_URL_ENV_VAR) or "").strip()
    auth_jwe = (values.get(BACK_PROXY_AUTH_JWE_ENV_VAR) or "").strip()
    missing: list[str] = []
    if not base_url:
        missing.append(BACK_PROXY_URL_ENV_VAR)
    if not auth_jwe:
        missing.append(BACK_PROXY_AUTH_JWE_ENV_VAR)
    if missing:
        names = ", ".join(missing)
        raise MissingBackProxyEnvironmentError(f"missing required shell back proxy environment variables: {names}")
    try:
        normalized_base_url = normalize_back_proxy_base_url(base_url)
    except ValueError as exc:
        raise MissingBackProxyEnvironmentError(
            f"invalid {BACK_PROXY_URL_ENV_VAR}: {exc}"
        ) from exc
    return BackProxyEnvironment(base_url=normalized_base_url, auth_jwe=auth_jwe)


__all__ = ["BackProxyEnvironment", "MissingBackProxyEnvironmentError", "has_back_proxy_environment", "read_back_proxy_environment"]
