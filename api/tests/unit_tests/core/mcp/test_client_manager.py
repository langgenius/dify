"""Unit tests for the pooled MCP client manager."""

from unittest.mock import MagicMock, patch

import pytest

from core.mcp.client_manager import MCPClientManager
from core.mcp.error import MCPAuthError, MCPConnectionError


def _invoke(manager: MCPClientManager, headers: dict[str, str] | None = None, **kwargs):
    params = {
        "server_url": "http://test.example.com/mcp",
        "headers": headers if headers is not None else {"Authorization": "Bearer token"},
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
    def test_same_connection_reused_across_calls(self):
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

    def test_distinct_headers_get_distinct_connections(self):
        manager = MCPClientManager()
        with patch("core.mcp.client_manager.MCPClientWithAuthRetry") as factory:
            factory.side_effect = [MagicMock(), MagicMock()]

            _invoke(manager, headers={"Authorization": "Bearer user-a"})
            _invoke(manager, headers={"Authorization": "Bearer user-b"})

            assert factory.call_count == 2

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

            _invoke(manager, headers={"Authorization": "Bearer a"})
            _invoke(manager, headers={"Authorization": "Bearer b"})

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
            _invoke(manager, headers={"Authorization": "Bearer a"})
            _invoke(manager, headers={"Authorization": "Bearer b"})

            manager.close_all()

            for client in factory.side_effect:
                client.cleanup.assert_called_once()
            assert manager._clients == {}
