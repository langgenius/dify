"""Final HTTPX send owner for the strict Agent API.

The scheduler supplies identity read from the durable Run store. Application
payloads, effect sessions and client creation time never select a Run. The
legacy composition remains explicitly ordinary-only until credential withdrawal
and the separate Stub/runless owners are qualified.
"""

from __future__ import annotations

import base64
import json
import re
from collections.abc import Awaitable, Callable, Generator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import override

import httpx

from dify_agent.protocol.native_testing import (
    MAX_AGENT_CONTROL_BYTES,
    AgentRuntimeIdentity,
    AgentRunTransportSelection,
)


class AgentRuntimeTransportError(RuntimeError):
    """Local policy refusal, never an HTTP retry or ordinary-mode fallback."""


@dataclass
class _Lifetime:
    identity: AgentRuntimeIdentity
    active: bool = True
    validate_send: Callable[[], Awaitable[None]] | None = None


_binding: ContextVar[_Lifetime | None] = ContextVar("agent_run_transport_binding", default=None)


@contextmanager
def bind_runtime_identity(
    identity: AgentRuntimeIdentity, *, validate_send: Callable[[], Awaitable[None]] | None = None
) -> Generator[None, None, None]:
    """Scheduler-only scope; revoke inherited detached tasks on every exit."""
    if _binding.get() is not None:
        raise AgentRuntimeTransportError("agent_runtime_binding_nested")
    # Parse a detached immutable copy; never retain a caller-owned model object.
    lifetime = _Lifetime(AgentRuntimeIdentity.model_validate_json(identity.model_dump_json()))
    lifetime.validate_send = validate_send
    token = _binding.set(lifetime)
    try:
        yield
    finally:
        lifetime.active = False
        _binding.reset(token)


def current_runtime_identity() -> AgentRuntimeIdentity:
    lifetime = _binding.get()
    if lifetime is None or not lifetime.active:
        raise AgentRuntimeTransportError("agent_runtime_binding_missing")
    return lifetime.identity


def refuse_native_daemon_dispatch() -> None:
    """Legacy-only daemon authority cannot be used by any bound native Run."""
    lifetime = _binding.get()
    if lifetime is not None and (not lifetime.active or lifetime.identity.execution_mode != "ordinary"):
        raise AgentRuntimeTransportError("native_direct_daemon_unsupported")


def agent_api_endpoint(
    client: httpx.AsyncClient, *, base_url: str, legacy_path: str, runtime_path: str, api_key: str
) -> tuple[str, dict[str, str]]:
    """Choose an explicit composition, never retry strict failure with a key."""
    if isinstance(client, AgentRuntimeHTTPClient):
        return f"{base_url.rstrip('/')}/inner/api/agent/runtime/{runtime_path}", {}
    refuse_native_daemon_dispatch()
    if not api_key:
        raise AgentRuntimeTransportError("legacy_agent_credential_missing")
    return f"{base_url.rstrip('/')}/inner/api/{legacy_path}", {"X-Inner-Api-Key": api_key}


_POST_ROUTES = frozenset(
    {
        "llm/invoke",
        "tools/invoke",
        "knowledge/retrieve",
        "files/upload-request",
        "files/download-request",
        "native-testing/prepare-run",
        "native-testing/prepared-config",
        "native-testing/before-call",
        "native-testing/outcome",
        "native-testing/materialize",
        "native-testing/claim-dispatch",
        "native-testing/prepare-intent",
        "native-testing/results",
        "native-testing/read-result",
    }
)
_FORBIDDEN_HEADERS = frozenset(
    {
        b"authorization",
        b"proxy-authorization",
        b"x-inner-api-key",
        b"x-api-key",
        b"x-dify-agent-run",
    }
)
_PREFIX = "/inner/api/agent/runtime/"


def _allowed_route(request: httpx.Request) -> bool:
    if request.url.fragment or b"%" in request.url.raw_path.split(b"?", 1)[0]:
        return False
    path = request.url.path
    if request.method == "POST" and path.startswith(_PREFIX) and path[len(_PREFIX) :] in _POST_ROUTES:
        return not request.url.query
    match = re.fullmatch(
        _PREFIX
        + r"config/[A-Za-z0-9_-]{1,128}/(manifest|download-request|skills/[A-Za-z0-9_-]{1,128}/inspect|push|env|note)",
        path,
    )
    if match is None:
        return False
    operation = match.group(1)
    method = (
        "GET"
        if operation == "manifest" or operation.startswith("skills/")
        else {"download-request": "POST", "push": "POST", "env": "PATCH", "note": "PUT"}[operation]
    )
    if request.method != method:
        return False
    if method != "GET":
        return not request.url.query
    # Identifiers are canonical bounded segments; no encoded aliases or duplicate authority.
    query = request.url.query.decode("ascii")
    if len(query) > 1024 or not re.fullmatch(r"[A-Za-z0-9_=&-]+", query):
        return False
    pairs = list(request.url.params.multi_items())
    values = dict(pairs)
    return (
        len(pairs) == len(values)
        and set(values)
        in (
            {"tenant_id", "config_version_id", "config_version_kind"},
            {"tenant_id", "config_version_id", "config_version_kind", "user_id"},
        )
        and all(re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value) for value in values.values())
        and values["config_version_kind"] in {"draft", "snapshot", "build_draft"}
    )


