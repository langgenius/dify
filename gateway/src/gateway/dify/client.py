"""Async HTTP client for Dify Service API + Console API.

Thin wrapper around ``httpx.AsyncClient``; one instance per Dify deployment
(keyed by ``base_url``). Translates HTTP failures into gateway domain errors.

Service API (per-App, ``app-*`` token):
    * POST ``/v1/chat-messages`` (blocking + streaming)

Console API authentication (cookie + CSRF, not a bearer JWT):
    Dify's ``POST /console/api/login`` returns ``{"result":"success"}`` and
    sets three cookies: ``access_token``, ``refresh_token``, ``csrf_token``.
    Subsequent console requests must:

        * Send the ``access_token`` cookie (or the same value as a Bearer
          ``Authorization`` header — Dify's ``extract_access_token`` accepts
          either).
        * Send the ``csrf_token`` cookie **and** mirror it in the
          ``X-CSRF-Token`` header. Mismatched values trigger 401.

    See ``api/libs/token.py`` and ``api/controllers/console/auth/login.py``
    in the Dify source.

Console API endpoints used:
    * POST ``/console/api/login`` (returns cookies, body is just ``{result:"success"}``)
    * POST ``/console/api/apps/imports``
    * POST ``/console/api/apps/{app_id}/api-keys``
    * DELETE ``/console/api/apps/{app_id}``

These endpoints are not officially public; behavior is empirically stable in
v1.x but pinning a Dify version is recommended.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import httpx
import structlog

from gateway.errors import DifyTimeoutError, DifyUpstreamError

logger = structlog.get_logger(__name__)

# Stripe of body that gets logged on upstream errors. We avoid logging full
# bodies because they may contain user prompts or secrets.
_ERR_BODY_TRUNCATE = 500


@dataclass(frozen=True)
class ConsoleSession:
    """Session state needed to call Dify Console API endpoints.

    The values originate from cookies set by ``/console/api/login``. We also
    preserve the *cookie names* the server used (bare or ``__Host-``-prefixed)
    so subsequent requests can echo them verbatim. Dify's
    ``check_csrf_token`` resolves the cookie name through ``_real_cookie_name``,
    which switches to ``__Host-csrf_token`` on HTTPS deploys without a custom
    cookie domain; sending the wrong name causes the cookie/header mismatch
    check to fail with 401.

    ``csrf_token`` must additionally be echoed in the ``X-CSRF-Token`` header
    on every state-changing request (header name is *always* the same; only
    the cookie name varies).
    """

    access_token: str
    csrf_token: str
    access_token_cookie_name: str = "access_token"
    csrf_token_cookie_name: str = "csrf_token"


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

    @asynccontextmanager
    async def open_chat_stream(
        self,
        *,
        app_key: str,
        query: str,
        user: str,
        inputs: Mapping[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> AsyncIterator[AsyncIterator[str]]:
        """Open a streaming ``chat-messages`` request and yield a line iterator.

        Implemented as an async context manager so the caller can perform
        pre-flight error handling **before** any response bytes are sent
        downstream. The HTTP request is fully sent and response headers are
        received when entering the context; non-2xx responses raise
        :class:`DifyUpstreamError` here, *not* mid-iteration. Once the
        context yields, iteration produces SSE lines until exhaustion or
        timeout.

        Example::

            async with client.open_chat_stream(...) as lines:
                async for line in lines:
                    ...

        Raises (during context entry):
            DifyTimeoutError: connect/read timeout before headers received.
            DifyUpstreamError: non-2xx HTTP response.
        """
        body: dict[str, Any] = {
            "inputs": dict(inputs or {}),
            "query": query,
            "user": user,
            "response_mode": "streaming",
        }
        if conversation_id:
            body["conversation_id"] = conversation_id

        cm = self._http.stream(
            "POST",
            "/v1/chat-messages",
            headers=_bearer(app_key),
            json=body,
            timeout=httpx.Timeout(self._stream_timeout_s, read=self._stream_timeout_s),
        )
        try:
            resp = await cm.__aenter__()
        except httpx.TimeoutException as e:
            raise DifyTimeoutError("Dify streaming chat-messages timed out") from e
        except httpx.RequestError as e:
            raise DifyUpstreamError(f"Dify streaming request failed: {e}") from e

        # Status check happens *here*, before any caller has started writing
        # bytes downstream. _raise_for_dify_status accesses resp.text, which
        # for streaming responses requires resp.aread() first.
        if not resp.is_success:
            try:
                await resp.aread()
            except Exception:  # noqa: BLE001
                pass  # body unreadable; fall through to status-only error
            try:
                _raise_for_dify_status(resp)
            finally:
                await cm.__aexit__(None, None, None)

        async def iter_lines() -> AsyncIterator[str]:
            try:
                async for line in resp.aiter_lines():
                    yield line
            except httpx.TimeoutException as e:
                raise DifyTimeoutError("Dify streaming chat-messages timed out") from e
            except httpx.RequestError as e:
                raise DifyUpstreamError(f"Dify streaming read failed: {e}") from e

        try:
            yield iter_lines()
        finally:
            await cm.__aexit__(None, None, None)

    # ------------------------------------------------------------------ #
    # Console API (App management)                                       #
    # ------------------------------------------------------------------ #

    async def console_login(self, email: str, password: str) -> ConsoleSession:
        """Authenticate against the console and return cookie-derived tokens.

        Dify's ``/console/api/login`` returns ``{"result":"success"}`` and
        sets ``access_token`` + ``csrf_token`` cookies. We extract both from
        the response cookie jar (httpx parses ``Set-Cookie`` automatically).

        Raises:
            DifyUpstreamError: login failed or cookies missing.
        """
        try:
            resp = await self._http.post(
                "/console/api/login",
                json={"email": email, "password": password, "language": "en-US"},
            )
        except httpx.RequestError as e:
            raise DifyUpstreamError(f"Dify console login failed: {e}") from e
        _raise_for_dify_status(resp)

        # Dify uses two cookie naming variants: bare ("access_token") for
        # http/non-secure deployments, and ``__Host-`` prefixed for secure
        # deployments without a custom cookie domain. Read whichever was sent
        # AND remember the name so we can echo it on subsequent requests.
        access_token, access_name = _read_cookie_with_name(resp, "access_token")
        csrf_token, csrf_name = _read_cookie_with_name(resp, "csrf_token")

        if not access_token or not csrf_token:
            raise DifyUpstreamError(
                "Dify console login did not set expected cookies "
                "(access_token / csrf_token); response cookies: "
                f"{sorted(resp.cookies.keys())}"
            )
        return ConsoleSession(
            access_token=access_token,
            csrf_token=csrf_token,
            access_token_cookie_name=access_name,
            csrf_token_cookie_name=csrf_name,
        )

    async def console_import_app(self, session: ConsoleSession, yaml_content: str) -> str:
        """Create an App from a DSL YAML string. Returns the new ``app_id``."""
        try:
            resp = await self._http.post(
                "/console/api/apps/imports",
                headers=_console_headers(session),
                cookies=_console_cookies(session),
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

    async def console_create_app_api_key(self, session: ConsoleSession, app_id: str) -> str:
        """Generate a new ``app-*`` token bound to ``app_id``."""
        try:
            resp = await self._http.post(
                f"/console/api/apps/{app_id}/api-keys",
                headers=_console_headers(session),
                cookies=_console_cookies(session),
            )
        except httpx.RequestError as e:
            raise DifyUpstreamError(f"Dify app api-key creation failed: {e}") from e
        _raise_for_dify_status(resp)
        data = resp.json()
        token = data.get("token")
        if not token:
            raise DifyUpstreamError("Dify api-key response missing token")
        return str(token)

    async def console_delete_app(self, session: ConsoleSession, app_id: str) -> None:
        """Delete an App (used by the GC sweep)."""
        try:
            resp = await self._http.delete(
                f"/console/api/apps/{app_id}",
                headers=_console_headers(session),
                cookies=_console_cookies(session),
            )
        except httpx.RequestError as e:
            raise DifyUpstreamError(f"Dify app delete failed: {e}") from e
        # 404 is fine—App was already removed (idempotent GC).
        if resp.status_code == 404:
            return
        _raise_for_dify_status(resp)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _console_headers(session: ConsoleSession) -> dict[str, str]:
    """Headers for an authenticated console API request.

    Dify's ``extract_access_token`` accepts either cookie or ``Authorization``
    bearer; sending both is harmless. ``X-CSRF-Token`` must equal the value
    of the ``csrf_token`` cookie (verified by ``check_csrf_token``).
    """
    return {
        "Authorization": f"Bearer {session.access_token}",
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrf_token,
    }


def _console_cookies(session: ConsoleSession) -> dict[str, str]:
    """Cookie jar for console API requests; mirrors browser behavior.

    Uses the cookie names the server originally sent (bare or ``__Host-``
    prefixed) so that Dify's ``_real_cookie_name``-aware extractors find them.
    """
    return {
        session.access_token_cookie_name: session.access_token,
        session.csrf_token_cookie_name: session.csrf_token,
    }


def _read_cookie_with_name(
    resp: httpx.Response, base_name: str
) -> tuple[str | None, str]:
    """Return ``(value, actual_name_used)`` for ``base_name`` from response cookies.

    Falls back to the bare ``base_name`` for the returned name when the cookie
    is missing — this gives sensible defaults but the caller must check the
    value separately.
    """
    if base_name in resp.cookies:
        return resp.cookies[base_name], base_name
    host_prefixed = f"__Host-{base_name}"
    if host_prefixed in resp.cookies:
        return resp.cookies[host_prefixed], host_prefixed
    return None, base_name


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
