import asyncio
from collections.abc import Mapping
import hashlib
import json
from typing import cast

import pytest
from fakeredis import FakeServer
from fakeredis.aioredis import FakeRedis as AsyncFakeRedis
from pydantic import JsonValue

from dify_agent.protocol.snapshot import SessionSnapshot
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
from dify_agent.runtime.event_sink import RunFinalizationResult, RunStreamSealedError
from dify_agent.storage.redis_keys import run_idempotency_key, run_record_key
from dify_agent.storage.redis_run_store import (
    DEFAULT_RUN_EVENT_STREAM_MAX_LENGTH,
    DEFAULT_RUN_RETENTION_SECONDS,
    IdempotencyConflictError,
    RedisRunStore,
    RunNotFoundError,
)


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

    def _append_stream_entry(
        self,
        key: str,
        fields: Mapping[str, object],
    ) -> str:
        entries = self.streams.setdefault(key, [])
        next_sequence = self._stream_id_value(entries[-1][0])[0] + 1 if entries else 1
        event_id = f"{next_sequence}-0"
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
            if response or block is None:
                return response
            self.stream_changed.clear()
            await self.stream_changed.wait()

    async def eval(self, script: str, numkeys: int, *keys_and_args: object) -> list[object]:
        self.commands.append(("eval", script, numkeys, *keys_and_args))
        if self.eval_result is None:
            raise AssertionError("test must configure FakeRedis.eval_result")
        return list(self.eval_result)

    @staticmethod
    def _stream_id_value(event_id: str) -> tuple[int, int]:
        timestamp, sequence = event_id.split("-", maxsplit=1)
        return int(timestamp), int(sequence)


