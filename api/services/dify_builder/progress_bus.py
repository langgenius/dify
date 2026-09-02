"""Session progress bus over the Redis broadcast channel.

The Celery advance task publishes progress events here and the POST-SSE
endpoints subscribe to the same topic. A streaming request must establish its
delivery boundary before dispatching the task; merely constructing the Redis
subscription is not sufficient because subscriptions activate lazily.

Uses ``extensions.ext_redis.get_pubsub_broadcast_channel()`` rather than
constructing ``StreamsBroadcastChannel`` directly: that helper builds the
channel on the raw pubsub client (avoiding a double key-prefix bug when
``REDIS_KEY_PREFIX`` is set) and respects the deployment's configured
``PUBSUB_REDIS_CHANNEL_TYPE`` (streams / sharded / pubsub), so publishers
and subscribers always agree on channel type and keys. It asserts the
pubsub client is initialized, so it must be called lazily inside
``publish``/``subscribe`` rather than at module import time.
"""

from __future__ import annotations

import json
from typing import Any

from extensions.ext_redis import get_pubsub_broadcast_channel
from libs.broadcast_channel.channel import Subscription, SupportsPreparedSubscription

_TOPIC_FMT = "dify_builder:{session_id}"


def _topic(session_id: str) -> str:
    return _TOPIC_FMT.format(session_id=session_id)


def publish(session_id: str, event: dict[str, Any]) -> None:
    """Publish ``event`` to ``session_id``'s progress topic, JSON-encoded."""
    get_pubsub_broadcast_channel().topic(_topic(session_id)).publish(json.dumps(event).encode())


def subscribe(session_id: str) -> Subscription:
    """Establish a lossless delivery boundary for ``session_id`` progress.

    Redis Streams can fix the boundary without starting their listener, so use
    ``prepare_subscription`` when the topic exposes that capability. Redis
    Pub/Sub has no replay boundary and must be entered eagerly so its SUBSCRIBE
    command completes before the Celery task can publish. The SSE generator
    consumes the returned subscription as-is and owns closing it.
    """
    subscriber = get_pubsub_broadcast_channel().topic(_topic(session_id)).as_subscriber()
    if isinstance(subscriber, SupportsPreparedSubscription):
        return subscriber.prepare_subscription()

    subscription = subscriber.subscribe()
    try:
        subscription.__enter__()
    except BaseException:
        subscription.close()
        raise
    return subscription
