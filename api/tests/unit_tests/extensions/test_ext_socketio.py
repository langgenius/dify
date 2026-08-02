import socket
import ssl
import sys

import socketio

from extensions import ext_socketio


def test_socketio_server_uses_redis_manager() -> None:
    assert isinstance(ext_socketio.sio.manager, socketio.RedisManager)


def test_create_socketio_client_manager_uses_pubsub_url_and_prefixed_channel(monkeypatch) -> None:
    monkeypatch.setattr(ext_socketio.dify_config, "PUBSUB_REDIS_URL", "redis://redis.example.com:6380/3")
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEY_PREFIX", "tenant-a")

    manager = ext_socketio.create_socketio_client_manager()

    assert manager.redis_url == "redis://redis.example.com:6380/3"
    assert manager.channel == "tenant-a:socketio"


def test_build_redis_options_includes_tls_options_for_rediss(monkeypatch) -> None:
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_SSL_CERT_REQS", "CERT_REQUIRED")
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_SSL_CA_CERTS", "/ca.pem")
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_SSL_CERTFILE", "/cert.pem")
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_SSL_KEYFILE", "/key.pem")

    options = ext_socketio._build_redis_options("rediss://redis.example.com:6380/3")

    assert options["ssl_cert_reqs"] == ssl.CERT_REQUIRED
    assert options["ssl_ca_certs"] == "/ca.pem"
    assert options["ssl_certfile"] == "/cert.pem"
    assert options["ssl_keyfile"] == "/key.pem"


def test_build_redis_options_omits_socket_timeout(monkeypatch) -> None:
    # socket_timeout must not be passed to RedisManager because the pub/sub
    # listen loop blocks indefinitely between messages; a read timeout there
    # triggers an infinite reconnect storm (issue #39423).
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_SOCKET_TIMEOUT", 5.0)

    options = ext_socketio._build_redis_options("redis://redis.example.com:6380/3")

    assert "socket_timeout" not in options
    assert "socket_connect_timeout" in options


def test_build_redis_options_omits_keepalive_when_disabled(monkeypatch) -> None:
    # When REDIS_KEEPALIVE is False (the default), the Socket.IO Redis
    # options must not include keepalive keys. opt-in only.
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE", False)

    options = ext_socketio._build_redis_options("redis://redis.example.com:6380/3")

    assert "socket_keepalive" not in options
    assert "socket_keepalive_options" not in options


def test_build_keepalive_options_returns_platform_specific_dict(monkeypatch) -> None:
    # Regression for #39812: when REDIS_KEEPALIVE is enabled, the Socket.IO
    # pub/sub connection gets the same TCP keepalive probes as the regular
    # Redis clients via extensions.ext_redis._get_connection_health_params.
    # Without these, cloud LBs and K8s services silently close the idle
    # pub/sub connection and the client only notices on the next health
    # check, leading to "Cannot receive from redis... retrying in 1 secs"
    # log spam every 30-60s.
    # This test runs on whatever platform the CI runs on, and only asserts
    # the high-level shape (dict, non-empty on linux/darwin) so the
    # platform-specific constants (TCP_KEEPIDLE on linux, TCP_KEEPALIVE on
    # darwin) stay where they belong. The actual production code under
    # test follows the same ext_redis.py contract.
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE_IDLE", 30)
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE_INTERVAL", 10)
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE_COUNT", 10)
    monkeypatch.setattr(ext_socketio.sys, "platform", sys.platform)

    options = ext_socketio._build_keepalive_options()

    assert isinstance(options, dict)
    # On linux: TCP_KEEPIDLE / TCP_KEEPINTVL / TCP_KEEPCNT are set.
    # On darwin: TCP_KEEPALIVE is set.
    # On other platforms (windows, etc.): empty dict -- keepalive is opt-in
    # and not configured for those platforms, same as ext_redis.py.
    if sys.platform == "linux":
        assert options[socket.TCP_KEEPIDLE] == 30
        assert options[socket.TCP_KEEPINTVL] == 10
        assert options[socket.TCP_KEEPCNT] == 10
    elif sys.platform == "darwin":
        assert options[socket.TCP_KEEPALIVE] == 30
    else:
        assert options == {}


def test_build_redis_options_includes_keepalive_when_enabled(monkeypatch) -> None:
    # High-level check that socket_keepalive is wired into _build_redis_options
    # when the REDIS_KEEPALIVE flag is on. The platform-specific option
    # values are covered by test_build_keepalive_options_returns_platform_specific_dict.
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE", True)
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE_IDLE", 30)
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE_INTERVAL", 10)
    monkeypatch.setattr(ext_socketio.dify_config, "REDIS_KEEPALIVE_COUNT", 10)
    monkeypatch.setattr(ext_socketio.sys, "platform", sys.platform)

    options = ext_socketio._build_redis_options("redis://redis.example.com:6380/3")

    assert options["socket_keepalive"] is True
    # socket_keepalive_options is a non-empty dict on linux and darwin
    # (the two platforms we configure keepalive for); empty on other
    # platforms, in which case _build_redis_options should NOT include the
    # key at all so we don't pass an empty dict to redis-py.
    if sys.platform in ("linux", "darwin"):
        assert options["socket_keepalive_options"]