def _terminal_event(
    event_type: str,
    run_id: str,
) -> RunSucceededEvent | RunFailedEvent | RunCancelledEvent:
    if event_type == "run_succeeded":
        return RunSucceededEvent(
            run_id=run_id,
            data=RunSucceededEventData(
                output="done",
                session_snapshot=SessionSnapshot(layers={}),
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


@pytest.mark.parametrize(
    "kwargs",
    [{"run_retention_seconds": 0}, {"run_event_stream_max_length": 0}],
)
def test_rejects_non_positive_run_storage_bounds(kwargs: dict[str, int]) -> None:
    with pytest.raises(ValueError, match="must be positive"):
        _ = RedisRunStore(FakeRedis(), **kwargs)  # pyright: ignore[reportArgumentType]


def test_get_run_accepts_legacy_record_without_error_type_or_idempotency_fields() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]
    record = asyncio.run(store.create_run())
    record_key = f"test:runs:{record.run_id}:record"
    payload = json.loads(cast(str, redis.values[record_key]))
    del payload["error_type"]
    del payload["idempotency_key_digest"]
    del payload["idempotency_fingerprint"]
    redis.values[record_key] = json.dumps(payload)

    loaded = asyncio.run(store.get_run(record.run_id))

    assert loaded.error_type is None
    assert loaded.idempotency_key_digest is None
    assert loaded.idempotency_fingerprint is None


def test_create_run_idempotent_claim_is_atomic_and_replay_does_not_refresh_retention() -> None:
    async def scenario() -> None:
        server = FakeServer()
        async with AsyncFakeRedis(server=server) as first_client, AsyncFakeRedis(server=server) as second_client:
            stores = (
                RedisRunStore(first_client, prefix="test", run_retention_seconds=60),
                RedisRunStore(second_client, prefix="test", run_retention_seconds=60),
            )
            results = await asyncio.gather(
                *(
                    stores[index % 2].create_run_idempotent(
                        idempotency_key="retry-1", request_fingerprint="fingerprint-a"
                    )
                    for index in range(24)
                )
            )
            assert sum(created for _record, created in results) == 1
            record = results[0][0]
            assert all(result == record for result, _created in results)
            claim_key = run_idempotency_key("test", hashlib.sha256(b"retry-1").hexdigest())
            record_key = run_record_key("test", record.run_id)
            assert set(await first_client.keys("*")) == {claim_key.encode(), record_key.encode()}
            assert await first_client.get(claim_key) == record.run_id.encode()
            for key in (claim_key, record_key):
                assert 0 < await first_client.ttl(key) <= 60
                assert await first_client.expire(key, 30)
            previous_ttls = [await first_client.pttl(key) for key in (claim_key, record_key)]

            replay, created = await stores[1].create_run_idempotent(
                idempotency_key="retry-1", request_fingerprint="fingerprint-a"
            )

            assert not created
            assert replay == record
            for key, previous_ttl in zip((claim_key, record_key), previous_ttls, strict=True):
                assert 0 < await first_client.pttl(key) <= previous_ttl

    asyncio.run(scenario())


def test_legacy_record_without_idempotency_fields_still_accepts_active_writes() -> None:
    async def scenario() -> None:
        async with AsyncFakeRedis() as client:
            store = RedisRunStore(client, prefix="test", run_retention_seconds=60)
            original = await store.create_run()
            record_key = run_record_key("test", original.run_id)
            payload = original.model_dump(mode="json", exclude={"idempotency_key_digest", "idempotency_fingerprint"})
            await client.set(record_key, json.dumps(payload), ex=60)

            loaded = await store.get_run(original.run_id)
            await store.append_event(RunStartedEvent(run_id=loaded.run_id))

            assert loaded.idempotency_key_digest is None
            assert loaded.idempotency_fingerprint is None
            assert [event.type for event in (await store.get_events(loaded.run_id)).events] == ["run_started"]
            assert not await client.keys("test:idempotency:*")

    asyncio.run(scenario())


def test_create_run_idempotent_rejects_live_fingerprint_conflict() -> None:
    async def scenario() -> None:
        async with AsyncFakeRedis() as client:
            store = RedisRunStore(client, prefix="test", run_retention_seconds=60)
            original, _ = await store.create_run_idempotent(
                idempotency_key="retry-1", request_fingerprint="fingerprint-a"
            )

            with pytest.raises(IdempotencyConflictError, match="different create-run request"):
                await store.create_run_idempotent(idempotency_key="retry-1", request_fingerprint="fingerprint-b")

            replay, created = await store.create_run_idempotent(
                idempotency_key="retry-1", request_fingerprint="fingerprint-a"
            )
            assert (replay, created) == (original, False)
            assert len(await client.keys("*")) == 2

    asyncio.run(scenario())


def test_create_run_idempotent_reclaims_when_claimed_run_record_expires() -> None:
    async def scenario() -> None:
        async with AsyncFakeRedis() as client:
            store = RedisRunStore(client, prefix="test", run_retention_seconds=60)
            original, _ = await store.create_run_idempotent(
                idempotency_key="retry-1", request_fingerprint="fingerprint-a"
            )
            assert await client.expire(run_record_key("test", original.run_id), 0)

            replacement, created = await store.create_run_idempotent(
                idempotency_key="retry-1", request_fingerprint="fingerprint-b"
            )

            assert created
            assert replacement.run_id != original.run_id
            assert await store.get_run(replacement.run_id) == replacement
            claim_key = run_idempotency_key("test", hashlib.sha256(b"retry-1").hexdigest())
            assert await client.get(claim_key) == replacement.run_id.encode()

    asyncio.run(scenario())


def test_create_run_idempotent_persists_only_admission_digests_and_run_metadata() -> None:
    async def scenario() -> None:
        async with AsyncFakeRedis(decode_responses=True) as client:
            store = RedisRunStore(client, prefix="test", run_retention_seconds=60)
            raw_key = " private-retry-key\t"
            fingerprint = "a" * 64
            record, _ = await store.create_run_idempotent(idempotency_key=raw_key, request_fingerprint=fingerprint)
            key_digest = hashlib.sha256(raw_key.encode()).hexdigest()
            claim_key = run_idempotency_key("test", key_digest)
            record_key = run_record_key("test", record.run_id)
            keys = await client.keys("*")
            assert set(keys) == {claim_key, record_key}
            assert await client.get(claim_key) == record.run_id
            persisted = json.loads(await client.get(record_key))
            assert persisted["idempotency_key_digest"] == key_digest
            assert persisted["idempotency_fingerprint"] == fingerprint
            stored_strings = keys + [await client.get(key) for key in keys]
            assert all(raw_key.strip() not in value for value in stored_strings)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "write_path", ["append_event", "request_cancellation", "finalize_run", "finalize_cancellation"]
)
@pytest.mark.parametrize("claim_state", ["decaying", "expired", "reclaimed"])
def test_active_run_writes_refresh_only_unowned_or_same_run_claims(write_path: str, claim_state: str) -> None:
    async def scenario() -> None:
        async with AsyncFakeRedis() as client:
            prefix = "test:nested:runs:scope:record"
            store = RedisRunStore(client, prefix=prefix, run_retention_seconds=60)
            original, _ = await store.create_run_idempotent(
                idempotency_key="retry-1", request_fingerprint="fingerprint-a"
            )
            if write_path == "finalize_cancellation":
                await store.request_cancellation(original.run_id, CancelRunRequest(reason="test"))
            claim_key = run_idempotency_key(prefix, hashlib.sha256(b"retry-1").hexdigest())
            replacement = None
            if claim_state == "decaying":
                assert await client.expire(claim_key, 1)
            else:
                assert await client.expire(claim_key, 0)
                if claim_state == "reclaimed":
                    replacement, created = await store.create_run_idempotent(
                        idempotency_key="retry-1", request_fingerprint="fingerprint-b"
                    )
                    assert created
                    assert await client.expire(claim_key, 30)

            if write_path == "append_event":
                await store.append_event(RunStartedEvent(run_id=original.run_id))
            elif write_path == "request_cancellation":
                assert await store.request_cancellation(original.run_id, CancelRunRequest(reason="test")) == "running"
            elif write_path == "finalize_run":
                assert (await store.finalize_run(_terminal_event("run_succeeded", original.run_id))).applied
            else:
                intent = await store.get_cancellation_intent(original.run_id)
                assert intent is not None
                assert (await store.finalize_cancellation(original.run_id, intent)).applied

            if replacement is not None:
                assert await client.get(claim_key) == replacement.run_id.encode()
                assert 0 < await client.ttl(claim_key) <= 30
                expected, fingerprint = replacement, "fingerprint-b"
            else:
                assert await client.get(claim_key) == original.run_id.encode()
                assert (1 if claim_state == "decaying" else 0) < await client.ttl(claim_key) <= 60
                expected, fingerprint = await store.get_run(original.run_id), "fingerprint-a"
            replay, created = await store.create_run_idempotent(
                idempotency_key="retry-1", request_fingerprint=fingerprint
            )
            assert (replay, created) == (expected, False)

    asyncio.run(scenario())


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
    assert '"MAXLEN", "1"' in cast(str, eval_command[1])


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
            session_snapshot=SessionSnapshot(layers={}),
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
    assert payload["data"]["session_snapshot"] == {"schema_version": 2, "layers": {}}
    assert payload["data"]["usage"]["prompt_tokens"] == 13
    assert payload["data"]["usage"]["completion_tokens"] == 8
    assert payload["data"]["usage"]["total_tokens"] == 21
    assert eval_command[10] == "60"
    assert eval_command[11] == str(DEFAULT_RUN_EVENT_STREAM_MAX_LENGTH)
    assert '"MAXLEN", "~", ARGV[6]' in cast(str, eval_command[1])


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
    assert eval_command[2] == 3
    assert eval_command[3:6] == (
        "test:runs:run-1:record",
        "test:runs:run-1:events",
        "test:runs:run-1:cancel-intent",
    )
    assert eval_command[6] == "failed"
    assert eval_command[8:12] == ("1", "model failed", "1", "agent_run_limit_exceeded")
    payload = json.loads(cast(str, eval_command[12]))
    assert payload["data"]["error_type"] == "agent_run_limit_exceeded"
    assert eval_command[13] == str(DEFAULT_RUN_RETENTION_SECONDS)
    assert eval_command[14] == str(DEFAULT_RUN_EVENT_STREAM_MAX_LENGTH)
    assert '"MAXLEN", "~", ARGV[9]' in cast(str, eval_command[1])


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
        _ = redis._append_stream_entry(
            f"test:runs:{record.run_id}:events",
            {"payload": RUN_EVENT_ADAPTER.dump_json(RunStartedEvent(run_id=record.run_id), exclude={"id"}).decode()},
        )
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


