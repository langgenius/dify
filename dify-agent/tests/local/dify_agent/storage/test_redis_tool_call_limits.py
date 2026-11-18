import asyncio
from typing import cast

from fakeredis import FakeServer
from fakeredis.aioredis import FakeRedis
import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from dify_agent.protocol.schemas import CancelRunRequest, RunFailedEvent, RunFailedEventData, RunStartedEvent
from dify_agent.runtime.tool_call_limits import (
    ToolCallLimitRunUnavailable,
    ToolCallReservation,
    ToolCallUsage,
    tool_call_digest,
)
from dify_agent.storage.redis_keys import run_record_key
from dify_agent.storage.redis_run_store import RedisRunStore
from dify_agent.storage.redis_tool_call_limits import RedisToolCallLimitStore


def test_atomic_reservations_survive_another_client_and_only_one_gets_the_final_slot() -> None:
    async def scenario() -> None:
        server = FakeServer()
        async with FakeRedis(server=server) as first_client, FakeRedis(server=server) as second_client:
            run_store = RedisRunStore(first_client, prefix="test")
            run = await run_store.create_run()
            stores = (
                RedisToolCallLimitStore(first_client, prefix="test"),
                RedisToolCallLimitStore(second_client, prefix="test"),
            )
            for index in range(2):
                assert (
                    await stores[0].reserve(
                        run_id=run.run_id, tool_identity="search", tool_call_id=f"first-{index}", limit=3
                    )
                ).allowed
            results = await asyncio.gather(
                *(
                    stores[index % 2].reserve(
                        run_id=run.run_id, tool_identity="search", tool_call_id=f"parallel-{index}", limit=3
                    )
                    for index in range(24)
                )
            )
            assert sum(result.allowed for result in results) == 1
            assert {result.used for result in results} == {3}
            assert await stores[1].usage(run_id=run.run_id, tool_identity="search", limit=99) == ToolCallUsage(3, 3)
            persisted = await run_store.get_run(run.run_id)
            state = persisted.tool_call_limits[tool_call_digest("search")]
            assert state.used == len(state.call_ids) == 3
            assert state.limit == "3"

    asyncio.run(scenario())


def test_reading_unused_quota_does_not_persist_configuration_and_first_dispatch_freezes_limit() -> None:
    async def scenario() -> None:
        async with FakeRedis() as client:
            run_store = RedisRunStore(client)
            store = RedisToolCallLimitStore(client)
            run = await run_store.create_run()
            record_key = run_record_key("dify-agent", run.run_id)
            original_record = await client.get(record_key)
            assert b"tool_call_limits" not in original_record
            assert await store.usage(run_id=run.run_id, tool_identity="search", limit=3) == ToolCallUsage(0, 3)
            assert await store.usage(run_id=run.run_id, tool_identity="search", limit=7) == ToolCallUsage(0, 7)
            assert await client.get(record_key) == original_record
            assert await store.reserve(
                run_id=run.run_id, tool_identity="search", tool_call_id="first", limit=2
            ) == ToolCallReservation(1, 2, True)
            reconstructed = RedisToolCallLimitStore(client)
            assert await reconstructed.usage(run_id=run.run_id, tool_identity="search", limit=99) == ToolCallUsage(1, 2)
            assert await reconstructed.reserve(
                run_id=run.run_id, tool_identity="search", tool_call_id="second", limit=99
            ) == ToolCallReservation(2, 2, True)
            assert await reconstructed.reserve(
                run_id=run.run_id, tool_identity="search", tool_call_id="third", limit=99
            ) == ToolCallReservation(2, 2, False, "call_limit_reached")

    asyncio.run(scenario())


