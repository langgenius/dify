import asyncio
from collections.abc import Mapping
import json
from typing import cast

import pytest
from pydantic import JsonValue

from agenton.compositor import CompositorSessionSnapshot, LayerSessionSnapshot
from agenton.layers import LifecycleState
from dify_agent.protocol.schemas import (
    RunCancelledEvent,
    RunCancelledEventData,
    RunFailedEvent,
    RunFailedEventData,
    RunStartedEvent,
    RunStatus,
    RunSucceededEvent,
    RunSucceededEventData,
)
from dify_agent.runtime.event_sink import RunFinalizationResult
from dify_agent.storage.redis_run_store import DEFAULT_RUN_RETENTION_SECONDS, RedisRunStore, RunNotFoundError


class FakeRedis:
    commands: list[tuple[object, ...]]
    values: dict[str, object]
    streams: dict[str, list[tuple[str, dict[str, object]]]]

    def __init__(self) -> None:
        self.commands = []
        self.values = {}
        self.streams = {}
        self.stream_changed = asyncio.Event()

    async def set(self, key: str, value: object, *, ex: int | None = None) -> None:
        self.commands.append(("set", key, value, ex))
        self.values[key] = value

    async def get(self, key: str) -> object | None:
        self.commands.append(("get", key))
        return self.values.get(key)

    async def xadd(self, key: str, fields: Mapping[str, object]) -> str:
        self.commands.append(("xadd", key, dict(fields)))
        return self._append_stream_entry(key, fields)

    def pipeline(self, transaction: bool = True, shard_hint: str | None = None) -> "FakeRedisPipeline":
        self.commands.append(("pipeline", transaction, shard_hint))
        return FakeRedisPipeline(self)

    def _append_stream_entry(self, key: str, fields: Mapping[str, object]) -> str:
        entries = self.streams.setdefault(key, [])
        event_id = f"{len(entries) + 1}-0"
        entries.append((event_id, dict(fields)))
        self.stream_changed.set()
        return event_id

    async def xrevrange(
        self,
        key: str,
        max: str = "+",
        min: str = "-",
        *,
        count: int | None = None,
    ) -> list[tuple[str, dict[str, object]]]:
        self.commands.append(("xrevrange", key, max, min, count))
        entries = list(reversed(self.streams.get(key, [])))
        return entries[:count] if count is not None else entries

    async def xread(
        self,
        streams: Mapping[str, str],
        *,
        count: int | None = None,
        block: int | None = None,
    ) -> list[tuple[str, list[tuple[str, dict[str, object]]]]]:
        self.commands.append(("xread", dict(streams), count, block))
        while True:
            response: list[tuple[str, list[tuple[str, dict[str, object]]]]] = []
            for key, cursor in streams.items():
                entries = [
                    entry
                    for entry in self.streams.get(key, [])
                    if self._stream_id_value(entry[0]) > self._stream_id_value(cursor)
                ]
                if count is not None:
                    entries = entries[:count]
                if entries:
                    response.append((key, entries))
            if response:
                return response
            self.stream_changed.clear()
            await self.stream_changed.wait()

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

    async def eval(self, script: str, numkeys: int, *keys_and_args: object) -> list[object]:
        self.commands.append(("eval", script, numkeys, *keys_and_args))
        assert numkeys == 2
        record_key = str(keys_and_args[0])
        events_key = str(keys_and_args[1])
        status = str(keys_and_args[2])
        updated_at = str(keys_and_args[3])
        has_error = str(keys_and_args[4]) == "1"
        error = str(keys_and_args[5]) if has_error else None
        payload = str(keys_and_args[6])
        record_json = self.values.get(record_key)
        if record_json is None:
            return [-1, "", ""]
        if isinstance(record_json, bytes):
            record_json = record_json.decode()
        record = json.loads(cast(str, record_json))
        if record["status"] != "running":
            return [0, record["status"], ""]

        record.update({"status": status, "updated_at": updated_at, "error": error})
        event_id = self._append_stream_entry(events_key, {"payload": payload})
        self.values[record_key] = json.dumps(record, separators=(",", ":"))
        return [1, status, event_id]

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


