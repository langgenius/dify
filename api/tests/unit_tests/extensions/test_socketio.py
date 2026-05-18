from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from extensions import ext_socketio


def test_create_client_manager_uses_in_memory_transport_when_collaboration_disabled(
    monkeypatch: pytest.MonkeyPatch,
):
    config = SimpleNamespace(ENABLE_COLLABORATION_MODE=False)
    redis_manager = Mock()
    monkeypatch.setattr(ext_socketio, "dify_config", config)
    monkeypatch.setattr(ext_socketio.socketio, "RedisManager", redis_manager)

    manager = ext_socketio.create_client_manager()

    assert manager is None
    redis_manager.assert_not_called()


def test_create_client_manager_uses_redis_when_collaboration_enabled(
    monkeypatch: pytest.MonkeyPatch,
):
    config = SimpleNamespace(
        ENABLE_COLLABORATION_MODE=True,
        normalized_pubsub_redis_url="redis://redis:6379/1",
    )
    redis_manager = Mock(return_value=object())
    monkeypatch.setattr(ext_socketio, "dify_config", config)
    monkeypatch.setattr(ext_socketio.socketio, "RedisManager", redis_manager)

    manager = ext_socketio.create_client_manager()

    assert manager is redis_manager.return_value
    redis_manager.assert_called_once_with(
        "redis://redis:6379/1",
        channel=ext_socketio.SOCKETIO_COLLABORATION_CHANNEL,
    )


def test_create_socketio_server_passes_client_manager(monkeypatch: pytest.MonkeyPatch):
    config = SimpleNamespace(CONSOLE_CORS_ALLOW_ORIGINS=["https://example.com"])
    client_manager = object()
    server = Mock(return_value=object())
    monkeypatch.setattr(ext_socketio, "dify_config", config)
    monkeypatch.setattr(ext_socketio, "create_client_manager", Mock(return_value=client_manager))
    monkeypatch.setattr(ext_socketio.socketio, "Server", server)

    result = ext_socketio.create_socketio_server()

    assert result is server.return_value
    server.assert_called_once_with(
        async_mode="gevent",
        client_manager=client_manager,
        cors_allowed_origins=["https://example.com"],
    )
