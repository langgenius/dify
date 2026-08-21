import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
import json
from typing import TYPE_CHECKING, Literal, Protocol, cast, final

import pytest

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol.schemas import (
    RUN_EVENT_ADAPTER,
    CancelRunRequest,
    RunFailedEvent,
    RunFailedEventData,
    RunStartedEvent,
    RunSucceededEvent,
    RunSucceededEventData,
    utc_now,
)
from dify_agent.runtime.cancellation import RunCancellationIntent
from dify_agent.runtime.event_sink import InMemoryRunEventSink, RunFinalizationResult
from dify_agent.storage.redis_run_store import RedisRunStore, RunNotFoundError

if TYPE_CHECKING:
    from redis.asyncio import Redis

TerminalStatus = Literal["succeeded", "failed", "cancelled"]


@dataclass(frozen=True)
class StoreSnapshot:
    cursors: tuple[str, ...]
    event_types: tuple[str, ...]
    ttl_writes: tuple[tuple[str, int], ...]


class RunEventStoreHarness(Protocol):
    run_id: str

    async def append_started(self) -> str: ...

    async def finalize(self, status: TerminalStatus) -> RunFinalizationResult: ...

    def snapshot(self) -> StoreSnapshot: ...


@final
class TransactionalFakeRedis:
    """CPU-only model of the Lua/pipeline effects used by the contract tests.

    It intentionally understands both the old pipeline append and the new Lua
    append. This lets the same regression test prove RED on the parent commit:
    the old pipeline resumes after finalization and appends unconditionally.
    """

    def __init__(self) -> None:
        self.values: dict[str, object] = {}
        self.streams: dict[str, list[tuple[str, dict[str, object]]]] = {}
        self.ttl_writes: list[tuple[str, int]] = []
        self.pause_next_event_append = False
        self.append_ready = asyncio.Event()
        self.release_append = asyncio.Event()

    async def set(self, key: str, value: object, *, ex: int | None = None) -> None:
        self.values[key] = value
        if ex is not None:
            self.ttl_writes.append((key, ex))

    async def get(self, key: str) -> object | None:
        return self.values.get(key)

    def pipeline(self, transaction: bool = True, shard_hint: str | None = None) -> "FakePipeline":
        del transaction, shard_hint
        return FakePipeline(self)

    async def eval(self, script: str, numkeys: int, *keys_and_args: object) -> list[object]:
        if numkeys == 2:
            return await self._append_event(keys_and_args)
        if 'record.status = ARGV[1]' in script:
            return self._finalize_run(keys_and_args)
        if 'record.status = "cancelled"' in script:
            return self._finalize_cancellation(keys_and_args)
        if 'redis.call("EXISTS", KEYS[2]) == 1' in script:
            return self._request_cancellation(keys_and_args)
        raise AssertionError("contract fake received an unknown Lua script")

    async def before_event_append(self) -> None:
        if not self.pause_next_event_append:
            return
        self.pause_next_event_append = False
        _ = self.append_ready.set()
        _ = await self.release_append.wait()

    async def _append_event(self, args: tuple[object, ...]) -> list[object]:
        record_key, events_key, payload, retention = map(str, args[:4])
        await self.before_event_append()
        record = self._record(record_key)
        if record is None:
            return [-1, ""]
        if record["status"] != "running":
            return [0, record["status"]]
        event_id = self.append_stream(events_key, {"payload": payload})
        self.refresh_ttl(events_key, int(retention))
        self.refresh_ttl(record_key, int(retention))
        return [1, event_id]

    def _finalize_run(self, args: tuple[object, ...]) -> list[object]:
        record_key, events_key, cancel_key = map(str, args[:3])
        status = str(args[3])
        record = self._record(record_key)
        if record is None:
            return [-1, "", ""]
        if record["status"] != "running":
            return [0, record["status"], ""]
        if self.streams.get(cancel_key):
            return [-2, "running", ""]

        record["status"] = status
        record["updated_at"] = str(args[4])
        record["error"] = str(args[6]) if str(args[5]) == "1" else None
        record["error_type"] = str(args[8]) if str(args[7]) == "1" else None
        event_id = self.append_stream(events_key, {"payload": str(args[9])})
        retention = int(str(args[10]))
        self.refresh_ttl(events_key, retention)
        self.values[record_key] = json.dumps(record)
        self.refresh_ttl(record_key, retention)
        return [1, status, event_id]

    def _request_cancellation(self, args: tuple[object, ...]) -> list[object]:
        record_key, cancel_key, events_key = map(str, args[:3])
        record = self._record(record_key)
        if record is None:
            return [-1, ""]
        status = str(record["status"])
        if status in {"succeeded", "failed"}:
            return [0, status]
        if status == "cancelled" or self.streams.get(cancel_key):
            return [1, status]

        _ = self.append_stream(cancel_key, {"payload": str(args[3])})
        retention = int(str(args[4]))
        for key in (cancel_key, record_key, events_key):
            self.refresh_ttl(key, retention)
        return [1, "running"]

    def _finalize_cancellation(self, args: tuple[object, ...]) -> list[object]:
        record_key, cancel_key, events_key = map(str, args[:3])
        record = self._record(record_key)
        if record is None:
            return [-1, "", ""]
        status = str(record["status"])
        if status != "running":
            return [0, status, ""]
        if not self.streams.get(cancel_key):
            return [-2, "running", ""]

        record["status"] = "cancelled"
        record["updated_at"] = str(args[3])
        record["error"] = str(args[5]) if str(args[4]) == "1" else None
        record["error_type"] = None
        event_id = self.append_stream(events_key, {"payload": str(args[6])})
        _ = self.streams.pop(cancel_key, None)
        retention = int(str(args[7]))
        self.refresh_ttl(events_key, retention)
        self.values[record_key] = json.dumps(record)
        self.refresh_ttl(record_key, retention)
        return [1, "cancelled", event_id]

    def _record(self, key: str) -> dict[str, object] | None:
        value = self.values.get(key)
        if value is None:
            return None
        if isinstance(value, bytes):
            value = value.decode()
        return cast(dict[str, object], json.loads(cast(str, value)))

    def append_stream(self, key: str, fields: Mapping[str, object]) -> str:
        entries = self.streams.setdefault(key, [])
        event_id = f"{len(entries) + 1}-0"
        entries.append((event_id, dict(fields)))
        return event_id

    def refresh_ttl(self, key: str, retention: int) -> None:
        self.ttl_writes.append((key, retention))