def test_duplicate_delivery_across_clients_never_dispatches_twice() -> None:
    async def scenario() -> None:
        server = FakeServer()
        async with FakeRedis(server=server) as first_client, FakeRedis(server=server) as second_client:
            run = await RedisRunStore(first_client).create_run()
            stores = (RedisToolCallLimitStore(first_client), RedisToolCallLimitStore(second_client))
            results = await asyncio.gather(
                *(
                    stores[index % 2].reserve(run_id=run.run_id, tool_identity="search", tool_call_id="same", limit=3)
                    for index in range(12)
                )
            )
            assert sum(result.allowed for result in results) == 1
            assert {result.used for result in results} == {1}
            assert {result.reason for result in results if not result.allowed} == {"duplicate_tool_call"}

    asyncio.run(scenario())


def test_run_and_tool_scoping_and_new_run_reset() -> None:
    async def scenario() -> None:
        async with FakeRedis() as client:
            run_store = RedisRunStore(client)
            store = RedisToolCallLimitStore(client)
            first_run, second_run = await run_store.create_run(), await run_store.create_run()
            for run_id, tool in (
                (first_run.run_id, "search"),
                (first_run.run_id, "export"),
                (second_run.run_id, "search"),
            ):
                assert await store.usage(run_id=run_id, tool_identity=tool, limit=1) == ToolCallUsage(0, 1)
                assert await store.reserve(
                    run_id=run_id, tool_identity=tool, tool_call_id="same-id", limit=1
                ) == ToolCallReservation(1, 1, True)
            assert await store.reserve(
                run_id=first_run.run_id, tool_identity="search", tool_call_id="new-id", limit=100
            ) == ToolCallReservation(1, 1, False, "call_limit_reached")

    asyncio.run(scenario())


def test_quota_has_exactly_the_run_record_lifetime_and_survives_event_and_terminal_writes() -> None:
    async def scenario() -> None:
        async with FakeRedis() as client:
            run_store = RedisRunStore(client, prefix="test", run_retention_seconds=120)
            store = RedisToolCallLimitStore(client, prefix="test")
            run = await run_store.create_run()
            key = run_record_key("test", run.run_id)
            assert await client.expire(key, 30)
            previous_ttl = await client.pttl(key)
            assert (
                await store.reserve(run_id=run.run_id, tool_identity="search", tool_call_id="call", limit=3)
            ).allowed
            assert 0 < await client.pttl(key) <= previous_ttl
            previous_ttl = await client.pttl(key)
            assert await store.usage(run_id=run.run_id, tool_identity="search", limit=3) == ToolCallUsage(1, 3)
            assert 0 < await client.pttl(key) <= previous_ttl
            await run_store.append_event(RunStartedEvent(run_id=run.run_id))
            assert await client.ttl(key) > 30
            assert await store.usage(run_id=run.run_id, tool_identity="search", limit=3) == ToolCallUsage(1, 3)
            await run_store.finalize_run(
                RunFailedEvent(run_id=run.run_id, data=RunFailedEventData(error="interrupted"))
            )
            persisted = await run_store.get_run(run.run_id)
            assert persisted.tool_call_limits[tool_call_digest("search")].used == 1
            assert set(await client.keys("*")) == {key.encode(), f"test:runs:{run.run_id}:events".encode()}
            with pytest.raises(ToolCallLimitRunUnavailable):
                await store.reserve(run_id=run.run_id, tool_identity="search", tool_call_id="after-end", limit=3)

    asyncio.run(scenario())


def test_missing_expired_and_cancelling_runs_fail_closed() -> None:
    async def scenario() -> None:
        async with FakeRedis() as client:
            run_store = RedisRunStore(client)
            store = RedisToolCallLimitStore(client)
            with pytest.raises(ToolCallLimitRunUnavailable):
                await store.reserve(run_id="missing", tool_identity="search", tool_call_id="call", limit=3)
            expired = await run_store.create_run()
            await client.delete(run_record_key("dify-agent", expired.run_id))
            with pytest.raises(ToolCallLimitRunUnavailable):
                await store.reserve(run_id=expired.run_id, tool_identity="search", tool_call_id="call", limit=3)
            cancelling = await run_store.create_run()
            await run_store.request_cancellation(cancelling.run_id, CancelRunRequest(reason="stop"))
            with pytest.raises(ToolCallLimitRunUnavailable):
                await store.reserve(run_id=cancelling.run_id, tool_identity="search", tool_call_id="call", limit=3)
            with pytest.raises(ToolCallLimitRunUnavailable):
                await store.usage(run_id=cancelling.run_id, tool_identity="search", limit=3)

    asyncio.run(scenario())


