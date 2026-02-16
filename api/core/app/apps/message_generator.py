from collections.abc import Callable, Generator, Mapping

from core.app.apps.streaming_utils import stream_topic_events
from extensions.ext_redis import get_pubsub_broadcast_channel
from libs.broadcast_channel.channel import Topic
from models.model import AppMode


class MessageGenerator:
    @staticmethod
    def _make_channel_key(app_mode: AppMode, workflow_run_id: str):
        return f"channel:{app_mode}:{str(workflow_run_id)}"

    @classmethod
    def get_response_topic(cls, app_mode: AppMode, workflow_run_id: str) -> Topic:
        key = cls._make_channel_key(app_mode, workflow_run_id)
        channel = get_pubsub_broadcast_channel()
        topic = channel.topic(key)
        return topic

    @classmethod
    def retrieve_events(
        cls,
        app_mode: AppMode,
        workflow_run_id: str,
        idle_timeout=300,
        ping_interval: float = 10.0,
        on_subscribe: Callable[[], None] | None = None,
    ) -> Generator[Mapping | str, None, None]:
        topic = cls.get_response_topic(app_mode, workflow_run_id)
        return stream_topic_events(
            topic=topic,
            idle_timeout=idle_timeout,
            ping_interval=ping_interval,
            on_subscribe=on_subscribe,
        )