@final
class FakePipeline:
    def __init__(self, redis: TransactionalFakeRedis) -> None:
        self.redis = redis
        self.operations: list[tuple[str, object, object]] = []

    async def __aenter__(self) -> "FakePipeline":
        return self

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None:
        del exc_type, exc, traceback

    def xadd(self, key: str, fields: Mapping[str, object]) -> "FakePipeline":
        self.operations.append(("xadd", key, dict(fields)))
        return self

    def expire(self, key: str, seconds: int) -> "FakePipeline":
        self.operations.append(("expire", key, seconds))
        return self

    async def execute(self) -> list[object]:
        await self.redis.before_event_append()
        results: list[object] = []
        for operation, key, value in self.operations:
            if operation == "xadd":
                results.append(self.redis.append_stream(cast(str, key), cast(dict[str, object], value)))
            else:
                self.redis.refresh_ttl(cast(str, key), cast(int, value))
                results.append(True)
        return results


@final
class InMemoryHarness:
    run_id: str = "contract-run"

    def __init__(self) -> None:
        self.sink = InMemoryRunEventSink()

    async def append_started(self) -> str:
        return await self.sink.append_event(RunStartedEvent(run_id=self.run_id))

    async def finalize(self, status: TerminalStatus) -> RunFinalizationResult:
        if status == "succeeded":
            return await self.sink.finalize_run(
                RunSucceededEvent(
                    run_id=self.run_id,
                    data=RunSucceededEventData(
                        output="done",
                        session_snapshot=CompositorSessionSnapshot(layers=[]),
                    ),
                )
            )
        if status == "failed":
            return await self.sink.finalize_run(
                RunFailedEvent(run_id=self.run_id, data=RunFailedEventData(error="failed"))
            )
        raise AssertionError("the in-memory RunEventSink contract has no cancellation finalizer")

    def snapshot(self) -> StoreSnapshot:
        events = self.sink.events[self.run_id]
        return StoreSnapshot(
            cursors=tuple(cast(str, event.id) for event in events),
            event_types=tuple(event.type for event in events),
            ttl_writes=(),
        )