class FakeRedisPipeline:
    redis: FakeRedis
    results: list[object]

    def __init__(self, redis: FakeRedis) -> None:
        self.redis = redis
        self.results = []

    async def __aenter__(self) -> "FakeRedisPipeline":
        return self

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None:
        del exc_type, exc, traceback

    def xadd(self, key: str, fields: Mapping[str, object]) -> "FakeRedisPipeline":
        self.redis.commands.append(("xadd", key, dict(fields)))
        self.results.append(self.redis._append_stream_entry(key, fields))
        return self

    def expire(self, key: str, seconds: int) -> "FakeRedisPipeline":
        self.redis.commands.append(("expire", key, seconds))
        self.results.append(True)
        return self

    async def execute(self) -> list[object]:
        self.redis.commands.append(("execute",))
        return list(self.results)


def _terminal_event(
    event_type: str,
    run_id: str,
) -> RunSucceededEvent | RunFailedEvent | RunCancelledEvent:
    if event_type == "run_succeeded":
        return RunSucceededEvent(
            run_id=run_id,
            data=RunSucceededEventData(
                output="done",
                session_snapshot=CompositorSessionSnapshot(layers=[]),
            ),
        )
    if event_type == "run_failed":
        return RunFailedEvent(run_id=run_id, data=RunFailedEventData(error="model failed"))
    if event_type == "run_cancelled":
        return RunCancelledEvent(run_id=run_id, data=RunCancelledEventData(reason="cancelled"))
    raise AssertionError(f"unexpected terminal event type: {event_type}")


def test_create_run_writes_running_record_without_job_queue_and_with_retention() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    record = asyncio.run(store.create_run())

    assert record.status == "running"
    assert [command[0] for command in redis.commands] == ["set"]
    assert redis.commands[0][1] == f"test:runs:{record.run_id}:record"
    assert redis.commands[0][3] == DEFAULT_RUN_RETENTION_SECONDS
    assert "request" not in str(redis.commands[0][2])


def test_finalize_run_atomically_writes_terminal_event_and_status() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test", run_retention_seconds=60)  # pyright: ignore[reportArgumentType]
    record = asyncio.run(store.create_run())
    redis.commands.clear()
    event = RunCancelledEvent(
        run_id=record.run_id,
        data=RunCancelledEventData(reason="workflow_aborted", message="workflow stopped"),
    )

    result = asyncio.run(store.finalize_run(event))
    updated = asyncio.run(store.get_run(record.run_id))

    assert result.applied is True
    assert result.status == "cancelled"
    assert result.event_id == "1-0"
    assert updated.status == "cancelled"
    assert updated.error == "workflow stopped"
    assert updated.updated_at == event.created_at
    stream_entry_id, stream_fields = redis.streams[f"test:runs:{record.run_id}:events"][0]
    assert stream_entry_id == result.event_id
    payload = json.loads(cast(str, stream_fields["payload"]))
    assert "id" not in payload
    assert payload["type"] == "run_cancelled"
    assert payload["data"] == {"reason": "workflow_aborted", "message": "workflow stopped"}
    assert payload["created_at"] == event.created_at.isoformat().replace("+00:00", "Z")
    eval_command = redis.commands[0]
    assert eval_command[0] == "eval"
    assert eval_command[2] == 2
    assert eval_command[-1] == "60"


def test_finalize_run_rejects_a_second_terminal_without_appending_event() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test", run_retention_seconds=60)  # pyright: ignore[reportArgumentType]
    record = asyncio.run(store.create_run())
    snapshot = CompositorSessionSnapshot(layers=[])

    first = asyncio.run(
        store.finalize_run(
            RunSucceededEvent(
                run_id=record.run_id,
                data=RunSucceededEventData(output="done", session_snapshot=snapshot),
            )
        )
    )
    second = asyncio.run(
        store.finalize_run(
            RunCancelledEvent(
                run_id=record.run_id,
                data=RunCancelledEventData(reason="late_cancel"),
            )
        )
    )

    assert first.applied is True
    assert second.applied is False
    assert second.status == "succeeded"
    assert second.event_id is None
    assert len(redis.streams[f"test:runs:{record.run_id}:events"]) == 1


def test_finalize_failed_run_derives_error_and_timestamp_from_event() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]
    record = asyncio.run(store.create_run())
    event = RunFailedEvent(
        run_id=record.run_id,
        data=RunFailedEventData(error="model failed", reason="model_error"),
    )

    result = asyncio.run(store.finalize_run(event))
    updated = asyncio.run(store.get_run(record.run_id))

    assert result.applied is True
    assert result.status == "failed"
    assert updated.status == "failed"
    assert updated.error == "model failed"
    assert updated.updated_at == event.created_at


