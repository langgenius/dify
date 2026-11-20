import asyncio
from typing import cast

import pytest

from dify_agent.runtime.tool_call_limits import (
    InMemoryToolCallLimitStore,
    ToolCallLimitRunUnavailable,
    ToolCallReservation,
    ToolCallUsage,
    tool_call_digest,
)


def test_run_and_tool_identity_own_independent_quotas() -> None:
    async def scenario() -> None:
        store = InMemoryToolCallLimitStore()
        assert await store.usage(run_id="run-a", tool_identity="search", limit=3) == ToolCallUsage(0, 3)
        assert await store.reserve(
            run_id="run-a", tool_identity="search", tool_call_id="call-1", limit=3
        ) == ToolCallReservation(1, 3, True)
        assert await store.reserve(
            run_id="run-a", tool_identity="search", tool_call_id="call-2", limit=3
        ) == ToolCallReservation(2, 3, True)
        assert await store.reserve(
            run_id="run-a", tool_identity="search", tool_call_id="call-3", limit=3
        ) == ToolCallReservation(3, 3, True)
        assert await store.reserve(
            run_id="run-a", tool_identity="search", tool_call_id="call-4", limit=3
        ) == ToolCallReservation(3, 3, False, "call_limit_reached")
        assert await store.reserve(
            run_id="run-a", tool_identity="export", tool_call_id="call-4", limit=1
        ) == ToolCallReservation(1, 1, True)
        assert await InMemoryToolCallLimitStore().reserve(
            run_id="run-b", tool_identity="search", tool_call_id="call-1", limit=3
        ) == ToolCallReservation(1, 3, True)

    asyncio.run(scenario())


def test_duplicate_dispatch_is_rejected_without_refunding_or_consuming_twice() -> None:
    async def scenario() -> None:
        store = InMemoryToolCallLimitStore()
        first = await store.reserve(run_id="run", tool_identity="search", tool_call_id="same", limit=3)
        duplicate = await store.reserve(run_id="run", tool_identity="search", tool_call_id="same", limit=100)
        assert first == ToolCallReservation(1, 3, True)
        assert duplicate == ToolCallReservation(1, 3, False, "duplicate_tool_call")
        assert await store.usage(run_id="run", tool_identity="search", limit=100) == ToolCallUsage(1, 3)

    asyncio.run(scenario())


def test_parallel_calls_cannot_overbook_the_final_slot() -> None:
    async def scenario() -> None:
        store = InMemoryToolCallLimitStore()
        results = await asyncio.gather(
            *(
                store.reserve(run_id="run", tool_identity="search", tool_call_id=f"call-{index}", limit=1)
                for index in range(24)
            )
        )
        assert sum(result.allowed for result in results) == 1
        assert {result.used for result in results} == {1}

    asyncio.run(scenario())


def test_owner_closes_admission_before_cleanup_and_seals_a_detached_snapshot() -> None:
    async def scenario() -> None:
        store = InMemoryToolCallLimitStore()
        limit = 2**53 + 123
        await store.reserve(run_id="run", tool_identity="search", tool_call_id="pending", limit=limit)
        store.close_admission()
        with pytest.raises(ToolCallLimitRunUnavailable):
            await store.reserve(run_id="run", tool_identity="search", tool_call_id="cleanup", limit=limit)
        snapshot = store.seal()
        operation = tool_call_digest("search")
        assert snapshot[operation].limit == limit
        assert snapshot[operation].used == 1
        assert snapshot[operation].call_ids == {tool_call_digest("pending"): 1}
        snapshot[operation].call_ids.clear()
        snapshot.clear()
        assert store.seal()[operation].call_ids == {tool_call_digest("pending"): 1}
        with pytest.raises(ToolCallLimitRunUnavailable):
            await store.reserve(run_id="run", tool_identity="search", tool_call_id="after", limit=limit)
        assert await store.usage(run_id="run", tool_identity="search", limit=1) == ToolCallUsage(1, limit)

    asyncio.run(scenario())


def test_a_counter_cannot_be_reused_for_another_run_to_reset_allowance() -> None:
    async def scenario() -> None:
        store = InMemoryToolCallLimitStore()
        await store.reserve(run_id="run-a", tool_identity="search", tool_call_id="same", limit=1)
        with pytest.raises(ToolCallLimitRunUnavailable, match="exactly one run"):
            await store.reserve(run_id="run-b", tool_identity="search", tool_call_id="same", limit=1)
        fresh = InMemoryToolCallLimitStore()
        assert (await fresh.reserve(run_id="run-b", tool_identity="search", tool_call_id="same", limit=1)).allowed

    asyncio.run(scenario())


@pytest.mark.parametrize("limit", [0, -1, 1.0, True, "3", None])
def test_only_strict_positive_integers_are_accepted(limit: object) -> None:
    async def scenario() -> None:
        store = InMemoryToolCallLimitStore()
        with pytest.raises(ValueError, match="positive integer"):
            await store.reserve(run_id="run", tool_identity="search", tool_call_id="call", limit=cast(int, limit))
        assert await store.usage(run_id="run", tool_identity="search", limit=3) == ToolCallUsage(0, 3)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "run_id,tool_identity,tool_call_id", [(" ", "search", "call"), ("run", "", "call"), ("run", "search", " ")]
)
def test_identifiers_must_not_be_blank(run_id: str, tool_identity: str, tool_call_id: str) -> None:
    async def scenario() -> None:
        with pytest.raises(ValueError, match="blank"):
            await InMemoryToolCallLimitStore().reserve(
                run_id=run_id, tool_identity=tool_identity, tool_call_id=tool_call_id, limit=3
            )

    asyncio.run(scenario())