@final
class RedisHarness:
    def __init__(self) -> None:
        self.redis = TransactionalFakeRedis()
        self.store = RedisRunStore(
            cast("Redis", cast(object, self.redis)), prefix="contract", run_retention_seconds=60
        )
        self.run_id = ""
        self._cancellation_intent: RunCancellationIntent | None = None

    async def create(self) -> "RedisHarness":
        self.run_id = (await self.store.create_run()).run_id
        return self

    async def append_started(self) -> str:
        return await self.store.append_event(RunStartedEvent(run_id=self.run_id))

    async def finalize(self, status: TerminalStatus) -> RunFinalizationResult:
        if status == "succeeded":
            return await self.store.finalize_run(
                RunSucceededEvent(
                    run_id=self.run_id,
                    data=RunSucceededEventData(
                        output="done",
                        session_snapshot=CompositorSessionSnapshot(layers=[]),
                    ),
                )
            )
        if status == "failed":
            return await self.store.finalize_run(
                RunFailedEvent(run_id=self.run_id, data=RunFailedEventData(error="failed"))
            )
        if self._cancellation_intent is None:
            self._cancellation_intent = RunCancellationIntent(reason="cancelled", requested_at=utc_now())
            _ = await self.store.request_cancellation(
                self.run_id,
                CancelRunRequest(reason=self._cancellation_intent.reason),
            )
        return await self.store.finalize_cancellation(self.run_id, self._cancellation_intent)

    def snapshot(self) -> StoreSnapshot:
        entries = self.redis.streams.get(f"contract:runs:{self.run_id}:events", [])
        payloads = [RUN_EVENT_ADAPTER.validate_json(cast(str, fields["payload"])) for _, fields in entries]
        return StoreSnapshot(
            cursors=tuple(cursor for cursor, _ in entries),
            event_types=tuple(event.type for event in payloads),
            ttl_writes=tuple(self.redis.ttl_writes),
        )


async def make_in_memory_harness() -> RunEventStoreHarness:
    return InMemoryHarness()


async def make_redis_harness() -> RunEventStoreHarness:
    return await RedisHarness().create()


HarnessFactory = Callable[[], Awaitable[RunEventStoreHarness]]
_CONTRACT_CASES: tuple[tuple[HarnessFactory, TerminalStatus], ...] = (
    (make_in_memory_harness, "succeeded"),
    (make_in_memory_harness, "failed"),
    (make_redis_harness, "succeeded"),
    (make_redis_harness, "failed"),
    (make_redis_harness, "cancelled"),
)


@pytest.mark.parametrize(
    ("make_harness", "terminal_status"),
    _CONTRACT_CASES,
    ids=("memory-succeeded", "memory-failed", "redis-succeeded", "redis-failed", "redis-cancelled"),
)
def test_append_before_finalize_is_accepted_and_ordered(
    make_harness: HarnessFactory, terminal_status: TerminalStatus
) -> None:
    async def scenario() -> tuple[str, RunFinalizationResult, StoreSnapshot]:
        harness = await make_harness()
        append_cursor = await harness.append_started()
        result = await harness.finalize(terminal_status)
        return append_cursor, result, harness.snapshot()

    append_cursor, result, snapshot = asyncio.run(scenario())

    assert result == RunFinalizationResult(applied=True, status=terminal_status, event_id=snapshot.cursors[1])
    assert append_cursor == snapshot.cursors[0]
    assert snapshot.event_types == ("run_started", f"run_{terminal_status}")


