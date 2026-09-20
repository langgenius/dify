"""channel unit tests tests."""

from unittest.mock import MagicMock

import pytest

from libs.broadcast_channel.redis.pubsub_channel import (
    BroadcastChannel as RedisBroadcastChannel,
)
from libs.broadcast_channel.redis.pubsub_channel import Topic
from libs.broadcast_channel.redis.sharded_channel import (
    ShardedRedisBroadcastChannel,
    ShardedTopic,
    _RedisShardedSubscription,
)


class TestBroadcastChannel:
    """Test cases for the main BroadcastChannel class."""

    @pytest.fixture
    def mock_redis_client(self) -> MagicMock:
        """Create a mock Redis client for testing."""
        client = MagicMock()
        client.pubsub.return_value = MagicMock()
        return client

    @pytest.fixture
    def broadcast_channel(self, mock_redis_client: MagicMock) -> RedisBroadcastChannel:
        """Create a BroadcastChannel instance with mock Redis client (regular)."""
        return RedisBroadcastChannel(mock_redis_client)

    @pytest.fixture
    def sharded_broadcast_channel(self, mock_redis_client: MagicMock) -> ShardedRedisBroadcastChannel:
        """Create a ShardedRedisBroadcastChannel instance with mock Redis client."""
        return ShardedRedisBroadcastChannel(mock_redis_client)

    def test_topic_creation(self, broadcast_channel: RedisBroadcastChannel, mock_redis_client: MagicMock):
        """Test that topic() method returns a Topic instance with correct parameters."""
        topic_name = "test-topic"
        topic = broadcast_channel.topic(topic_name)

        assert isinstance(topic, Topic)
        assert topic._client == mock_redis_client
        assert topic._topic == topic_name

    def test_topic_isolation(self, broadcast_channel: RedisBroadcastChannel):
        """Test that different topic names create isolated Topic instances."""
        topic1 = broadcast_channel.topic("topic1")
        topic2 = broadcast_channel.topic("topic2")

        assert topic1 is not topic2
        assert topic1._topic == "topic1"
        assert topic2._topic == "topic2"

    def test_sharded_topic_creation(
        self, sharded_broadcast_channel: ShardedRedisBroadcastChannel, mock_redis_client: MagicMock
    ):
        """Test that topic() on ShardedRedisBroadcastChannel returns a ShardedTopic instance with correct parameters."""
        topic_name = "test-sharded-topic"
        sharded_topic = sharded_broadcast_channel.topic(topic_name)

        assert isinstance(sharded_topic, ShardedTopic)
        assert sharded_topic._client == mock_redis_client
        assert sharded_topic._topic == topic_name

    def test_sharded_topic_isolation(self, sharded_broadcast_channel: ShardedRedisBroadcastChannel):
        """Test that different sharded topic names create isolated ShardedTopic instances."""
        topic1 = sharded_broadcast_channel.topic("sharded-topic1")
        topic2 = sharded_broadcast_channel.topic("sharded-topic2")

        assert topic1 is not topic2
        assert topic1._topic == "sharded-topic1"
        assert topic2._topic == "sharded-topic2"

    def test_regular_and_sharded_topic_isolation(
        self, broadcast_channel: RedisBroadcastChannel, sharded_broadcast_channel: ShardedRedisBroadcastChannel
    ):
        """Test that regular topics and sharded topics from different channels are separate instances."""
        regular_topic = broadcast_channel.topic("test-topic")
        sharded_topic = sharded_broadcast_channel.topic("test-topic")

        assert isinstance(regular_topic, Topic)
        assert isinstance(sharded_topic, ShardedTopic)
        assert regular_topic is not sharded_topic
        assert regular_topic._topic == sharded_topic._topic


