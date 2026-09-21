"""Unit tests for the pooled MCP client manager."""

import threading
from unittest.mock import MagicMock, patch

import pytest

from core.mcp.client_manager import MCPClientManager
from core.mcp.error import MCPAuthError, MCPConnectionError


def _invoke(manager: MCPClientManager, **kwargs):
    params = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "server_url": "http://test.example.com/mcp",
        "provider_id": "provider-1",
        "headers": {"Authorization": "Bearer token"},
        "timeout": 30.0,
        "sse_read_timeout": 60.0,
        "provider_entity": None,
        "forward_identity_active": False,
        "tool_name": "browser_navigate",
        "tool_args": {"url": "https://example.com"},
    }
    params.update(kwargs)
    return manager.invoke_tool(**params)


class TestMCPClientManager:
    def test_same_scope_reuses_connection(self):
        manager = MCPClientManager()
        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:
            client = MagicMock()
            factory.return_value = client

            first = _invoke(manager)
            second = _invoke(manager)

            assert first is second
            assert factory.call_count == 1
            assert client.invoke_tool.call_count == 2
            client.cleanup.assert_not_called()

    def test_changing_credentials_still_reuse_connection(self):
        """Per-call credentials (minted JWTs, refreshed OAuth tokens) must not split the pool."""
        manager = MCPClientManager()
        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:
            client = MagicMock()
            factory.return_value = client

            _invoke(manager, headers={"Authorization": "Bearer minted-1"})
            _invoke(manager, headers={"Authorization": "Bearer minted-2"})

            assert factory.call_count == 1

    def test_distinct_users_get_distinct_connections(self):
        """A stateful server must not share one session across end users."""
        manager = MCPClientManager()
        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:
            factory.side_effect = [MagicMock(), MagicMock()]

            _invoke(manager, user_id="user-1")
            _invoke(manager, user_id="user-2")

            assert factory.call_count == 2

    def test_distinct_tenants_and_providers_get_distinct_connections(self):
        manager = MCPClientManager()
        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:
            factory.side_effect = [MagicMock(), MagicMock(), MagicMock()]

            _invoke(manager, tenant_id="tenant-1")
            _invoke(manager, tenant_id="tenant-2")
            _invoke(manager, provider_id="provider-2")

            assert factory.call_count == 3

    def test_dead_connection_is_evicted_and_retried(self):
        manager = MCPClientManager()
        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:
            dead, alive = MagicMock(), MagicMock()
            dead.invoke_tool.side_effect = MCPConnectionError("connection reset")
            factory.side_effect = [dead, alive]

            result = _invoke(manager)

            assert result is alive.invoke_tool.return_value
            assert factory.call_count == 2
            dead.cleanup.assert_called_once()

    def test_auth_error_propagates_but_keeps_connection(self):
        manager = MCPClientManager()
        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:
            client = MagicMock()
            client.invoke_tool.side_effect = MCPAuthError("401")
            factory.return_value = client

            with pytest.raises(MCPAuthError):
                _invoke(manager)

            # The client refreshes tokens internally; it stays pooled.
            assert factory.call_count == 1

            client.invoke_tool.side_effect = None
            _invoke(manager)
            assert factory.call_count == 1

    def test_value_error_evicts_without_retry(self):
        """Transport-level parsing failures corrupt the session: drop it, do not re-invoke."""
        manager = MCPClientManager()
        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:
            broken = MagicMock()
            broken.invoke_tool.side_effect = ValueError("Unexpected content type")
            factory.side_effect = [broken, MagicMock()]

            with pytest.raises(ValueError):
                _invoke(manager)

            # No retry happened, but the entry was dropped for the next call.
            assert factory.call_count == 1
            _invoke(manager)
            assert factory.call_count == 2
            broken.cleanup.assert_called_once()

    def test_blocked_call_does_not_block_other_scopes(self):
        """A hung call on one connection must not wedge calls on other connections."""
        manager = MCPClientManager()
        release = threading.Event()
        hung_entered = threading.Event()

        def hung_invoke(**_kwargs):
            hung_entered.set()
            release.wait(10)
            return "hung-ok"

        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:

            def make_client(**kwargs):
                client = MagicMock()
                if kwargs.get("headers", {}).get("X-User") == "hung":
                    client.invoke_tool.side_effect = hung_invoke
                return client

            factory.side_effect = make_client

            hung_thread = threading.Thread(
                target=lambda: _invoke(manager, user_id="user-hung", headers={"X-User": "hung"})
            )
            hung_thread.start()
            assert hung_entered.wait(2)

            other_results = []
            other_thread = threading.Thread(target=lambda: other_results.append(_invoke(manager, user_id="user-2")))
            other_thread.start()
            other_thread.join(timeout=3)

            assert not other_thread.is_alive(), "a hung call on one connection blocked an unrelated scope"
            assert other_results[0] is not None

            release.set()
            hung_thread.join(timeout=3)

    def test_evicting_in_flight_entry_does_not_wedge_new_acquires(self):
        """Idle eviction of an entry whose call is still running must not block the same key."""
        manager = MCPClientManager(idle_ttl_seconds=0)
        release = threading.Event()
        hung_entered = threading.Event()

        def hung_invoke(**_kwargs):
            hung_entered.set()
            release.wait(10)
            return "hung-ok"

        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:

            def make_client(**kwargs):
                client = MagicMock()
                if kwargs.get("headers", {}).get("X-User") == "hung":
                    client.invoke_tool.side_effect = hung_invoke
                return client

            factory.side_effect = make_client

            hung_thread = threading.Thread(
                target=lambda: _invoke(manager, user_id="user-a", headers={"X-User": "hung"})
            )
            hung_thread.start()
            assert hung_entered.wait(2)

            same_key_results = []
            same_key_thread = threading.Thread(
                target=lambda: same_key_results.append(_invoke(manager, user_id="user-a"))
            )
            same_key_thread.start()
            same_key_thread.join(timeout=3)

            assert not same_key_thread.is_alive(), "eviction of an in-flight entry blocked its own key"
            assert same_key_results[0] is not None

            release.set()
            hung_thread.join(timeout=3)

    def test_idle_ttl_closes_stale_connection(self):
        manager = MCPClientManager(idle_ttl_seconds=0)
        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:
            stale, fresh = MagicMock(), MagicMock()
            factory.side_effect = [stale, fresh]

            _invoke(manager)
            _invoke(manager)

            assert factory.call_count == 2
            stale.cleanup.assert_called_once()

    def test_max_size_evicts_least_recently_used(self):
        manager = MCPClientManager(max_size=1)
        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:
            oldest, newest = MagicMock(), MagicMock()
            factory.side_effect = [oldest, newest]

            _invoke(manager, user_id="user-a")
            _invoke(manager, user_id="user-b")

            assert factory.call_count == 2
            oldest.cleanup.assert_called_once()

    def test_failed_initialize_is_not_pooled(self):
        manager = MCPClientManager()
        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:
            failing = MagicMock()
            failing.__enter__.side_effect = MCPConnectionError("server down")
            ok = MagicMock()
            factory.side_effect = [failing, ok]

            with pytest.raises(MCPConnectionError):
                _invoke(manager)

            result = _invoke(manager)
            assert result is ok.invoke_tool.return_value

    def test_close_all_closes_every_connection(self):
        manager = MCPClientManager()
        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:
            factory.side_effect = [MagicMock(), MagicMock()]
            _invoke(manager, user_id="user-a")
            _invoke(manager, user_id="user-b")

            manager.close_all()

            for client in factory.side_effect:
                client.cleanup.assert_called_once()
            assert manager._clients == {}
