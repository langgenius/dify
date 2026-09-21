"""Process-wide reuse of MCP client connections.

Every `MCPTool` invocation used to open an MCP connection and close it as soon
as the call returned, which discards any per-session state a stateful MCP
server keeps (for example the browser context of the Playwright MCP server:
`browser_navigate` succeeds, the next call lands on a fresh `about:blank`
page). This module keeps successfully initialized clients in a process-wide
pool so consecutive calls reuse the same session.

The pool key is the execution scope — tenant, end user, provider config —
plus the server URL and timeouts: stable identities, never the per-call
credentials. Credentials change between calls (a freshly minted
forwarded-identity token, or an OAuth token after a refresh); keying on them
would prevent all reuse, while the session they authenticated at
`initialize()` keeps working and the pooled client refreshes its own token on
401. Distinct tenants, end users and provider configs therefore map to
distinct connections, so a stateful server never shares session state across
them.

Locking is two-level and strictly ordered: the registry lock only guards the
`_clients` dict, and per-entry locks serialize calls on one connection.
Entries are never closed while holding the registry lock — an in-flight call
holds the entry lock for as long as the server takes to answer (the session
has no read timeout), so eviction removes the entry under the registry lock
and closes it afterwards; a busy entry is marked doomed and closed by its
in-flight call on the way out.
"""

import atexit
import hashlib
import json
import logging
import os
import threading
import time
from typing import Any

from core.entities.mcp_provider import MCPProviderEntity
from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPAuthError, MCPConnectionError
from core.mcp.types import CallToolResult

logger = logging.getLogger(__name__)


class _PooledClient:
    def __init__(self, client: MCPClientWithAuthRetry, key: str):
        self.client = client
        # The pool key this entry was registered under, kept explicitly so
        # eviction never has to recompute it from mutable client state.
        self.key = key
        self.last_used = time.monotonic()
        # Set when the entry has been removed from the registry but its lock
        # is held by an in-flight call; that call closes it on the way out.
        self.doomed = False
        self.closed = False
        # ClientSession drives a single-worker executor; serialize calls that
        # share one pooled connection.
        self.lock = threading.Lock()