def test_two_store_instances_choose_exactly_one_terminal_winner() -> None:
    redis = FakeRedis()
    first_store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]
    second_store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> tuple[list[RunFinalizationResult], RunStatus, list[str]]:
        record = await first_store.create_run()
        snapshot = CompositorSessionSnapshot(layers=[])
        results = await asyncio.gather(
            first_store.finalize_run(
                RunSucceededEvent(
                    run_id=record.run_id,
                    data=RunSucceededEventData(output="done", session_snapshot=snapshot),
                )
            ),
            second_store.finalize_run(
                RunCancelledEvent(
                    run_id=record.run_id,
                    data=RunCancelledEventData(reason="concurrent_cancel"),
                )
            ),
        )
        persisted = await first_store.get_run(record.run_id)
        page = await second_store.get_events(record.run_id)
        return list(results), persisted.status, [event.type for event in page.events]

    results, status, event_types = asyncio.run(scenario())

    assert sum(result.applied for result in results) == 1
    assert len(event_types) == 1
    assert (status, event_types[0]) in {
        ("succeeded", "run_succeeded"),
        ("cancelled", "run_cancelled"),
    }


def test_failure_and_cancellation_compete_for_one_terminal() -> None:
    redis = FakeRedis()
    failure_store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]
    cancellation_store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> tuple[list[RunFinalizationResult], RunStatus, list[str]]:
        record = await failure_store.create_run()
        results = await asyncio.gather(
            failure_store.finalize_run(
                RunFailedEvent(
                    run_id=record.run_id,
                    data=RunFailedEventData(error="model failed", reason="model_error"),
                )
            ),
            cancellation_store.finalize_run(
                RunCancelledEvent(
                    run_id=record.run_id,
                    data=RunCancelledEventData(reason="concurrent_cancel"),
                )
            ),
        )
        persisted = await failure_store.get_run(record.run_id)
        page = await cancellation_store.get_events(record.run_id)
        return list(results), persisted.status, [event.type for event in page.events]

    results, status, event_types = asyncio.run(scenario())

    assert sum(result.applied for result in results) == 1
    assert len(event_types) == 1
    assert (status, event_types[0]) in {
        ("failed", "run_failed"),
        ("cancelled", "run_cancelled"),
    }


def test_finalize_run_raises_when_record_is_missing() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    with pytest.raises(RunNotFoundError):
        asyncio.run(
            store.finalize_run(RunCancelledEvent(run_id="missing", data=RunCancelledEventData(reason="cancelled")))
        )


def test_wait_for_cancellation_observes_terminal_record_before_starting() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> bool:
        record = await store.create_run()
        _ = await store.finalize_run(
            RunCancelledEvent(run_id=record.run_id, data=RunCancelledEventData(reason="cancelled"))
        )
        redis.commands.clear()
        return await store.wait_for_cancellation(record.run_id)

    assert asyncio.run(scenario()) is True
    assert [command[0] for command in redis.commands] == ["xrevrange", "get"]


def test_wait_for_cancellation_covers_terminal_transition_during_initialization() -> None:
    class PausingRecordReadRedis(FakeRedis):
        record_read_started: asyncio.Event
        release_record_read: asyncio.Event
        pause_next_record_read: bool

        def __init__(self) -> None:
            super().__init__()
            self.record_read_started = asyncio.Event()
            self.release_record_read = asyncio.Event()
            self.pause_next_record_read = True

        async def get(self, key: str) -> object | None:
            if self.pause_next_record_read and key.endswith(":record"):
                self.pause_next_record_read = False
                self.record_read_started.set()
                await self.release_record_read.wait()
            return await super().get(key)

    redis = PausingRecordReadRedis()
    observer_store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]
    cancelling_store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> bool:
        record = await observer_store.create_run()
        observer = asyncio.create_task(observer_store.wait_for_cancellation(record.run_id))
        await asyncio.wait_for(redis.record_read_started.wait(), timeout=1)
        _ = await cancelling_store.finalize_run(
            RunCancelledEvent(run_id=record.run_id, data=RunCancelledEventData(reason="cancelled"))
        )
        redis.release_record_read.set()
        return await asyncio.wait_for(observer, timeout=1)

    assert asyncio.run(scenario()) is True