def test_append_event_maps_eval_script_arguments_and_result() -> None:
    redis = FakeRedis()
    redis.eval_result = [1, "running", "7-0"]
    store = RedisRunStore(redis, prefix="test", run_retention_seconds=60)  # pyright: ignore[reportArgumentType]

    event_id = asyncio.run(store.append_event(RunStartedEvent(id="local", run_id="run-1")))

    assert event_id == "7-0"
    eval_commands = [command for command in redis.commands if command[0] == "eval"]
    assert len(eval_commands) == 1
    script, numkeys, record_key, events_key, payload, maxlen, ttl = eval_commands[0][1:]
    assert numkeys == 2
    assert (record_key, events_key) == (
        "test:runs:run-1:record",
        "test:runs:run-1:events",
    )
    assert '"id"' not in payload
    assert '"type":"run_started"' in payload
    assert maxlen == str(DEFAULT_RUN_EVENT_STREAM_MAX_LENGTH)
    assert ttl == "60"
    assert '"MAXLEN", "~", ARGV[2]' in cast(str, script)


def test_append_event_persists_while_running_and_refreshes_ttls() -> None:
    async def scenario() -> None:
        client = AsyncFakeRedis()
        store = RedisRunStore(client, prefix="test", run_retention_seconds=60)
        record = await store.create_run()

        event_id = await store.append_event(RunStartedEvent(run_id=record.run_id))

        assert event_id.endswith("-0")
        page = await store.get_events(record.run_id)
        assert [event.type for event in page.events] == ["run_started"]
        assert page.events[0].id == event_id
        events_ttl = await client.ttl(f"test:runs:{record.run_id}:events")
        record_ttl = await client.ttl(f"test:runs:{record.run_id}:record")
        assert 0 < events_ttl <= 60
        assert 0 < record_ttl <= 60

    asyncio.run(scenario())


