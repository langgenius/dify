import ssl

import pytest
import socketio

from extensions import ext_socketio


def test_socketio_server_uses_redis_manager() -> None:
    assert isinstance(ext_socketio.sio.manager, socketio.RedisManager)


def test_create_socketio_client_manager_uses_pubsub_url_and_prefixed_channel(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ext_socketio.dify_config, "PUBSUB_REDIS_URL", "redis://redis.example.com:6380/3")
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEY_PREFIX", "tenant-a")

    manager = ext_socketio.create_socketio_client_manager()

    assert manager.redis_url == "redis://redis.example.com:6380/3"
    assert manager.channel == "tenant-a:socketio"


def test_build_redis_options_includes_tls_options_for_rediss(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_SSL_CERT_REQS", "CERT_REQUIRED")
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_SSL_CA_CERTS", "/ca.pem")
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_SSL_CERTFILE", "/cert.pem")
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_SSL_KEYFILE", "/key.pem")

    options = ext_socketio._build_redis_options("rediss://redis.example.com:6380/3")

    assert options["ssl_cert_reqs"] == ssl.CERT_REQUIRED
    assert options["ssl_ca_certs"] == "/ca.pem"
    assert options["ssl_certfile"] == "/cert.pem"
    assert options["ssl_keyfile"] == "/key.pem"


def test_build_redis_options_omits_socket_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    # socket_timeout must not be passed to RedisManager because the pub/sub
    # listen loop blocks indefinitely between messages; a read timeout there
    # triggers an infinite reconnect storm (issue #39423).
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_SOCKET_TIMEOUT", 5.0)

    options = ext_socketio._build_redis_options("redis://redis.example.com:6380/3")

    assert "socket_timeout" not in options
    assert "socket_connect_timeout" in options
