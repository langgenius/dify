import asyncio
from collections.abc import Mapping
import json
from typing import cast

import pytest
from pydantic import JsonValue

from agenton.compositor import CompositorSessionSnapshot, LayerSessionSnapshot
from agenton.layers import LifecycleState
from dify_agent.protocol.schemas import (
    AgentRunUsage,
    RUN_EVENT_ADAPTER,
    CancelRunRequest,
    RunCancelledEvent,
    RunCancelledEventData,
    RunFailedEvent,
    RunFailedEventData,
    RunFailureType,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
    utc_now,
)
from dify_agent.runtime.cancellation import RunCancellationIntent
from dify_agent.runtime.event_sink import RunFinalizationResult
from dify_agent.storage.redis_run_store import DEFAULT_RUN_RETENTION_SECONDS, RedisRunStore, RunNotFoundError


class FakeRedis:
    commands: list[tuple[object, ...]]
    values: dict[str, object]
    streams: dict[str, list[tuple[str, dict[str, object]]]]
    eval_result: list[object] | None

    def __init__(self) -> None:
        self.commands = []
        self.values = {}
        self.streams = {}
        self.stream_changed = asyncio.Event()
        self.eval_result = None

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
        if self.eval_result is None:
            raise AssertionError("test must configure FakeRedis.eval_result")
        return list(self.eval_result)

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


def test_get_run_accepts_legacy_record_without_error_type() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]
    record = asyncio.run(store.create_run())
    record_key = f"test:runs:{record.run_id}:record"
    payload = json.loads(cast(str, redis.values[record_key]))
    del payload["error_type"]
    redis.values[record_key] = json.dumps(payload)

    loaded = asyncio.run(store.get_run(record.run_id))

    assert loaded.error_type is None


def test_request_cancellation_maps_eval_result_and_arguments() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test", run_retention_seconds=60)  # pyright: ignore[reportArgumentType]
    redis.eval_result = [1, "running"]

    status = asyncio.run(
        store.request_cancellation(
            "run-1",
            CancelRunRequest(reason="workflow_aborted", message="workflow stopped"),
        )
    )

    assert status == "running"
    eval_command = redis.commands[-1]
    assert eval_command[0] == "eval"
    assert eval_command[2] == 3
    assert eval_command[3:6] == (
        "test:runs:run-1:record",
        "test:runs:run-1:cancel-intent",
        "test:runs:run-1:events",
    )
    intent_payload = json.loads(cast(str, eval_command[6]))
    assert intent_payload["reason"] == "workflow_aborted"
    assert intent_payload["message"] == "workflow stopped"
    assert eval_command[7] == "60"


def test_finalize_cancellation_maps_eval_result_and_arguments() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test", run_retention_seconds=60)  # pyright: ignore[reportArgumentType]
    redis.eval_result = [1, "cancelled", "7-0"]
    intent = RunCancellationIntent(
        reason="workflow_aborted",
        message="workflow stopped",
        requested_at=utc_now(),
    )

    result = asyncio.run(
        store.finalize_cancellation(
            "run-1",
            intent,
            session_snapshot=CompositorSessionSnapshot(layers=[]),
            usage=AgentRunUsage(prompt_tokens=13, completion_tokens=8),
        )
    )

    assert result == RunFinalizationResult(applied=True, status="cancelled", event_id="7-0")
    eval_command = redis.commands[-1]
    assert eval_command[2] == 3
    assert eval_command[3:6] == (
        "test:runs:run-1:record",
        "test:runs:run-1:cancel-intent",
        "test:runs:run-1:events",
    )
    payload = json.loads(cast(str, eval_command[9]))
    assert "id" not in payload
    assert payload["type"] == "run_cancelled"
    assert payload["data"]["reason"] == "workflow_aborted"
    assert payload["data"]["message"] == "workflow stopped"
    assert payload["data"]["session_snapshot"] == {"schema_version": 1, "layers": []}
    assert payload["data"]["usage"]["prompt_tokens"] == 13
    assert payload["data"]["usage"]["completion_tokens"] == 8
    assert payload["data"]["usage"]["total_tokens"] == 21
    assert eval_command[10] == "60"


