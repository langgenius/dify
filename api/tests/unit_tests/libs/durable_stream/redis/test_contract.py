from typing import cast, override

from redis import Redis

from libs.durable_stream import DurableStreamSubscription, DurableStreamTopic, TopicCursor
from libs.durable_stream.redis import RedisDurableStreamTopic
from libs.durable_stream.redis.stream import _RedisDurableStreamSubscription
from tests.unit_tests.libs.durable_stream.contract import DurableStreamContract
from tests.unit_tests.libs.durable_stream.redis.fake_redis import FakeRedisDurableStream


class TestRedisDurableStreamContract(DurableStreamContract):
    def setup_method(self) -> None:
        self._redis = FakeRedisDurableStream()

    @override
    def create_topic(self, name: str) -> DurableStreamTopic:
        return RedisDurableStreamTopic(cast("Redis[bytes]", self._redis), name)

    @override
    def make_cursor_unavailable(self, topic: DurableStreamTopic, cursor: TopicCursor) -> None:
        assert isinstance(topic, RedisDurableStreamTopic)
        self._redis.delete_entry(topic._key, topic._decode_cursor(cursor))

    @override
    def fail_next_append(self, topic: DurableStreamTopic) -> None:
        del topic
        self._redis.fail_next_eval = True

    @override
    def fail_next_receive(self, subscription: DurableStreamSubscription) -> None:
        del subscription
        self._redis.fail_next_xread = True

    @override
    def fail_next_enter_after_acquiring_resources(self, subscription: DurableStreamSubscription) -> None:
        del subscription
        self._redis.fail_next_xrange = True

    @override
    def assert_subscription_resources_released(self, subscription: DurableStreamSubscription) -> None:
        assert isinstance(subscription, _RedisDurableStreamSubscription)
        assert subscription._closed
        assert not subscription._entered
