import socket
import ssl
import sys

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


@pytest.mark.skipif(sys.platform != "linux", reason="TCP_KEEPIDLE/TCP_KEEPINTVL/TCP_KEEPCNT are Linux-only")
def test_build_redis_options_sets_linux_keepalive_options(monkeypatch) -> None:
    monkeypatch.setattr(ext_socketio.sys, "platform", "linux")
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE", True)
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE_IDLE", 30)
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE_INTERVAL", 10)
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE_COUNT", 10)

    options = ext_socketio._build_redis_options("redis://redis.example.com:6380/3")

    assert options["socket_keepalive"] is True
    assert options["socket_keepalive_options"] == {
        socket.TCP_KEEPIDLE: 30,
        socket.TCP_KEEPINTVL: 10,
        socket.TCP_KEEPCNT: 10,
    }


@pytest.mark.skipif(sys.platform != "darwin", reason="TCP_KEEPALIVE is the macOS keepalive idle knob")
def test_build_redis_options_sets_darwin_keepalive_options(monkeypatch) -> None:
    monkeypatch.setattr(ext_socketio.sys, "platform", "darwin")
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE", True)
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE_IDLE", 30)

    options = ext_socketio._build_redis_options("redis://redis.example.com:6380/3")

    assert options["socket_keepalive"] is True
    assert options["socket_keepalive_options"] == {socket.TCP_KEEPALIVE: 30}


def test_build_redis_options_no_keepalive_options_on_unsupported_platform(monkeypatch) -> None:
    monkeypatch.setattr(ext_socketio.sys, "platform", "win32")

    options = ext_socketio._build_redis_options("redis://redis.example.com:6380/3")

    assert options["socket_keepalive_options"] == {}