def test_finalize_failed_run_maps_eval_result_and_arguments() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]
    redis.eval_result = [1, "failed", "8-0"]
    event = RunFailedEvent(
        run_id="run-1",
        data=RunFailedEventData(
            error="model failed",
            error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED,
            reason="model_error",
        ),
    )

    result = asyncio.run(store.finalize_run(event))

    assert result == RunFinalizationResult(applied=True, status="failed", event_id="8-0")
    eval_command = redis.commands[-1]
    assert eval_command[3:6] == (
        "test:runs:run-1:record",
        "test:runs:run-1:events",
        "test:runs:run-1:cancel-intent",
    )
    assert eval_command[6] == "failed"
    assert eval_command[8:12] == ("1", "model failed", "1", "agent_run_limit_exceeded")
    payload = json.loads(cast(str, eval_command[12]))
    assert payload["data"]["error_type"] == "agent_run_limit_exceeded"


def test_request_cancellation_raises_when_record_is_missing() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]
    redis.eval_result = [-1, ""]

    with pytest.raises(RunNotFoundError):
        asyncio.run(store.request_cancellation("missing", CancelRunRequest(reason="cancelled")))


def test_wait_for_cancellation_reads_existing_intent_from_stream_start() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]
    intent = RunCancellationIntent(
        reason="cancelled",
        requested_at=utc_now(),
    )

    async def scenario() -> RunCancellationIntent:
        _ = redis._append_stream_entry(
            "test:runs:run-1:cancel-intent",
            {"payload": intent.model_dump_json()},
        )
        return await asyncio.wait_for(store.wait_for_cancellation("run-1"), timeout=1)

    assert asyncio.run(scenario()) == intent
    assert redis.commands == [
        ("xread", {"test:runs:run-1:cancel-intent": "0-0"}, 1, 0),
    ]


def test_wait_for_cancellation_ignores_public_events() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> RunCancellationIntent:
        record = await store.create_run()
        redis.commands.clear()
        observer = asyncio.create_task(store.wait_for_cancellation(record.run_id))
        await asyncio.sleep(0)
        _ = await store.append_event(RunStartedEvent(run_id=record.run_id))
        await asyncio.sleep(0)
        assert observer.done() is False
        xread_commands = [command for command in redis.commands if command[0] == "xread"]
        assert xread_commands == [
            ("xread", {f"test:runs:{record.run_id}:cancel-intent": "0-0"}, 1, 0),
        ]
        _ = redis._append_stream_entry(
            f"test:runs:{record.run_id}:cancel-intent",
            {
                "payload": RunCancellationIntent(
                    reason="cancelled",
                    requested_at=utc_now(),
                ).model_dump_json()
            },
        )
        return await asyncio.wait_for(observer, timeout=1)

    assert asyncio.run(scenario()).reason == "cancelled"


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
        event = RunSucceededEvent(
            id="local-only",
            run_id=record.run_id,
            data=RunSucceededEventData(output=output, session_snapshot=session_snapshot),
        )
        event_id = redis._append_stream_entry(
            f"test:runs:{record.run_id}:events",
            {"payload": RUN_EVENT_ADAPTER.dump_json(event, exclude={"id"}).decode()},
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


@pytest.mark.parametrize("terminal_type", ["run_succeeded", "run_failed", "run_cancelled"])
def test_iter_events_ends_after_replaying_terminal_event(terminal_type: str) -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> list[str]:
        record = await store.create_run()
        _ = await store.append_event(RunStartedEvent(run_id=record.run_id))
        terminal = _terminal_event(terminal_type, record.run_id)
        _ = redis._append_stream_entry(
            f"test:runs:{record.run_id}:events",
            {"payload": RUN_EVENT_ADAPTER.dump_json(terminal, exclude={"id"}).decode()},
        )
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

        terminal = _terminal_event(terminal_type, record.run_id)
        _ = redis._append_stream_entry(
            f"test:runs:{record.run_id}:events",
            {"payload": RUN_EVENT_ADAPTER.dump_json(terminal, exclude={"id"}).decode()},
        )
        event = await asyncio.wait_for(next_event, timeout=1)
        with pytest.raises(StopAsyncIteration):
            _ = await anext(events)
        return event.type

    assert asyncio.run(scenario()) == terminal_type
