"""`publish_many` sends several messages of one topic in a single round trip, in order."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import TYPE_CHECKING, override

import pytest
from redis import Redis, RedisCluster

from libs.broadcast_channel.redis.pubsub_channel import Topic
from libs.broadcast_channel.redis.sharded_channel import ShardedTopic
from libs.broadcast_channel.redis.streams_channel import StreamsTopic

type _Command = tuple[str, str, bytes]


class _RoundTrips:
    """What reached the server, one list of commands per round trip."""

    def __init__(self) -> None:
        self.round_trips: list[list[_Command]] = []
        self.pipelines_in_a_transaction: list[bool] = []
        self.stream_length_limits: set[int | None] = set()
        self.retention_seconds: list[int] = []

    def single(self, name: str, key: str, payload: bytes) -> None:
        self.round_trips.append([(name, key, payload)])

    def stream_entry(self, key: str, fields: dict[bytes, bytes], maxlen: int | None) -> None:
        self.stream_length_limits.add(maxlen)
        self.single("XADD", key, fields[b"data"])

    def retention(self, key: str, seconds: int) -> None:
        self.retention_seconds.append(seconds)
        self.single("EXPIRE", key, b"")

    def pipeline(self, transaction: bool) -> _RecordingPipeline:
        self.pipelines_in_a_transaction.append(transaction)
        return _RecordingPipeline(self)


class _RecordingPipeline:
    def __init__(self, sent: _RoundTrips) -> None:
        self._sent = sent
        self._commands: list[_Command] = []

    def publish(self, channel: str, payload: bytes) -> None:
        self._commands.append(("PUBLISH", channel, payload))

    def execute_command(self, name: str, channel: str, payload: bytes) -> None:
        self._commands.append((name, channel, payload))

    def xadd(self, key: str, fields: dict[bytes, bytes], *, maxlen: int | None = None) -> None:
        self._sent.stream_length_limits.add(maxlen)
        self._commands.append(("XADD", key, fields[b"data"]))

    def execute(self) -> list[int]:
        self._sent.round_trips.append(self._commands)
        return [1] * len(self._commands)


if TYPE_CHECKING:
    _ClusterBase = RedisCluster[bytes]
else:
    _ClusterBase = RedisCluster


class _UnconnectedCluster(_ClusterBase):
    """A cluster client that never looks for its nodes."""

    def __init__(self) -> None:
        pass

    @override
    def __del__(self) -> None:
        pass


def _record_commands(
    client: Redis[bytes] | RedisCluster[bytes], sent: _RoundTrips, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(client, "publish", lambda channel, payload: sent.single("PUBLISH", channel, payload))
    monkeypatch.setattr(client, "spublish", lambda channel, payload: sent.single("SPUBLISH", channel, payload))
    monkeypatch.setattr(client, "xadd", lambda key, fields, maxlen=None: sent.stream_entry(key, fields, maxlen))
    monkeypatch.setattr(client, "expire", sent.retention)
    monkeypatch.setattr(client, "pipeline", lambda transaction=True: sent.pipeline(transaction))


@pytest.fixture
def sent() -> _RoundTrips:
    return _RoundTrips()


@pytest.fixture
def client(sent: _RoundTrips, monkeypatch: pytest.MonkeyPatch) -> Iterator[Redis[bytes]]:
    redis_client = Redis()
    _record_commands(redis_client, sent, monkeypatch)
    try:
        yield redis_client
    finally:
        redis_client.close()


@pytest.fixture
def cluster_client(sent: _RoundTrips, monkeypatch: pytest.MonkeyPatch) -> RedisCluster[bytes]:
    redis_client = _UnconnectedCluster()
    _record_commands(redis_client, sent, monkeypatch)
    return redis_client


def test_pubsub_topic_sends_messages_in_one_round_trip_in_order(client: Redis[bytes], sent: _RoundTrips) -> None:
    Topic(client, "run-1").publish_many([b"a", b"b", b"c"])

    assert sent.round_trips == [[("PUBLISH", "run-1", b"a"), ("PUBLISH", "run-1", b"b"), ("PUBLISH", "run-1", b"c")]]
    assert sent.pipelines_in_a_transaction == [False]


def test_sharded_topic_sends_messages_in_one_round_trip_in_order(client: Redis[bytes], sent: _RoundTrips) -> None:
    ShardedTopic(client, "run-1").publish_many([b"a", b"b"])

    assert sent.round_trips == [[("SPUBLISH", "run-1", b"a"), ("SPUBLISH", "run-1", b"b")]]
    assert sent.pipelines_in_a_transaction == [False]


def test_streams_topic_appends_messages_in_one_round_trip_and_refreshes_retention_once(
    client: Redis[bytes], sent: _RoundTrips
) -> None:
    topic = StreamsTopic(client, "run-1", retention_seconds=60)

    topic.publish_many([b"a", b"b"])

    assert sent.round_trips == [
        [("XADD", "stream:run-1", b"a"), ("XADD", "stream:run-1", b"b")],
        [("EXPIRE", "stream:run-1", b"")],
    ]
    assert sent.pipelines_in_a_transaction == [False]
    assert sent.stream_length_limits == {topic.max_length}
    assert sent.retention_seconds == [60]


def test_streams_topic_without_retention_only_appends(client: Redis[bytes], sent: _RoundTrips) -> None:
    StreamsTopic(client, "run-1", retention_seconds=0).publish_many([b"a", b"b"])

    assert sent.round_trips == [[("XADD", "stream:run-1", b"a"), ("XADD", "stream:run-1", b"b")]]


@pytest.mark.parametrize("payloads", [[], [b"only"]])
def test_fewer_than_two_messages_are_published_the_plain_way(
    client: Redis[bytes], sent: _RoundTrips, payloads: list[bytes]
) -> None:
    Topic(client, "run-1").publish_many(payloads)
    ShardedTopic(client, "run-1").publish_many(payloads)
    StreamsTopic(client, "run-1", retention_seconds=0).publish_many(payloads)

    assert sent.round_trips == [
        [(name, key, payload)]
        for name, key in (("PUBLISH", "run-1"), ("SPUBLISH", "run-1"), ("XADD", "stream:run-1"))
        for payload in payloads
    ]


def test_a_cluster_client_keeps_one_command_per_message(cluster_client: RedisCluster[bytes], sent: _RoundTrips) -> None:
    Topic(cluster_client, "run-1").publish_many([b"a", b"b"])
    ShardedTopic(cluster_client, "run-1").publish_many([b"a", b"b"])
    StreamsTopic(cluster_client, "run-1", retention_seconds=0).publish_many([b"a", b"b"])

    assert sent.round_trips == [
        [("PUBLISH", "run-1", b"a")],
        [("PUBLISH", "run-1", b"b")],
        [("SPUBLISH", "run-1", b"a")],
        [("SPUBLISH", "run-1", b"b")],
        [("XADD", "stream:run-1", b"a")],
        [("XADD", "stream:run-1", b"b")],
    ]


def test_messages_carry_the_configured_key_prefix(
    client: Redis[bytes], sent: _RoundTrips, config_overrides: Callable[..., None]
) -> None:
    config_overrides(REDIS_KEY_PREFIX="enterprise-a")

    Topic(client, "run-1").publish_many([b"a", b"b"])

    assert sent.round_trips == [[("PUBLISH", "enterprise-a:run-1", b"a"), ("PUBLISH", "enterprise-a:run-1", b"b")]]
