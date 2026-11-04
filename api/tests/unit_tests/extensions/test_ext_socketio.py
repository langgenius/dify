import socket
import ssl
import sys
from collections.abc import Callable

import socketio

from configs import dify_config
from extensions import ext_socketio


def test_socketio_server_uses_redis_manager() -> None:
    assert isinstance(ext_socketio.sio.manager, socketio.RedisManager)


def test_create_socketio_client_manager_uses_pubsub_url_and_prefixed_channel(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(PUBSUB_REDIS_URL="redis://redis.example.com:6380/3", REDIS_KEY_PREFIX="tenant-a")

    manager = ext_socketio.create_socketio_client_manager()

    assert manager.redis_url == "redis://redis.example.com:6380/3"
    assert manager.channel == "tenant-a:socketio"


def test_build_redis_options_includes_tls_options_for_rediss(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        REDIS_SSL_CERT_REQS="CERT_REQUIRED",
        REDIS_SSL_CA_CERTS="/ca.pem",
        REDIS_SSL_CERTFILE="/cert.pem",
        REDIS_SSL_KEYFILE="/key.pem",
    )

    options = ext_socketio._build_redis_options("rediss://redis.example.com:6380/3")

    assert options["ssl_cert_reqs"] == ssl.CERT_REQUIRED
    assert options["ssl_ca_certs"] == "/ca.pem"
    assert options["ssl_certfile"] == "/cert.pem"
    assert options["ssl_keyfile"] == "/key.pem"


def test_build_redis_options_omits_socket_timeout(config_overrides: Callable[..., None]) -> None:
    # socket_timeout must not be passed to RedisManager because the pub/sub
    # listen loop blocks indefinitely between messages; a read timeout there
    # triggers an infinite reconnect storm (issue #39423).
    config_overrides(REDIS_SOCKET_TIMEOUT=5.0)

    options = ext_socketio._build_redis_options("redis://redis.example.com:6380/3")

    assert "socket_timeout" not in options
    assert "socket_connect_timeout" in options


def test_build_redis_options_passes_tcp_keepalive(config_overrides: Callable[..., None]) -> None:
    # The pub/sub listen loop idles between messages, so without TCP keepalive
    # probes middleboxes (cloud LBs, K8s services, Redis proxies) silently drop
    # the connection (issue #39812).
    config_overrides(
        REDIS_KEEPALIVE=True,
        REDIS_KEEPALIVE_IDLE=30,
        REDIS_KEEPALIVE_INTERVAL=10,
        REDIS_KEEPALIVE_COUNT=5,
    )

    options = ext_socketio._build_redis_options("redis://redis.example.com:6380/3")

    assert options["socket_keepalive"] is True
    if sys.platform == "linux":
        assert options["socket_keepalive_options"] == {
            socket.TCP_KEEPIDLE: 30,
            socket.TCP_KEEPINTVL: 10,
            socket.TCP_KEEPCNT: 5,
        }
    elif sys.platform == "darwin":
        assert options["socket_keepalive_options"] == {socket.TCP_KEEPALIVE: 30}
    else:
        assert options["socket_keepalive_options"] == {}


def test_socketio_server_uses_configured_max_http_buffer_size() -> None:
    assert ext_socketio.sio.eio.max_http_buffer_size == dify_config.WEBSOCKET_MAX_HTTP_BUFFER_SIZE