class _RunBoundAPITransport(httpx.AsyncBaseTransport):
    def __init__(self, *, api_url: str, api_token: str | None, transport: httpx.AsyncBaseTransport) -> None:
        self._origin = httpx.URL(api_url)
        if (
            (api_token is not None and (not api_token or api_token.strip() != api_token or re.search(r"\s", api_token)))
            or self._origin.scheme not in {"http", "https"}
            or not self._origin.host
            or self._origin.userinfo
            or self._origin.path not in {"", "/"}
            or self._origin.query
            or self._origin.fragment
        ):
            raise AgentRuntimeTransportError("agent_runtime_configuration_invalid")
        self._token = api_token
        self._transport = transport

    @override
    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        identity = current_runtime_identity()
        if not self._token:
            raise AgentRuntimeTransportError("agent_runtime_bearer_unconfigured")
        url = request.url
        if (
            (url.scheme, url.host, url.port) != (self._origin.scheme, self._origin.host, self._origin.port)
            or url.userinfo
            or not _allowed_route(request)
            or any(name.lower() in _FORBIDDEN_HEADERS for name, _ in request.headers.raw)
            or request.headers.get("host") != self._origin.netloc.decode("ascii")
        ):
            raise AgentRuntimeTransportError("agent_runtime_destination_or_headers_invalid")
        body = await request.aread()
        if body:
            try:
                value = json.loads(body)
                if not isinstance(value, dict):
                    raise ValueError
                caller = value.get("caller", {})
                if not isinstance(caller, dict):
                    raise ValueError
                for claimed in (caller.get("agent_run_id"), value.get("agent_run_id")):
                    if claimed is not None and claimed != identity.run_id:
                        raise ValueError
            except (ValueError, UnicodeError):
                raise AgentRuntimeTransportError("agent_runtime_body_identity_invalid") from None
        selection = AgentRunTransportSelection(
            agent_run_id=identity.run_id,
            parent_node=identity.parent_node,
            request_digest=identity.request_digest,
            agent_generation=identity.agent_generation,
        )
        raw = json.dumps(
            selection.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
        if len(raw) > MAX_AGENT_CONTROL_BYTES:
            raise AgentRuntimeTransportError("agent_runtime_selection_too_large")
        headers = request.headers.copy()
        headers["Authorization"] = f"Bearer {self._token}"
        headers["X-Dify-Agent-Run"] = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
        # Do not contaminate the original prebuilt request when it is reused.
        outbound = httpx.Request(request.method, url, headers=headers, content=body, extensions=request.extensions)
        current_runtime_identity()  # Recheck after any awaited request-body read.
        lifetime = _binding.get()
        if lifetime is not None and lifetime.validate_send is not None:
            await lifetime.validate_send()
            current_runtime_identity()  # Revoke detached calls during the awaited durable read too.
        response = await self._transport.handle_async_request(outbound)
        if 300 <= response.status_code < 400:
            await response.aclose()
            raise AgentRuntimeTransportError("agent_runtime_redirect_refused")
        return response

    @override
    async def aclose(self) -> None:
        await self._transport.aclose()


class AgentRuntimeHTTPClient(httpx.AsyncClient):
    """Shared client whose final transport binds request/stream/prebuilt sends.

    No auth/default-header hooks or environment proxy authority are installed.
    Redirects are also rejected by the final owner, including explicit per-call
    follow_redirects=True and a later mutation of client.follow_redirects.
    """

    def __init__(
        self,
        *,
        api_url: str,
        api_token: str | None,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: httpx.Timeout | float = 5.0,
        limits: httpx.Limits = httpx.Limits(),
    ) -> None:
        super().__init__(
            transport=_RunBoundAPITransport(
                api_url=api_url,
                api_token=api_token,
                transport=transport
                if transport is not None
                else httpx.AsyncHTTPTransport(limits=limits, trust_env=False),
            ),
            timeout=timeout,
            limits=limits,
            trust_env=False,
            follow_redirects=False,
        )


class LegacyPluginDaemonTransport(httpx.AsyncBaseTransport):
    """Defense for the explicitly unqualified legacy daemon composition."""

    def __init__(self, transport: httpx.AsyncBaseTransport) -> None:
        self._transport = transport

    @override
    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        refuse_native_daemon_dispatch()
        return await self._transport.handle_async_request(request)

    @override
    async def aclose(self) -> None:
        await self._transport.aclose()