def test_wait_for_cancellation_advances_past_non_terminal_events() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> bool:
        record = await store.create_run()
        observer = asyncio.create_task(store.wait_for_cancellation(record.run_id))
        await asyncio.sleep(0)
        _ = await store.append_event(RunStartedEvent(run_id=record.run_id))
        await asyncio.sleep(0)
        _ = await store.finalize_run(
            RunCancelledEvent(run_id=record.run_id, data=RunCancelledEventData(reason="cancelled"))
        )
        return await asyncio.wait_for(observer, timeout=1)

    assert asyncio.run(scenario()) is True
    cursors = [command[1] for command in redis.commands if command[0] == "xread"]
    assert any("0-0" in streams.values() for streams in cursors if isinstance(streams, dict))
    assert any("1-0" in streams.values() for streams in cursors if isinstance(streams, dict))


def test_wait_for_cancellation_returns_false_when_success_wins() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> bool:
        record = await store.create_run()
        observer = asyncio.create_task(store.wait_for_cancellation(record.run_id))
        await asyncio.sleep(0)
        _ = await store.finalize_run(
            RunSucceededEvent(
                run_id=record.run_id,
                data=RunSucceededEventData(
                    output="done",
                    session_snapshot=CompositorSessionSnapshot(layers=[]),
                ),
            )
        )
        return await asyncio.wait_for(observer, timeout=1)

    assert asyncio.run(scenario()) is False


def test_append_event_serializes_typed_event_without_id_and_expires_run_keys() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test", run_retention_seconds=60)  # pyright: ignore[reportArgumentType]

    event_id = asyncio.run(store.append_event(RunStartedEvent(id="local", run_id="run-1")))

    assert event_id == "1-0"
    pipeline_commands = [command for command in redis.commands if command[0] == "pipeline"]
    assert len(pipeline_commands) == 1
    assert pipeline_commands[0][1] is True
    xadd_commands = [command for command in redis.commands if command[0] == "xadd"]
    assert len(xadd_commands) == 1
    fields = xadd_commands[0][2]
    assert isinstance(fields, dict)
    assert '"id"' not in str(fields["payload"])
    assert '"type":"run_started"' in str(fields["payload"])
    expire_commands = {command for command in redis.commands if command[0] == "expire"}
    assert expire_commands == {
        ("expire", "test:runs:run-1:events", 60),
        ("expire", "test:runs:run-1:record", 60),
    }
    assert ("execute",) in redis.commands


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
        result = await store.finalize_run(
            RunSucceededEvent(
                id="local-only",
                run_id=record.run_id,
                data=RunSucceededEventData(output=output, session_snapshot=session_snapshot),
            )
        )
        assert result.event_id is not None
        page = await store.get_events(record.run_id, after="0-0", limit=10)
        decoded = page.events[0]
        assert isinstance(decoded, RunSucceededEvent)
        assert page.next_cursor == result.event_id
        return result.event_id, decoded

    event_id, decoded = asyncio.run(scenario())

    assert decoded.id == event_id
    assert decoded.data.output == output
    assert decoded.data.session_snapshot == session_snapshot


@pytest.mark.parametrize("terminal_type", ["run_succeeded", "run_failed", "run_cancelled"])
def test_iter_events_ends_after_replaying_terminal_event(terminal_type: str) -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> list[str]:
        record = await store.create_run()
        _ = await store.append_event(RunStartedEvent(run_id=record.run_id))
        _ = await store.finalize_run(_terminal_event(terminal_type, record.run_id))
        redis.commands.clear()

        async def collect_events() -> list[str]:
            return [event.type async for event in store.iter_events(record.run_id)]

        return await asyncio.wait_for(collect_events(), timeout=1)

    event_types = asyncio.run(scenario())

    assert event_types == ["run_started", terminal_type]
    assert "xread" not in [command[0] for command in redis.commands]


@pytest.mark.parametrize("terminal_type", ["run_succeeded", "run_failed", "run_cancelled"])
def test_iter_events_ends_after_live_terminal_event(terminal_type: str) -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> str:
        record = await store.create_run()
        events = store.iter_events(record.run_id)
        next_event = asyncio.ensure_future(anext(events))
        await asyncio.sleep(0)
        assert not next_event.done()
        assert "xread" in [command[0] for command in redis.commands]

        _ = await store.finalize_run(_terminal_event(terminal_type, record.run_id))
        event = await asyncio.wait_for(next_event, timeout=1)
        with pytest.raises(StopAsyncIteration):
            _ = await anext(events)
        return event.type

    assert asyncio.run(scenario()) == terminal_type
