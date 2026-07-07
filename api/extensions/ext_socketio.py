import ssl
from typing import Any, cast
from urllib.parse import urlparse

import socketio  # type: ignore[reportMissingTypeStubs]

from configs import dify_config
from extensions.redis_names import serialize_redis_name

SOCKETIO_REDIS_CHANNEL = "socketio"


def _get_ssl_cert_reqs() -> ssl.VerifyMode:
    cert_reqs_map = {
        "CERT_NONE": ssl.CERT_NONE,
        "CERT_OPTIONAL": ssl.CERT_OPTIONAL,
        "CERT_REQUIRED": ssl.CERT_REQUIRED,
    }
    return cert_reqs_map.get(dify_config.REDIS_SSL_CERT_REQS, ssl.CERT_NONE)


def _build_redis_options(redis_url: str) -> dict[str, Any]:
    """Build Redis options for Socket.IO's cross-process pub/sub manager."""
    options: dict[str, Any] = {
        "socket_timeout": dify_config.REDIS_SOCKET_TIMEOUT,
        "socket_connect_timeout": dify_config.REDIS_SOCKET_CONNECT_TIMEOUT,
        "health_check_interval": dify_config.REDIS_HEALTH_CHECK_INTERVAL,
        "protocol": dify_config.REDIS_SERIALIZATION_PROTOCOL,
    }

    if dify_config.REDIS_MAX_CONNECTIONS:
        options["max_connections"] = dify_config.REDIS_MAX_CONNECTIONS

    if urlparse(redis_url).scheme == "rediss":
        options.update(
            {
                "ssl_cert_reqs": _get_ssl_cert_reqs(),
                "ssl_ca_certs": dify_config.REDIS_SSL_CA_CERTS,
                "ssl_certfile": dify_config.REDIS_SSL_CERTFILE,
                "ssl_keyfile": dify_config.REDIS_SSL_KEYFILE,
            }
        )

    return options


def create_socketio_client_manager() -> Any:
    """
    Create the Socket.IO manager used to fan out room events across API workers.

    Workflow collaboration relies on room broadcasts and direct emits to a collaborator's sid. The default in-memory
    manager only reaches clients attached to the current process, so horizontal websocket workers must share a Redis
    pub/sub channel. The channel name follows Dify's Redis key prefix to keep independent deployments isolated.
    """
    redis_url = dify_config.normalized_pubsub_redis_url
    return socketio.RedisManager(
        redis_url,
        channel=serialize_redis_name(SOCKETIO_REDIS_CHANNEL),
        redis_options=_build_redis_options(redis_url),
    )


# TODO: FIXME(chariri) - Casting to any because app_factory attaches the
# current app as the `app` attribute on this - Bad.
sio = cast(
    Any,
    socketio.Server(
        async_mode="gevent",
        client_manager=create_socketio_client_manager(),
        cors_allowed_origins=dify_config.CONSOLE_CORS_ALLOW_ORIGINS,
    ),
)
