import json
import time
from collections.abc import Callable, Generator, Mapping
from typing import Any

from core.app.entities.task_entities import (
    StreamEvent,
)
from extensions.ext_redis import redis_client
from libs.broadcast_channel.channel import Topic
from libs.broadcast_channel.exc import SubscriptionClosedError
from libs.broadcast_channel.redis.channel import BroadcastChannel as RedisBroadcastChannel
from models.model import AppMode


class MessageGenerator:
    @staticmethod
    def _make_channel_key(app_mode: AppMode, workflow_run_id: str):
        return f"channel:{app_mode}:{str(workflow_run_id)}"

    @classmethod
    def get_response_topic(cls, app_mode: AppMode, workflow_run_id: str) -> Topic:
        key = cls._make_channel_key(app_mode, workflow_run_id)
        channel = RedisBroadcastChannel(redis_client)
        topic = channel.topic(key)
        return topic

    @classmethod
    def retrieve_events(
        cls,
        app_mode: AppMode,
        workflow_run_id: str,
        idle_timeout=300,
        on_subscribe: Callable[[], None] | None = None,
    ) -> Generator[Mapping | str, None, None]:
        topic = cls.get_response_topic(app_mode, workflow_run_id)
        return _topic_msg_generator(topic, idle_timeout, on_subscribe)


def _topic_msg_generator(
    topic: Topic,
    idle_timeout: float,
    on_subscribe: Callable[[], None] | None = None,
) -> Generator[Mapping[str, Any], None, None]:
    last_msg_time = time.time()
    with topic.subscribe() as sub:
        # on_subscribe fires only after the Redis subscription is active.
        # This is used to gate task start and reduce pub/sub race for the first event.
        if on_subscribe is not None:
            on_subscribe()
        while True:
            try:
                msg = sub.receive()
            except SubscriptionClosedError:
                return
            if msg is None:
                current_time = time.time()
                if current_time - last_msg_time > idle_timeout:
                    return
                # skip the `None` message
                continue

            last_msg_time = time.time()
            event = json.loads(msg)
            yield event
            if not isinstance(event, dict):
                continue

            event_type = event.get("event")
            if event_type in (StreamEvent.WORKFLOW_FINISHED, StreamEvent.WORKFLOW_PAUSED):
                return