class TestTopic:
    """Test cases for the Topic class."""

    @pytest.fixture
    def mock_redis_client(self) -> MagicMock:
        """Create a mock Redis client for testing."""
        client = MagicMock()
        client.pubsub.return_value = MagicMock()
        return client

    @pytest.fixture
    def topic(self, mock_redis_client: MagicMock) -> Topic:
        """Create a Topic instance for testing."""
        return Topic(mock_redis_client, "test-topic")

    def test_as_producer_returns_self(self, topic: Topic):
        """Test that as_producer() returns self as Producer interface."""
        producer = topic.as_producer()
        assert producer is topic
        # Producer is a Protocol, check duck typing instead
        assert hasattr(producer, "publish")

    def test_as_subscriber_returns_self(self, topic: Topic):
        """Test that as_subscriber() returns self as Subscriber interface."""
        subscriber = topic.as_subscriber()
        assert subscriber is topic
        # Subscriber is a Protocol, check duck typing instead
        assert hasattr(subscriber, "subscribe")

    def test_publish_calls_redis_publish(self, topic: Topic, mock_redis_client: MagicMock):
        """Test that publish() calls Redis PUBLISH with correct parameters."""
        payload = b"test message"
        topic.publish(payload)

        mock_redis_client.publish.assert_called_once_with("test-topic", payload)

    def test_publish_prefixes_regular_topic(self, mock_redis_client: MagicMock, config_overrides):
        config_overrides(REDIS_KEY_PREFIX="enterprise-a")
        topic = Topic(mock_redis_client, "test-topic")
        topic.publish(b"test message")

        mock_redis_client.publish.assert_called_once_with("enterprise-a:test-topic", b"test message")

    def test_subscribe_prefixes_regular_topic(self, mock_redis_client: MagicMock, config_overrides):
        config_overrides(REDIS_KEY_PREFIX="enterprise-a")
        topic = Topic(mock_redis_client, "test-topic")
        subscription = topic.subscribe()
        try:
            subscription._start_if_needed()
        finally:
            subscription.close()

        mock_redis_client.pubsub.return_value.subscribe.assert_called_once_with("enterprise-a:test-topic")


class TestShardedTopic:
    """Test cases for the ShardedTopic class."""

    @pytest.fixture
    def mock_redis_client(self) -> MagicMock:
        """Create a mock Redis client for testing."""
        client = MagicMock()
        client.pubsub.return_value = MagicMock()
        return client

    @pytest.fixture
    def sharded_topic(self, mock_redis_client: MagicMock) -> ShardedTopic:
        """Create a ShardedTopic instance for testing."""
        return ShardedTopic(mock_redis_client, "test-sharded-topic")

    def test_as_producer_returns_self(self, sharded_topic: ShardedTopic):
        """Test that as_producer() returns self as Producer interface."""
        producer = sharded_topic.as_producer()
        assert producer is sharded_topic
        # Producer is a Protocol, check duck typing instead
        assert hasattr(producer, "publish")

    def test_as_subscriber_returns_self(self, sharded_topic: ShardedTopic):
        """Test that as_subscriber() returns self as Subscriber interface."""
        subscriber = sharded_topic.as_subscriber()
        assert subscriber is sharded_topic
        # Subscriber is a Protocol, check duck typing instead
        assert hasattr(subscriber, "subscribe")

    def test_publish_calls_redis_spublish(self, sharded_topic: ShardedTopic, mock_redis_client: MagicMock):
        """Test that publish() calls Redis SPUBLISH with correct parameters."""
        payload = b"test sharded message"
        sharded_topic.publish(payload)

        mock_redis_client.spublish.assert_called_once_with("test-sharded-topic", payload)

    def test_publish_prefixes_sharded_topic(self, mock_redis_client: MagicMock, config_overrides):
        config_overrides(REDIS_KEY_PREFIX="enterprise-a")
        sharded_topic = ShardedTopic(mock_redis_client, "test-sharded-topic")
        sharded_topic.publish(b"test sharded message")

        mock_redis_client.spublish.assert_called_once_with("enterprise-a:test-sharded-topic", b"test sharded message")

    def test_subscribe_returns_sharded_subscription(self, sharded_topic: ShardedTopic, mock_redis_client: MagicMock):
        """Test that subscribe() returns a _RedisShardedSubscription instance."""
        subscription = sharded_topic.subscribe()

        assert isinstance(subscription, _RedisShardedSubscription)
        assert subscription._client is mock_redis_client
        assert subscription._pubsub is mock_redis_client.pubsub.return_value
        assert subscription._topic == "test-sharded-topic"

    def test_subscribe_prefixes_sharded_topic(self, mock_redis_client: MagicMock, config_overrides):
        config_overrides(REDIS_KEY_PREFIX="enterprise-a")
        sharded_topic = ShardedTopic(mock_redis_client, "test-sharded-topic")
        subscription = sharded_topic.subscribe()
        try:
            subscription._start_if_needed()
        finally:
            subscription.close()

        mock_redis_client.pubsub.return_value.ssubscribe.assert_called_once_with("enterprise-a:test-sharded-topic")
