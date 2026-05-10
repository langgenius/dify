"""Async HTTP client for Dify Service API + Console API.

Thin wrapper around ``httpx.AsyncClient``; one instance per Dify deployment
(keyed by ``base_url``). Translates HTTP failures into gateway domain errors.

Service API (per-App, ``app-*`` token):
    * POST ``/v1/chat-messages`` (blocking + streaming)

Console API (per-workspace JWT):
    * POST ``/console/api/login``
    * POST ``/console/api/apps/imports`` (DSL-based App creation)
    * POST ``/console/api/apps/{app_id}/api-keys``
    * DELETE ``/console/api/apps/{app_id}``

The Console API endpoints are not officially public; behavior is empirically
stable in v1.x but pinning a Dify version is recommended.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from typing import Any

import httpx
import structlog

from gateway.errors import DifyTimeoutError, DifyUpstreamError

logger = structlog.get_logger(__name__)

# Stripe of body that gets logged on upstream errors. We avoid logging full
# bodies because they may contain user prompts or secrets.
_ERR_BODY_TRUNCATE = 500


class DifyClient:
    """Async client bound to a single Dify deployment.

    Use as an async context manager (``async with DifyClient(...) as c``) for
    deterministic shutdown; alternatively call :meth:`aclose` explicitly.
    """

    def __init__(
        self,
        base_url: str,
        *,
        timeout_s: float = 60.0,
        stream_timeout_s: float = 300.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s
        self._stream_timeout_s = stream_timeout_s
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=httpx.Timeout(timeout_s, read=timeout_s),
            follow_redirects=False,
        )

    @property
    def base_url(self) -> str:
        return self._base_url

    async def __aenter__(self) -> "DifyClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()

    # ------------------------------------------------------------------ #
    # Service API                                                        #
    # ------------------------------------------------------------------ #

    async def chat_messages_blocking(
        self,
        *,
        app_key: str,
        query: str,
        user: str,
        inputs: Mapping[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        """Call ``POST /v1/chat-messages`` in blocking mode.

        Returns the parsed JSON body (Dify ``chat_message`` event payload).

        Raises:
            DifyTimeoutError: timeout while waiting for Dify.
            DifyUpstreamError: Dify returned non-2xx.
        """
        body: dict[str, Any] = {
            "inputs": dict(inputs or {}),
            "query": query,
            "user": user,
            "response_mode": "blocking",
        }
        if conversation_id:
            body["conversation_id"] = conversation_id

        try:
            resp = await self._http.post(
                "/v1/chat-messages",
                headers=_bearer(app_key),
                json=body,
            )
        except httpx.TimeoutException as e:
            raise DifyTimeoutError("Dify chat-messages timed out") from e
        except httpx.RequestError as e:
            raise DifyUpstreamError(f"Dify request failed: {e}") from e

        _raise_for_dify_status(resp)
        return resp.json()

    async def chat_messages_streaming(
        self,
        *,
        app_key: str,
        query: str,
        user: str,
        inputs: Mapping[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> AsyncIterator[str]:
        """Call ``POST /v1/chat-messages`` in streaming mode.

        Yields raw SSE *lines* (including ``data: {...}`` and blank separators).
        Caller is responsible for SSE framing/parsing—see
        :mod:`gateway.streaming.converter`.

        The connection is held open for ``stream_timeout_s``; exceeding that
        raises :class:`DifyTimeoutError`.
        """
        body: dict[str, Any] = {
            "inputs": dict(inputs or {}),
            "query": query,
            "user": user,
            "response_mode": "streaming",
        }
        if conversation_id:
            body["conversation_id"] = conversation_id

        try:
            async with self._http.stream(
                "POST",
                "/v1/chat-messages",
                headers=_bearer(app_key),
                json=body,
                timeout=httpx.Timeout(self._stream_timeout_s, read=self._stream_timeout_s),
            ) as resp:
                _raise_for_dify_status(resp)
                async for line in resp.aiter_lines():
                    yield line
        except httpx.TimeoutException as e:
            raise DifyTimeoutError("Dify streaming chat-messages timed out") from e
        except httpx.RequestError as e:
            raise DifyUpstreamError(f"Dify streaming request failed: {e}") from e

    # ------------------------------------------------------------------ #
    # Console API (App management)                                       #
    # ------------------------------------------------------------------ #

    async def console_login(self, email: str, password: str) -> str:
        """Exchange admin credentials for a JWT.

        The JWT is short-lived (Dify default ~30 min). App manager should
        refresh on 401 from subsequent calls.
        """
        try:
            resp = await self._http.post(
                "/console/api/login",
                json={"email": email, "password": password, "language": "en-US"},
            )
        except httpx.RequestError as e:
            raise DifyUpstreamError(f"Dify console login failed: {e}") from e
        _raise_for_dify_status(resp)
        data = resp.json()
        try:
            return str(data["data"]["access_token"])
        except (KeyError, TypeError) as e:
            raise DifyUpstreamError("Dify console login returned unexpected payload") from e

    async def console_import_app(self, jwt: str, yaml_content: str) -> str:
        """Create an App from a DSL YAML string. Returns the new ``app_id``."""
        try:
            resp = await self._http.post(
                "/console/api/apps/imports",
                headers=_bearer(jwt),
                json={"mode": "yaml-content", "yaml_content": yaml_content},
            )
        except httpx.RequestError as e:
            raise DifyUpstreamError(f"Dify app import failed: {e}") from e
        _raise_for_dify_status(resp)
        data = resp.json()
        # Dify returns either {app_id: ...} or {id: ...} depending on version;
        # we accept both to stay resilient across minor upgrades.
        app_id = data.get("app_id") or data.get("id")
        if not app_id:
            raise DifyUpstreamError("Dify app import response missing app_id")
        return str(app_id)

    async def console_create_app_api_key(self, jwt: str, app_id: str) -> str:
        """Generate a new ``app-*`` token bound to ``app_id``."""
        try:
            resp = await self._http.post(
                f"/console/api/apps/{app_id}/api-keys",
                headers=_bearer(jwt),
            )
        except httpx.RequestError as e:
            raise DifyUpstreamError(f"Dify app api-key creation failed: {e}") from e
        _raise_for_dify_status(resp)
        data = resp.json()
        token = data.get("token")
        if not token:
            raise DifyUpstreamError("Dify api-key response missing token")
        return str(token)

    async def console_delete_app(self, jwt: str, app_id: str) -> None:
        """Delete an App (used by the GC sweep)."""
        try:
            resp = await self._http.delete(
                f"/console/api/apps/{app_id}",
                headers=_bearer(jwt),
            )
        except httpx.RequestError as e:
            raise DifyUpstreamError(f"Dify app delete failed: {e}") from e
        # 404 is fine—App was already removed (idempotent GC).
        if resp.status_code == 404:
            return
        _raise_for_dify_status(resp)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _raise_for_dify_status(resp: httpx.Response) -> None:
    """Translate non-2xx HTTP responses into gateway domain errors."""
    if resp.is_success:
        return

    body_preview: str = ""
    try:
        body_preview = resp.text[:_ERR_BODY_TRUNCATE]
    except Exception:  # noqa: BLE001
        # ``resp.text`` may raise on streaming responses; fall through.
        body_preview = "<body unreadable>"

    logger.warning(
        "dify.upstream_error",
        status=resp.status_code,
        method=resp.request.method,
        url=str(resp.request.url),
        body=body_preview,
    )

    raise DifyUpstreamError(
        f"Dify returned HTTP {resp.status_code}: {body_preview}",
    )
