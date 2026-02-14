import threading
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

from core.mcp.session_manager import McpSessionManager


def test_acquire_reuses_existing_session() -> None:
    manager = McpSessionManager()
    client = Mock()

    factory = Mock(return_value=client)

    first = manager.acquire("key", factory)
    second = manager.acquire("key", factory)

    assert first is client
    assert second is client
    factory.assert_called_once()


def test_acquire_concurrent_cleanup_losing_client() -> None:
    manager = McpSessionManager()
    barrier = threading.Barrier(2)

    client_a = Mock()
    client_b = Mock()
    clients = [client_a, client_b]

    def factory():
        barrier.wait()
        return clients.pop(0)

    results: list[Mock] = []
    exceptions: list[BaseException] = []

    def worker():
        try:
            results.append(manager.acquire("key", factory))
        except BaseException as exc:
            exceptions.append(exc)

    threads = [threading.Thread(target=worker), threading.Thread(target=worker)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert not exceptions
    assert len(results) == 2
    assert results[0] is results[1]

    # The session manager should retain only one client; the other must be cleaned up
    winner = manager._sessions["key"].client
    losers = {client_a, client_b} - {winner}

    assert len(losers) == 1
    losing_client = losers.pop()

    losing_client.cleanup.assert_called_once()
    winner.cleanup.assert_not_called()


def test_acquire_replaces_expired_session() -> None:
    manager = McpSessionManager(idle_timeout=timedelta(milliseconds=1))

    old_client = Mock()
    new_client = Mock()

    manager.acquire("key", Mock(return_value=old_client))

    # Simulate idle timeout expiry
    manager._sessions["key"].last_used_at = datetime.now(UTC) - timedelta(seconds=1)

    result = manager.acquire("key", Mock(return_value=new_client))

    assert result is new_client
    old_client.cleanup.assert_called_once()