def test_redis_dependency_failure_propagates_and_does_not_grant_dispatch() -> None:
    async def scenario() -> None:
        server = FakeServer()
        async with FakeRedis(server=server) as client:
            run = await RedisRunStore(client).create_run()
            store = RedisToolCallLimitStore(client)
            server.connected = False
            with pytest.raises(RedisConnectionError):
                await store.reserve(run_id=run.run_id, tool_identity="search", tool_call_id="call", limit=3)
            server.connected = True
            assert await store.usage(run_id=run.run_id, tool_identity="search", limit=3) == ToolCallUsage(0, 3)

    asyncio.run(scenario())


def test_large_integer_limit_survives_cjson_rewrites_without_rounding() -> None:
    async def scenario() -> None:
        async with FakeRedis() as client:
            run_store = RedisRunStore(client)
            store = RedisToolCallLimitStore(client)
            run = await run_store.create_run()
            limit = 10**40 + 123
            first = await store.reserve(run_id=run.run_id, tool_identity="search", tool_call_id="call", limit=limit)
            assert first == ToolCallReservation(1, limit, True)
            await run_store.append_event(RunStartedEvent(run_id=run.run_id))
            assert await store.usage(run_id=run.run_id, tool_identity="search", limit=3) == ToolCallUsage(1, limit)
            loaded = await run_store.get_run(run.run_id)
            assert loaded.tool_call_limits[tool_call_digest("search")].limit == str(limit)

    asyncio.run(scenario())


@pytest.mark.parametrize("limit", [0, -1, True, 1.0, "3"])
def test_invalid_limit_is_rejected_before_a_redis_request(limit: object) -> None:
    async def scenario() -> None:
        server = FakeServer()
        server.connected = False
        async with FakeRedis(server=server) as client:
            with pytest.raises(ValueError, match="positive integer"):
                await RedisToolCallLimitStore(client).reserve(
                    run_id="run", tool_identity="search", tool_call_id="call", limit=cast(int, limit)
                )

    asyncio.run(scenario())