def test_append_event_keeps_only_the_configured_number_of_entries() -> None:
    async def scenario() -> None:
        client = AsyncFakeRedis()
        store = RedisRunStore(
            client,
            prefix="test",
            run_retention_seconds=60,
            run_event_stream_max_length=2,
        )
        record = await store.create_run()

        for _ in range(3):
            _ = await store.append_event(RunStartedEvent(run_id=record.run_id))

        entries = await client.xrange(f"test:runs:{record.run_id}:events")
        assert len(entries) == 2

    asyncio.run(scenario())


def test_append_event_winning_first_keeps_terminal_last() -> None:
    async def scenario() -> None:
        client = AsyncFakeRedis()
        store = RedisRunStore(client, prefix="test", run_retention_seconds=60)
        record = await store.create_run()

        first = await store.append_event(RunStartedEvent(run_id=record.run_id))
        finalization = await store.finalize_run(
            RunFailedEvent(run_id=record.run_id, data=RunFailedEventData(error="boom"))
        )

        assert finalization.applied
        assert finalization.event_id is not None and finalization.event_id > first
        page = await store.get_events(record.run_id)
        assert [event.type for event in page.events] == ["run_started", "run_failed"]

    asyncio.run(scenario())


def test_append_event_is_rejected_after_terminal_finalization() -> None:
    async def scenario() -> None:
        client = AsyncFakeRedis()
        store = RedisRunStore(client, prefix="test", run_retention_seconds=60)
        record, _ = await store.create_run_idempotent(idempotency_key="retry-1", request_fingerprint="fingerprint-a")
        finalization = await store.finalize_run(
            RunFailedEvent(run_id=record.run_id, data=RunFailedEventData(error="boom"))
        )
        assert finalization.applied
        events_key = f"test:runs:{record.run_id}:events"
        record_key = run_record_key("test", record.run_id)
        claim_key = run_idempotency_key("test", hashlib.sha256(b"retry-1").hexdigest())
        for key in (events_key, record_key, claim_key):
            assert await client.expire(key, 30)

        with pytest.raises(RunStreamSealedError) as sealed:
            await store.append_event(RunStartedEvent(run_id=record.run_id))

        assert sealed.value.run_id == record.run_id
        assert sealed.value.status == "failed"
        page = await store.get_events(record.run_id)
        assert [event.type for event in page.events] == ["run_failed"]
        for key in (events_key, record_key, claim_key):
            assert await client.ttl(key) == 30

    asyncio.run(scenario())