class MCPClientManager:
    """A process-wide pool of authenticated MCP clients."""

    def __init__(
        self,
        idle_ttl_seconds: float | None = None,
        max_size: int | None = None,
    ):
        self._clients: dict[str, _PooledClient] = {}
        self._lock = threading.Lock()
        # Read when the manager is constructed, so the knobs respond to
        # environment changes without re-importing the module.
        self._idle_ttl_seconds = (
            float(os.getenv("MCP_CLIENT_POOL_IDLE_TTL", "300")) if idle_ttl_seconds is None else idle_ttl_seconds
        )
        self._max_size = int(os.getenv("MCP_CLIENT_POOL_MAX_SIZE", "100")) if max_size is None else max_size

    @staticmethod
    def _make_key(
        tenant_id: str,
        user_id: str | None,
        server_url: str,
        provider_id: str | None,
        timeout: float | None,
        sse_read_timeout: float | None,
    ) -> str:
        """Identify a pooled connection by stable scope, never by credentials.

        tenant/user/provider separate tenants, end users (including forwarded
        identities) and provider configs; server URL and timeouts are the
        connection fingerprint. Per-call credentials are deliberately
        excluded: forwarded-identity tokens are minted per call and OAuth
        tokens rotate, so keying on either would prevent all reuse.
        """
        material = json.dumps(
            {
                "tenant_id": tenant_id,
                "user_id": user_id,
                "server_url": server_url,
                "provider_id": provider_id,
                "timeout": timeout,
                "sse_read_timeout": sse_read_timeout,
            },
            sort_keys=True,
        )
        return hashlib.sha256(material.encode("utf-8")).hexdigest()

    def _shutdown_entry(self, entry: _PooledClient) -> None:
        """Idempotently close the underlying client."""
        if entry.closed:
            return
        entry.closed = True
        try:
            entry.client.cleanup()
        except Exception:
            logger.warning("Failed to clean up a pooled MCP client", exc_info=True)

    def _close_entry(self, entry: _PooledClient) -> None:
        """Close `entry`; must be called without holding the registry lock.

        An in-flight call holds the entry lock for as long as the server takes
        to answer, so the registry lock must never wait on it. When the entry
        is busy, mark it doomed and let the in-flight call close it in its
        finally block instead.
        """
        if not entry.lock.acquire(blocking=False):
            entry.doomed = True
            return
        try:
            self._shutdown_entry(entry)
        finally:
            entry.lock.release()

    def _evict_expired(self) -> list[_PooledClient]:
        """Remove idle-expired entries; caller closes them outside the lock."""
        now = time.monotonic()
        victims = []
        for key, entry in list(self._clients.items()):
            if now - entry.last_used >= self._idle_ttl_seconds:
                del self._clients[key]
                victims.append(entry)
        return victims

    def _evict_to_capacity(self) -> list[_PooledClient]:
        """Drop least-recently-used entries above the size cap; caller closes them."""
        overflow = len(self._clients) - self._max_size
        if overflow <= 0:
            return []
        victims = []
        for key, entry in sorted(self._clients.items(), key=lambda item: item[1].last_used)[:overflow]:
            del self._clients[key]
            victims.append(entry)
        return victims

    def _acquire(
        self,
        key: str,
        server_url: str,
        headers: dict[str, str] | None,
        timeout: float | None,
        sse_read_timeout: float | None,
        provider_entity: MCPProviderEntity | None,
        forward_identity_active: bool,
    ) -> _PooledClient:
        """Return a live pooled entry, connecting (with auth retry) if needed."""
        with self._lock:
            expired = self._evict_expired()
            entry = self._clients.get(key)
            if entry is not None:
                entry.last_used = time.monotonic()
        for victim in expired:
            self._close_entry(victim)
        if entry is not None:
            return entry

        # Connect outside the registry lock: initialization performs network
        # I/O (and possibly an OAuth refresh) that must not block unrelated
        # MCP calls. Credentials may differ between calls of the same scope;
        # the first caller's headers authenticate the session and the pooled
        # client refreshes its own token on 401.
        client = MCPClientWithAuthRetry(
            server_url=server_url,
            headers=headers,
            timeout=timeout,
            sse_read_timeout=sse_read_timeout,
            provider_entity=provider_entity,
            forward_identity_active=forward_identity_active,
        )
        try:
            client.__enter__()
        except Exception:
            # Never pool a client that failed to initialize; keep the
            # connect-per-invocation behavior for failing servers.
            try:
                client.cleanup()
            except Exception:
                logger.warning("Failed to clean up an MCP client whose initialization failed", exc_info=True)
            raise
        candidate = _PooledClient(client, key)
        overflow: list[_PooledClient] = []
        with self._lock:
            existing = self._clients.get(key)
            if existing is None:
                self._clients[key] = candidate
                overflow = self._evict_to_capacity()
        for victim in overflow:
            self._close_entry(victim)
        if existing is not None:
            # Lost a race creating the same connection: use the winner.
            self._close_entry(candidate)
            return existing
        return candidate

    def _evict(self, entry: _PooledClient) -> None:
        with self._lock:
            pooled = self._clients.get(entry.key)
            if pooled is entry:
                del self._clients[entry.key]
        self._close_entry(entry)

    def invoke_tool(
        self,
        *,
        tenant_id: str,
        user_id: str | None,
        server_url: str,
        provider_id: str | None,
        headers: dict[str, str] | None,
        timeout: float | None,
        sse_read_timeout: float | None,
        provider_entity: MCPProviderEntity | None,
        forward_identity_active: bool,
        tool_name: str,
        tool_args: dict[str, Any],
    ) -> CallToolResult:
        """Invoke a tool on a pooled connection.

        A pooled connection that turns out to be dead (`MCPConnectionError`)
        is evicted and the call retried once on a fresh connection, so a
        stale pool entry fails no more calls than connect-per-invocation did.
        Auth failures are deliberately not retried (`MCPAuthError` also
        extends `MCPConnectionError`): token refresh already happened inside
        the client, so an auth error that escapes it means re-auth is not
        possible, and re-invoking could execute the tool twice. Any other
        error escaping a session (e.g. a `ValueError` from transport-level
        parsing) evicts the entry without a retry — the next call reconnects
        instead of failing on the same broken session for a full TTL.
        """
        key = self._make_key(tenant_id, user_id, server_url, provider_id, timeout, sse_read_timeout)
        entry = self._acquire(
            key, server_url, headers, timeout, sse_read_timeout, provider_entity, forward_identity_active
        )
        try:
            with entry.lock:
                return entry.client.invoke_tool(tool_name=tool_name, tool_args=tool_args)
        except MCPAuthError:
            raise
        except MCPConnectionError:
            logger.info("Pooled MCP connection to %s died; reconnecting once", server_url)
            self._evict(entry)
            entry = self._acquire(
                key, server_url, headers, timeout, sse_read_timeout, provider_entity, forward_identity_active
            )
            with entry.lock:
                return entry.client.invoke_tool(tool_name=tool_name, tool_args=tool_args)
        except ValueError:
            # The session may be corrupted (e.g. an unexpected content type in
            # the streamable client kills its receive loop): drop it so the
            # next call reconnects. No retry — the tool may already have run.
            self._evict(entry)
            raise
        finally:
            entry.last_used = time.monotonic()
            if entry.doomed:
                self._shutdown_entry(entry)

    def close_all(self) -> None:
        """Close every pooled client (registered as an atexit hook)."""
        with self._lock:
            entries = list(self._clients.values())
            self._clients.clear()
        for entry in entries:
            self._close_entry(entry)


_manager: MCPClientManager | None = None
_manager_lock = threading.Lock()


def get_mcp_client_manager() -> MCPClientManager:
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = MCPClientManager()
        return _manager


def close_all_mcp_clients() -> None:
    """Close every pooled client, so stateful servers do not outlive the process."""
    with _manager_lock:
        manager = _manager
    if manager is not None:
        manager.close_all()


# Mirror core/helper/http_client_pooling.py: pooled resources get an atexit
# hook so long-lived sessions (e.g. a Playwright browser) are closed when the
# process exits instead of idling until the TTL.
atexit.register(close_all_mcp_clients)
