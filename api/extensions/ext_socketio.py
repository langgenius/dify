from typing import Any, cast

import socketio  # type: ignore[reportMissingTypeStubs]

from configs import dify_config

SOCKETIO_COLLABORATION_CHANNEL = "socketio:collaboration"


def create_client_manager():
    if not dify_config.ENABLE_COLLABORATION_MODE:
        return None

    return socketio.RedisManager(
        dify_config.normalized_pubsub_redis_url,
        channel=SOCKETIO_COLLABORATION_CHANNEL,
    )


def create_socketio_server():
    return socketio.Server(
        async_mode="gevent",
        client_manager=create_client_manager(),
        cors_allowed_origins=dify_config.CONSOLE_CORS_ALLOW_ORIGINS,
    )


# TODO: FIXME(chariri) - Casting to any because app_factory attaches the
# current app as the `app` attribute on this - Bad.
sio = cast(Any, create_socketio_server())