@pytest.mark.parametrize(
    ("make_harness", "terminal_status"),
    _CONTRACT_CASES,
    ids=("memory-succeeded", "memory-failed", "redis-succeeded", "redis-failed", "redis-cancelled"),
)
def test_finalize_seals_stream_without_mutating_rejected_write_state(
    make_harness: HarnessFactory, terminal_status: TerminalStatus
) -> None:
    async def scenario() -> tuple[StoreSnapshot, StoreSnapshot, RuntimeError]:
        harness = await make_harness()
        result = await harness.finalize(terminal_status)
        assert result.applied is True
        before = harness.snapshot()
        with pytest.raises(RuntimeError) as raised:
            _ = await harness.append_started()
        return before, harness.snapshot(), raised.value

    before, after, error = asyncio.run(scenario())

    # The public assumption is a runtime-owned coordination exception carrying
    # the winning terminal status; callers do not depend on Redis exceptions.
    assert getattr(error, "status", None) == terminal_status
    assert before == after
    assert after.event_types == (f"run_{terminal_status}",)


@pytest.mark.parametrize(
    ("make_harness", "terminal_status"),
    _CONTRACT_CASES,
    ids=("memory-succeeded", "memory-failed", "redis-succeeded", "redis-failed", "redis-cancelled"),
)
def test_duplicate_terminal_finalization_is_idempotent(
    make_harness: HarnessFactory, terminal_status: TerminalStatus
) -> None:
    async def scenario() -> tuple[RunFinalizationResult, StoreSnapshot, StoreSnapshot]:
        harness = await make_harness()
        first = await harness.finalize(terminal_status)
        before_duplicate = harness.snapshot()
        duplicate = await harness.finalize(terminal_status)
        assert first.applied is True
        return duplicate, before_duplicate, harness.snapshot()

    duplicate, before_duplicate, after_duplicate = asyncio.run(scenario())

    assert duplicate == RunFinalizationResult(applied=False, status=terminal_status)
    assert before_duplicate == after_duplicate


def test_redis_in_flight_append_loses_when_finalize_linearizes_first() -> None:
    async def scenario() -> tuple[StoreSnapshot, RuntimeError]:
        harness = await RedisHarness().create()
        harness.redis.pause_next_event_append = True
        append_task = asyncio.create_task(harness.append_started())
        _ = await asyncio.wait_for(harness.redis.append_ready.wait(), timeout=1)

        result = await harness.finalize("succeeded")
        assert result.applied is True
        _ = harness.redis.release_append.set()
        with pytest.raises(RuntimeError) as raised:
            _ = await asyncio.wait_for(append_task, timeout=1)
        return harness.snapshot(), raised.value

    snapshot, error = asyncio.run(scenario())

    assert getattr(error, "status", None) == "succeeded"
    assert snapshot.event_types == ("run_succeeded",)
    assert snapshot.cursors == ("1-0",)


def test_redis_missing_run_append_keeps_not_found_contract_without_side_effects() -> None:
    redis = TransactionalFakeRedis()
    store = RedisRunStore(
        cast("Redis", cast(object, redis)), prefix="contract", run_retention_seconds=60
    )

    with pytest.raises(RunNotFoundError):
        _ = asyncio.run(store.append_event(RunStartedEvent(run_id="missing")))

    assert redis.streams == {}
    assert redis.ttl_writes == []


def test_in_memory_missing_run_remains_implicitly_running() -> None:
    sink = InMemoryRunEventSink()

    cursor = asyncio.run(sink.append_event(RunStartedEvent(run_id="implicit")))

    assert cursor == "1"
    assert [event.type for event in sink.events["implicit"]] == ["run_started"]