@pytest.mark.parametrize("terminal", ["succeeded", "failed", "cancelled"])
def test_terminal_events_include_atomic_reservations_even_without_tool_result_events(terminal: str) -> None:
    async def scenario() -> None:
        from dify_agent.protocol.schemas import RUN_EVENT_ADAPTER, RunSucceededEvent, RunSucceededEventData
        from dify_agent.protocol.snapshot import SessionSnapshot
        from dify_agent.storage.redis_keys import run_events_key

        async with FakeRedis() as client:
            run_store = RedisRunStore(client, prefix="test")
            quota = RedisToolCallLimitStore(client, prefix="test")
            run = await run_store.create_run()
            identity = '["plugin","langgenius/github/github","search"]'
            limit = 10**40 + 123
            for index in range(2):
                admitted = await quota.reserve(
                    run_id=run.run_id, tool_identity=identity, tool_call_id=f"raw-call-{index}", limit=limit
                )
                assert admitted.allowed
            snapshot = SessionSnapshot(layers={"history": {"messages": []}, "tools": {}})
            original_payload = None
            if terminal == "cancelled":
                await run_store.request_cancellation(run.run_id, CancelRunRequest(reason="stop"))
                intent = await run_store.get_cancellation_intent(run.run_id)
                assert intent is not None
                finalization = await run_store.finalize_cancellation(run.run_id, intent, session_snapshot=snapshot)
            else:
                if terminal == "succeeded":
                    event = RunSucceededEvent(
                        run_id=run.run_id,
                        data=RunSucceededEventData(
                            output={"tool_call_limits": {}, "empty": {}, "large": 2**53 + 123},
                            session_snapshot=snapshot,
                        ),
                    )
                else:
                    event = RunFailedEvent(
                        run_id=run.run_id, data=RunFailedEventData(error="interrupted", session_snapshot=snapshot)
                    )
                original_payload = RUN_EVENT_ADAPTER.dump_json(event, exclude={"id", "tool_call_limits"})
                finalization = await run_store.finalize_run(event)
            assert finalization.applied
            records = await client.xrange(run_events_key("test", run.run_id))
            assert len(records) == 1
            payload = records[0][1][b"payload"]
            assert b'"tools":{}' in payload
            assert b"raw-call-0" not in payload and b"raw-call-1" not in payload
            if original_payload is not None:
                assert payload.startswith(original_payload[:-1] + b',"tool_call_limits":')
            page = await run_store.get_events(run.run_id)
            assert len(page.events) == 1
            terminal_event = page.events[0]
            assert terminal_event.type == f"run_{terminal}"
            summary = terminal_event.tool_call_limits[tool_call_digest(identity)]
            assert summary.tool_identity == identity
            assert summary.limit == limit and summary.used == 2
            assert summary.call_ids == {tool_call_digest("raw-call-0"): 1, tool_call_digest("raw-call-1"): 2}
            assert set(summary.model_dump(mode="json")) == {"tool_identity", "limit", "used", "call_ids"}
            assert (
                terminal_event.model_dump(mode="json")["tool_call_limits"][tool_call_digest(identity)]["limit"] == limit
            )
            if terminal == "succeeded":
                assert terminal_event.data.output["tool_call_limits"] == {}
                assert terminal_event.data.output["empty"] == {}

    asyncio.run(scenario())


def test_callers_cannot_forge_the_terminal_quota_summary() -> None:
    async def scenario() -> None:
        from dify_agent.protocol.tool_call_limits import ToolCallLimitSnapshot

        async with FakeRedis() as client:
            run_store = RedisRunStore(client)
            run = await run_store.create_run()
            event = RunFailedEvent(
                run_id=run.run_id,
                data=RunFailedEventData(error="interrupted"),
                tool_call_limits={
                    "forged": ToolCallLimitSnapshot(tool_identity="operation", limit=99, used=1, call_ids={"forged": 1})
                },
            )
            with pytest.raises(ValueError, match="owned by run storage"):
                await run_store.finalize_run(event)
            assert (await run_store.get_run(run.run_id)).status == "running"
            assert not (await run_store.get_events(run.run_id)).events

    asyncio.run(scenario())


def test_cancellation_seals_quota_and_summary_at_the_same_reserved_usage() -> None:
    async def scenario() -> None:
        async with FakeRedis() as client:
            run_store = RedisRunStore(client)
            quota = RedisToolCallLimitStore(client)
            run = await run_store.create_run()
            await quota.reserve(run_id=run.run_id, tool_identity="operation", tool_call_id="pending", limit=3)
            await run_store.request_cancellation(run.run_id, CancelRunRequest(reason="stop"))
            with pytest.raises(ToolCallLimitRunUnavailable):
                await quota.reserve(run_id=run.run_id, tool_identity="operation", tool_call_id="late", limit=3)
            intent = await run_store.get_cancellation_intent(run.run_id)
            assert intent is not None
            assert (await run_store.finalize_cancellation(run.run_id, intent)).applied
            assert not (await run_store.finalize_cancellation(run.run_id, intent)).applied
            events = (await run_store.get_events(run.run_id)).events
            assert len(events) == 1
            summary = events[0].tool_call_limits[tool_call_digest("operation")]
            assert summary.used == 1 and summary.call_ids == {tool_call_digest("pending"): 1}
            with pytest.raises(ToolCallLimitRunUnavailable):
                await quota.reserve(run_id=run.run_id, tool_identity="operation", tool_call_id="after", limit=3)

    asyncio.run(scenario())