def test_append_event_is_rejected_after_cancellation_wins() -> None:
    async def scenario() -> None:
        client = AsyncFakeRedis()
        store = RedisRunStore(client, prefix="test", run_retention_seconds=60)
        record = await store.create_run()
        _ = await store.request_cancellation(record.run_id, CancelRunRequest(reason="user"))
        intent = await store.get_cancellation_intent(record.run_id)
        assert intent is not None
        _ = await store.finalize_cancellation(record.run_id, intent)

        with pytest.raises(RunStreamSealedError) as sealed:
            await store.append_event(RunStartedEvent(run_id=record.run_id))

        assert sealed.value.status == "cancelled"
        page = await store.get_events(record.run_id)
        assert [event.type for event in page.events] == ["run_cancelled"]

    asyncio.run(scenario())


def test_append_event_raises_when_run_record_is_missing() -> None:
    async def scenario() -> None:
        client = AsyncFakeRedis()
        store = RedisRunStore(client, prefix="test", run_retention_seconds=60)

        with pytest.raises(RunNotFoundError):
            await store.append_event(RunStartedEvent(run_id="missing"))

        assert not await client.exists("test:runs:missing:events")

    asyncio.run(scenario())


def test_get_events_round_trips_run_succeeded_output_and_session_snapshot() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test", run_retention_seconds=60)  # pyright: ignore[reportArgumentType]
    output = cast(JsonValue, {"answer": ["done", 1], "ok": True})
    session_snapshot = SessionSnapshot(layers={"prompt": {"resource_id": "abc"}})

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


def test_get_events_pages_strictly_after_cursor_within_limit() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> None:
        record = await store.create_run()
        events_key = f"test:runs:{record.run_id}:events"
        payload = RUN_EVENT_ADAPTER.dump_json(RunStartedEvent(run_id=record.run_id), exclude={"id"}).decode()
        event_ids = ["1000-0", "1000-1", "1000-2", "1000-10", "1001-0"]
        redis.streams[events_key] = [(event_id, {"payload": payload}) for event_id in event_ids]

        first = await store.get_events(record.run_id, limit=2)
        assert [event.id for event in first.events] == event_ids[:2]
        assert first.next_cursor == "1000-1"
        assert ("xread", {events_key: "0-0"}, 2, None) in redis.commands

        second = await store.get_events(record.run_id, after=first.next_cursor, limit=2)
        assert [event.id for event in second.events] == event_ids[2:4]
        assert second.next_cursor == "1000-10"

        third = await store.get_events(record.run_id, after=second.next_cursor, limit=2)
        assert [event.id for event in third.events] == event_ids[4:]
        assert third.next_cursor == "1001-0"

        empty = await asyncio.wait_for(store.get_events(record.run_id, after=third.next_cursor, limit=2), timeout=1)
        assert empty.events == []
        assert empty.next_cursor == third.next_cursor

        between = await store.get_events(record.run_id, after="1000-3", limit=2)
        assert [event.id for event in between.events] == event_ids[3:]
        assert between.next_cursor == "1001-0"

    asyncio.run(scenario())


