"""Process-wide reuse of MCP client connections.

Every `MCPTool` invocation used to open an MCP connection and close it as soon
as the call returned, which discards any per-session state a stateful MCP
server keeps (for example the browser context of the Playwright MCP server:
`browser_navigate` succeeds, the next call lands on a fresh `about:blank`
page). This module keeps successfully initialized clients in a process-wide
pool keyed by server URL and effective request headers, so consecutive calls
within the idle TTL reuse the same session.

The pool is deliberately conservative: each pooled client is guarded by a
lock (the sync `ClientSession` processes messages on a single worker),
entries are evicted after an idle TTL or when the pool exceeds its size cap,
and a pooled connection that died is dropped and retried once on a fresh
connection, keeping the per-call robustness of connect-per-invocation.
"""

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

# Seconds after which an idle pooled client is closed on its next acquire, and
# the maximum number of clients kept open per process. Overridable for tests
# and for deployments that rely on long-lived stateful MCP servers.
DEFAULT_IDLE_TTL_SECONDS = float(os.getenv("MCP_CLIENT_POOL_IDLE_TTL", "300"))
DEFAULT_MAX_SIZE = int(os.getenv("MCP_CLIENT_POOL_MAX_SIZE", "100"))


class _PooledClient:
    def __init__(self, client: MCPClientWithAuthRetry, key: str):
        self.client = client
        # The pool key this entry was registered under. Kept explicitly because
        # the client may refresh its own Authorization header after an auth
        # retry, which would change a recomputed key.
        self.key = key
        self.last_used = time.monotonic()
        # ClientSession drives a single-worker executor; serialize calls that
        # share one pooled connection.
        self.lock = threading.Lock()


class MCPClientManager:
    """A process-wide pool of authenticated MCP clients."""

    def __init__(
        self,
        idle_ttl_seconds: float = DEFAULT_IDLE_TTL_SECONDS,
        max_size: int = DEFAULT_MAX_SIZE,
    ):
        self._clients: dict[str, _PooledClient] = {}
        self._lock = threading.Lock()
        self._idle_ttl_seconds = idle_ttl_seconds
        self._max_size = max_size

    @staticmethod
    def _make_key(
        server_url: str,
        headers: dict[str, str] | None,
        timeout: float | None,
        sse_read_timeout: float | None,
    ) -> str:
        """Identify a connection by everything that goes into building it.

        Headers carry the (possibly per-user) credentials, so distinct tenants,
        users or tokens naturally map to distinct pooled connections.
        """
        material = json.dumps(
            {
                "server_url": server_url,
                "headers": dict(sorted((headers or {}).items())),
                "timeout": timeout,
                "sse_read_timeout": sse_read_timeout,
            },
            sort_keys=True,
        )
        return hashlib.sha256(material.encode("utf-8")).hexdigest()

    def _close_entry(self, entry: _PooledClient) -> None:
        with entry.lock:
            try:
                entry.client.cleanup()
            except Exception:
                logger.warning("Failed to clean up a pooled MCP client", exc_info=True)

    def _evict_expired(self) -> None:
        now = time.monotonic()
        for key, entry in list(self._clients.items()):
            if now - entry.last_used >= self._idle_ttl_seconds:
                del self._clients[key]
                self._close_entry(entry)

    def _evict_to_capacity(self) -> None:
        overflow = len(self._clients) - self._max_size
        if overflow <= 0:
            return
        for key, entry in sorted(self._clients.items(), key=lambda item: item[1].last_used)[:overflow]:
            del self._clients[key]
            self._close_entry(entry)

    def _acquire(
        self,
        server_url: str,
        headers: dict[str, str] | None,
        timeout: float | None,
        sse_read_timeout: float | None,
        provider_entity: MCPProviderEntity | None,
        forward_identity_active: bool,
    ) -> _PooledClient:
        """Return a live pooled entry, connecting (with auth retry) if needed."""
        key = self._make_key(server_url, headers, timeout, sse_read_timeout)
        while True:
            with self._lock:
                self._evict_expired()
                entry = self._clients.get(key)
                if entry is not None:
                    entry.last_used = time.monotonic()
                    return entry

            # Connect outside the registry lock: initialization performs
            # network I/O (and possibly an OAuth refresh) that must not block
            # unrelated MCP calls.
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
            with self._lock:
                existing = self._clients.get(key)
                if existing is not None:
                    # Lost a race creating the same connection: use the winner.
                    self._close_entry(candidate)
                    existing.last_used = time.monotonic()
                    return existing
                self._clients[key] = candidate
                self._evict_to_capacity()
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
        server_url: str,
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
        is closed and the call is retried once on a fresh connection, so a
        stale pool entry fails no more calls than connect-per-invocation did.
        Auth failures must not retry here (`MCPAuthError` also extends
        `MCPConnectionError`): the pooled client refreshes tokens internally,
        so an error that escapes it means re-auth is not possible, and
        re-invoking could execute the tool twice. They propagate untouched.
        """
        entry = self._acquire(server_url, headers, timeout, sse_read_timeout, provider_entity, forward_identity_active)
        try:
            with entry.lock:
                return entry.client.invoke_tool(tool_name=tool_name, tool_args=tool_args)
        except MCPAuthError:
            raise
        except MCPConnectionError:
            logger.info("Pooled MCP connection to %s died; reconnecting once", server_url)
            self._evict(entry)
            entry = self._acquire(
                server_url, headers, timeout, sse_read_timeout, provider_entity, forward_identity_active
            )
            with entry.lock:
                return entry.client.invoke_tool(tool_name=tool_name, tool_args=tool_args)
        finally:
            entry.last_used = time.monotonic()

    def close_all(self) -> None:
        """Close every pooled client (used on shutdown and in tests)."""
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


def reset_mcp_client_manager() -> None:
    """Drop the process-wide manager (tests only)."""
    global _manager
    with _manager_lock:
        manager = _manager
        _manager = None
    if manager is not None:
        manager.close_all()
