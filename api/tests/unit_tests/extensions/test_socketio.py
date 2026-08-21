import ssl
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from extensions import ext_socketio


def test_create_socketio_client_manager_uses_prefixed_redis_channel_and_options(
    monkeypatch: pytest.MonkeyPatch,
):
    config = SimpleNamespace(
        normalized_pubsub_redis_url="redis://redis:6379/1",
        REDIS_SOCKET_TIMEOUT=10,
        REDIS_SOCKET_CONNECT_TIMEOUT=5,
        REDIS_HEALTH_CHECK_INTERVAL=30,
        REDIS_SERIALIZATION_PROTOCOL=3,
        REDIS_MAX_CONNECTIONS=20,
    )
    redis_manager = Mock(return_value=object())
    serialize_redis_name = Mock(return_value="dify:socketio")
    monkeypatch.setattr(ext_socketio, "dify_config", config)
    monkeypatch.setattr(ext_socketio.socketio, "RedisManager", redis_manager)
    monkeypatch.setattr(ext_socketio, "serialize_redis_name", serialize_redis_name)

    manager = ext_socketio.create_socketio_client_manager()

    assert manager is redis_manager.return_value
    serialize_redis_name.assert_called_once_with(ext_socketio.SOCKETIO_REDIS_CHANNEL)
    redis_manager.assert_called_once_with(
        "redis://redis:6379/1",
        channel="dify:socketio",
        redis_options={
            "socket_timeout": 10,
            "socket_connect_timeout": 5,
            "health_check_interval": 30,
            "protocol": 3,
            "max_connections": 20,
        },
    )


def test_create_socketio_client_manager_adds_ssl_options_for_rediss(
    monkeypatch: pytest.MonkeyPatch,
):
    config = SimpleNamespace(
        normalized_pubsub_redis_url="rediss://redis:6379/1",
        REDIS_SOCKET_TIMEOUT=10,
        REDIS_SOCKET_CONNECT_TIMEOUT=5,
        REDIS_HEALTH_CHECK_INTERVAL=30,
        REDIS_SERIALIZATION_PROTOCOL=3,
        REDIS_MAX_CONNECTIONS=None,
        REDIS_SSL_CERT_REQS="CERT_REQUIRED",
        REDIS_SSL_CA_CERTS="/etc/ssl/ca.pem",
        REDIS_SSL_CERTFILE="/etc/ssl/client.pem",
        REDIS_SSL_KEYFILE="/etc/ssl/client.key",
    )
    redis_manager = Mock(return_value=object())
    monkeypatch.setattr(ext_socketio, "dify_config", config)
    monkeypatch.setattr(ext_socketio.socketio, "RedisManager", redis_manager)
    monkeypatch.setattr(ext_socketio, "serialize_redis_name", Mock(return_value="dify:socketio"))

    manager = ext_socketio.create_socketio_client_manager()

    assert manager is redis_manager.return_value
    redis_manager.assert_called_once_with(
        "rediss://redis:6379/1",
        channel="dify:socketio",
        redis_options={
            "socket_timeout": 10,
            "socket_connect_timeout": 5,
            "health_check_interval": 30,
            "protocol": 3,
            "ssl_cert_reqs": ssl.CERT_REQUIRED,
            "ssl_ca_certs": "/etc/ssl/ca.pem",
            "ssl_certfile": "/etc/ssl/client.pem",
            "ssl_keyfile": "/etc/ssl/client.key",
        },
    )
