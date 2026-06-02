"""Client-safe HTTP helper for the shell back proxy connect endpoint.

The main ``Client`` class currently focuses on run APIs. The shell back proxy
CLI only needs a narrow synchronous ``POST /back-proxy/connections`` helper and
must stay safe to import in default installations, so the implementation lives
in this standalone module rather than importing FastAPI- or JWE-specific code.
"""

from __future__ import annotations

from typing import cast

import httpx
from pydantic import JsonValue, ValidationError

from dify_agent.protocol.back_proxy import BackProxyConnectRequest, BackProxyConnectResponse, back_proxy_connections_url


class BackProxyClientError(RuntimeError):
    """Base class for client-safe shell back proxy connection failures."""


class BackProxyHTTPError(BackProxyClientError):
    """Raised when the server returns a non-success HTTP response."""

    status_code: int
    detail: object

    def __init__(self, status_code: int, detail: object) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"shell back proxy HTTP {status_code}: {detail}")


class BackProxyValidationError(BackProxyClientError):
    """Raised when request or response DTO validation fails."""


def connect_back_proxy_sync(
    *,
    base_url: str,
    auth_jwe: str,
    argv: list[str],
    metadata: dict[str, JsonValue] | None = None,
    timeout: float | httpx.Timeout = 30.0,
    sync_http_client: httpx.Client | None = None,
) -> BackProxyConnectResponse:
    """Create one back proxy connection using the provided bearer JWE.

    Raises:
        BackProxyValidationError: if the base URL is invalid, the request DTO is
            invalid, or the success response body does not match the public back
            proxy response schema.
        BackProxyHTTPError: if the server returns a non-2xx HTTP response.
        BackProxyClientError: if the request times out, the transport fails, or
            the response body cannot be parsed as JSON.
    """
    request_model = _validate_request(argv=argv, metadata=metadata)
    try:
        connections_url = back_proxy_connections_url(base_url)
    except ValueError as exc:
        raise BackProxyValidationError("invalid back proxy base URL") from exc
    owns_client = sync_http_client is None
    client = sync_http_client or httpx.Client(timeout=timeout, follow_redirects=True)
    try:
        response = client.post(
            connections_url,
            content=request_model.model_dump_json(),
            headers={
                "Authorization": f"Bearer {auth_jwe}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )
    except httpx.TimeoutException as exc:
        raise BackProxyClientError("shell back proxy connect timed out") from exc
    except httpx.RequestError as exc:
        raise BackProxyClientError(f"shell back proxy connect request failed: {exc}") from exc
    finally:
        if owns_client:
            client.close()

    return _parse_response(response)


def _validate_request(*, argv: list[str], metadata: dict[str, JsonValue] | None) -> BackProxyConnectRequest:
    try:
        return BackProxyConnectRequest(argv=argv, metadata=cast(dict[str, JsonValue], metadata or {}))
    except ValidationError as exc:
        raise BackProxyValidationError("invalid back proxy connection request") from exc


def _parse_response(response: httpx.Response) -> BackProxyConnectResponse:
    try:
        payload = response.json()
    except ValueError as exc:
        raise BackProxyClientError("shell back proxy returned invalid JSON") from exc

    if response.is_error:
        detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
        raise BackProxyHTTPError(response.status_code, detail)

    try:
        return BackProxyConnectResponse.model_validate(payload)
    except ValidationError as exc:
        raise BackProxyValidationError("invalid back proxy connection response") from exc


__all__ = [
    "BackProxyClientError",
    "BackProxyHTTPError",
    "BackProxyValidationError",
    "connect_back_proxy_sync",
]