@pytest.mark.parametrize("after", ["0-0", "1000-7"])
def test_get_events_without_stream_returns_empty_page_without_blocking(after: str) -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> None:
        record = await store.create_run()
        page = await asyncio.wait_for(store.get_events(record.run_id, after=after, limit=3), timeout=1)
        assert page.run_id == record.run_id
        assert page.events == []
        assert page.next_cursor == after
        assert ("xread", {f"test:runs:{record.run_id}:events": after}, 3, None) in redis.commands

    asyncio.run(scenario())


def test_event_reads_raise_when_run_record_is_missing() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> None:
        with pytest.raises(RunNotFoundError):
            _ = await store.get_events("missing")
        with pytest.raises(RunNotFoundError):
            _ = await anext(store.iter_events("missing"))

    asyncio.run(scenario())

    assert not any(command[0] in {"xread", "xrange"} for command in redis.commands)


@pytest.mark.parametrize("terminal_type", ["run_succeeded", "run_failed", "run_cancelled"])
def test_iter_events_ends_after_replaying_terminal_event(terminal_type: str) -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> list[str]:
        record = await store.create_run()
        events_key = f"test:runs:{record.run_id}:events"
        for _ in range(101):
            _ = redis._append_stream_entry(
                events_key,
                {
                    "payload": RUN_EVENT_ADAPTER.dump_json(
                        RunStartedEvent(run_id=record.run_id), exclude={"id"}
                    ).decode()
                },
            )
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

    assert event_types == ["run_started"] * 101 + [terminal_type]
    assert not any(command[0] == "xread" and command[3] is not None for command in redis.commands)


@pytest.mark.parametrize("terminal_type", ["run_succeeded", "run_failed", "run_cancelled"])
def test_iter_events_ends_after_live_terminal_event(terminal_type: str) -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> str:
        record = await store.create_run()
        started_id = redis._append_stream_entry(
            f"test:runs:{record.run_id}:events",
            {"payload": RUN_EVENT_ADAPTER.dump_json(RunStartedEvent(run_id=record.run_id), exclude={"id"}).decode()},
        )
        events = store.iter_events(record.run_id)
        assert (await anext(events)).id == started_id
        next_event = asyncio.ensure_future(anext(events))
        await asyncio.sleep(0)
        assert not next_event.done()
        assert ("xread", {f"test:runs:{record.run_id}:events": started_id}, 100, 30_000) in redis.commands

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


@pytest.mark.parametrize("terminal_type", ["run_succeeded", "run_failed", "run_cancelled"])
def test_iter_events_does_not_replay_terminal_event_at_cursor(terminal_type: str) -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    async def scenario() -> None:
        record = await store.create_run()
        events_key = f"test:runs:{record.run_id}:events"
        terminal = _terminal_event(terminal_type, record.run_id)
        terminal_id = redis._append_stream_entry(
            events_key,
            {"payload": RUN_EVENT_ADAPTER.dump_json(terminal, exclude={"id"}).decode()},
        )
        events = store.iter_events(record.run_id, after=terminal_id)
        next_event = asyncio.ensure_future(anext(events))
        try:
            await asyncio.sleep(0)
            assert not next_event.done()
            assert ("xread", {events_key: terminal_id}, 100, 30_000) in redis.commands
        finally:
            next_event.cancel()
            await asyncio.gather(next_event, return_exceptions=True)
            await events.aclose()

    asyncio.run(scenario())
