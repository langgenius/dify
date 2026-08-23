"""Session progress bus over the Redis broadcast channel.

The Celery advance task (Task 4) publishes progress events here; the P3c
SSE endpoint (not built yet) will subscribe to the same topic. In P3b this
module is publish-only — there is no subscriber, so correctness is just
"serialize the event and hand it to the right topic".

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
from libs.broadcast_channel.channel import Subscription

_TOPIC_FMT = "dify_builder:{session_id}"


def _topic(session_id: str) -> str:
    return _TOPIC_FMT.format(session_id=session_id)


def publish(session_id: str, event: dict[str, Any]) -> None:
    """Publish ``event`` to ``session_id``'s progress topic, JSON-encoded."""
    get_pubsub_broadcast_channel().topic(_topic(session_id)).publish(json.dumps(event).encode())


def subscribe(session_id: str) -> Subscription:
    """Subscribe to ``session_id``'s progress topic.

    Returns the channel's ``Subscription`` as-is; consumed by the P3c SSE
    endpoint.
    """
    return get_pubsub_broadcast_channel().topic(_topic(session_id)).subscribe()
