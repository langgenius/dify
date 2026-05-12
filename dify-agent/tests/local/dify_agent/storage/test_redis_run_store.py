import asyncio
from collections.abc import Mapping
from typing import cast

from pydantic import JsonValue

from agenton.compositor import CompositorSessionSnapshot, LayerSessionSnapshot
from agenton.layers import LifecycleState
from dify_agent.protocol.schemas import RunStartedEvent, RunSucceededEvent, RunSucceededEventData
from dify_agent.storage.redis_run_store import DEFAULT_RUN_RETENTION_SECONDS, RedisRunStore


class FakeRedis:
    commands: list[tuple[object, ...]]
    values: dict[str, object]
    streams: dict[str, list[tuple[str, dict[str, object]]]]

    def __init__(self) -> None:
        self.commands = []
        self.values = {}
        self.streams = {}

    async def set(self, key: str, value: object, *, ex: int | None = None) -> None:
        self.commands.append(("set", key, value, ex))
        self.values[key] = value

    async def get(self, key: str) -> object | None:
        self.commands.append(("get", key))
        return self.values.get(key)

    async def xadd(self, key: str, fields: Mapping[str, object]) -> str:
        self.commands.append(("xadd", key, dict(fields)))
        entries = self.streams.setdefault(key, [])
        event_id = f"{len(entries) + 1}-0"
        entries.append((event_id, dict(fields)))
        return event_id

    async def xrange(
        self, key: str, *, min: str = "-", count: int | None = None
    ) -> list[tuple[str, dict[str, object]]]:
        self.commands.append(("xrange", key, min, count))
        entries = [entry for entry in self.streams.get(key, []) if self._is_after_min(entry[0], min)]
        if count is not None:
            return entries[:count]
        return entries

    async def expire(self, key: str, seconds: int) -> bool:
        self.commands.append(("expire", key, seconds))
        return True

    @staticmethod
    def _is_after_min(event_id: str, min_id: str) -> bool:
        if min_id == "-":
            return True
        is_exclusive = min_id.startswith("(")
        cursor = min_id[1:] if is_exclusive else min_id
        event_value = FakeRedis._stream_id_value(event_id)
        cursor_value = FakeRedis._stream_id_value(cursor)
        return event_value > cursor_value if is_exclusive else event_value >= cursor_value

    @staticmethod
    def _stream_id_value(event_id: str) -> tuple[int, int]:
        timestamp, sequence = event_id.split("-", maxsplit=1)
        return int(timestamp), int(sequence)


def test_create_run_writes_running_record_without_job_queue_and_with_retention() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    record = asyncio.run(store.create_run())

    assert record.status == "running"
    assert [command[0] for command in redis.commands] == ["set"]
    assert redis.commands[0][1] == f"test:runs:{record.run_id}:record"
    assert redis.commands[0][3] == DEFAULT_RUN_RETENTION_SECONDS
    assert "request" not in str(redis.commands[0][2])


def test_update_status_refreshes_record_retention() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test", run_retention_seconds=60)  # pyright: ignore[reportArgumentType]
    record = asyncio.run(store.create_run())
    redis.commands.clear()

    asyncio.run(store.update_status(record.run_id, "succeeded"))

    assert [command[0] for command in redis.commands] == ["get", "set"]
    assert redis.commands[1][1] == f"test:runs:{record.run_id}:record"
    assert redis.commands[1][3] == 60


def test_append_event_serializes_typed_event_without_id_and_expires_run_keys() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test", run_retention_seconds=60)  # pyright: ignore[reportArgumentType]

    event_id = asyncio.run(store.append_event(RunStartedEvent(id="local", run_id="run-1")))

    assert event_id == "1-0"
    assert redis.commands[0][0] == "xadd"
    fields = redis.commands[0][2]
    assert isinstance(fields, dict)
    assert '"id"' not in str(fields["payload"])
    assert '"type":"run_started"' in str(fields["payload"])
    assert redis.commands[1:] == [
        ("expire", "test:runs:run-1:events", 60),
        ("expire", "test:runs:run-1:record", 60),
    ]


def test_get_events_round_trips_run_succeeded_output_and_session_snapshot() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test", run_retention_seconds=60)  # pyright: ignore[reportArgumentType]
    output = cast(JsonValue, {"answer": ["done", 1], "ok": True})
    session_snapshot = CompositorSessionSnapshot(
        layers=[
            LayerSessionSnapshot(
                name="prompt",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={"resource_id": "abc"},
            )
        ]
    )

    async def scenario() -> tuple[str, RunSucceededEvent]:
        record = await store.create_run()
        event_id = await store.append_event(
            RunSucceededEvent(
                id="local-only",
                run_id=record.run_id,
                data=RunSucceededEventData(output=output, session_snapshot=session_snapshot),
            )
        )
        page = await store.get_events(record.run_id, after="0-0", limit=10)
        decoded = page.events[0]
        assert isinstance(decoded, RunSucceededEvent)
        assert page.next_cursor == event_id
        return event_id, decoded

    event_id, decoded = asyncio.run(scenario())

    assert decoded.id == event_id
    assert decoded.data.output == output
    assert decoded.data.session_snapshot == session_snapshot
