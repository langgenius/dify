from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
import json
from typing import Any

import httpx
import pytest

from dify_agent.server.e2b_usage_collector import E2BUsageCollector, provider_event
from dify_agent.server.runtime_usage import RuntimeUsageClient

NOW = datetime(2026, 9, 20, 1, tzinfo=UTC)
T0 = NOW - timedelta(hours=1)


def _provider(event_id: str = "event-1", timestamp: datetime = NOW) -> dict[str, Any]:
    return {
        "version": "v2",
        "id": event_id,
        "type": "sandbox.lifecycle.paused",
        "sandboxId": "sandbox-1",
        "sandboxTeamId": "project",
        "sandboxExecutionId": "execution-1",
        "timestamp": timestamp.isoformat(),
        "eventData": {
            "execution": {"execution_time": 1234, "memory_mb": 1024, "vcpu_count": 2, "started_at": T0.isoformat()}
        },
    }


def _state(**kwargs: Any) -> dict[str, Any]:
    return {"enabled": True, "project_id": "project", "started_at": T0.isoformat(), **kwargs}


def test_actual_v2_camel_case_shape_is_preserved_and_project_checked() -> None:
    raw = _provider()
    raw["timestamp"] = "2026-09-20T01:00:00.551745815Z"
    event = provider_event(raw, project_id="project")
    assert event["id"] == raw["id"]
    assert event["execution_id"] == "execution-1"
    assert event["payload"] == raw
    with pytest.raises(ValueError, match="project mismatch"):
        provider_event(raw, project_id="other")


def test_complete_scan_acks_all_pages_before_checkpoint_and_resets_offset() -> None:
    async def scenario() -> None:
        offsets: list[int] = []
        batches: list[list[dict[str, Any]]] = []

        async def provider(request: httpx.Request) -> httpx.Response:
            assert request.headers["X-API-Key"] == "provider-only"
            assert "X-Inner-Api-Key" not in request.headers
            assert request.url.params["orderAsc"] == "false"
            offset = int(request.url.params["offset"])
            offsets.append(offset)
            if offset == 0:
                return httpx.Response(200, json=[_provider(str(i)) for i in range(100)])
            return httpx.Response(200, json=[_provider("old", T0 - timedelta(seconds=1))])

        async def inner(request: httpx.Request) -> httpx.Response:
            assert "X-API-Key" not in request.headers
            if request.method == "GET":
                return httpx.Response(200, json=_state())
            batch = json.loads(request.content)["events"]
            batches.append(batch)
            return httpx.Response(200, json={"accepted": len(batch), "duplicates": 0, "conflicts": 0, "ignored": 0})

        async with (
            httpx.AsyncClient(transport=httpx.MockTransport(provider)) as p,
            httpx.AsyncClient(transport=httpx.MockTransport(inner)) as i,
        ):
            collector = E2BUsageCollector(
                p,
                RuntimeUsageClient(i, "http://inner", "inner", "project"),
                "provider-only",
                "project",
                clock=lambda: NOW,
            )
            assert await collector.collect_once()
            assert len(batches) == 2
            assert len(batches[0]) == 100
            checkpoint = batches[1][0]
            assert checkpoint["type"] == "collector_checkpoint"
            assert checkpoint["payload"]["window_start"] == T0.isoformat()
            assert checkpoint["payload"]["pages"] == 2
            assert await collector.collect_once()
            assert offsets == [0, 100, 0, 100]

    asyncio.run(scenario())


@pytest.mark.parametrize("failure", ["max_pages", "api_failure", "wrong_project"])
def test_incomplete_scan_never_advances_checkpoint(failure: str) -> None:
    async def scenario() -> None:
        events: list[dict[str, Any]] = []

        async def provider(request: httpx.Request) -> httpx.Response:
            raw = _provider()
            if failure == "wrong_project":
                raw["sandboxTeamId"] = "other"
            return httpx.Response(200, json=[raw] * 100)

        async def inner(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(200, json=_state())
            if failure == "api_failure":
                return httpx.Response(503)
            batch = json.loads(request.content)["events"]
            events.extend(batch)
            return httpx.Response(200, json={"accepted": len(batch), "duplicates": 0, "conflicts": 0, "ignored": 0})

        async with (
            httpx.AsyncClient(transport=httpx.MockTransport(provider)) as p,
            httpx.AsyncClient(transport=httpx.MockTransport(inner)) as i,
        ):
            collector = E2BUsageCollector(
                p,
                RuntimeUsageClient(i, "http://inner", "inner", "project"),
                "provider",
                "project",
                max_pages=1,
                clock=lambda: NOW,
            )
            if failure == "max_pages":
                assert not await collector.collect_once()
            elif failure == "api_failure":
                with pytest.raises(httpx.HTTPStatusError):
                    await collector.collect_once()
            else:
                with pytest.raises(ValueError, match="project mismatch"):
                    await collector.collect_once()
            assert all(event["type"] != "collector_checkpoint" for event in events)

    asyncio.run(scenario())


def test_incremental_overlap_and_retention_gap_are_explicit() -> None:
    async def scenario() -> None:
        state = _state(checkpoint_at=(NOW - timedelta(minutes=5)).isoformat(), full_scan_at=NOW.isoformat())
        sent: list[dict[str, Any]] = []

        async def provider(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=[])

        async def inner(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(200, json=state)
            batch = json.loads(request.content)["events"]
            sent.extend(batch)
            return httpx.Response(200, json={"accepted": len(batch), "duplicates": 0, "conflicts": 0, "ignored": 0})

        async with (
            httpx.AsyncClient(transport=httpx.MockTransport(provider)) as p,
            httpx.AsyncClient(transport=httpx.MockTransport(inner)) as i,
        ):
            collector = E2BUsageCollector(
                p, RuntimeUsageClient(i, "http://inner", "inner", "project"), "provider", "project", clock=lambda: NOW
            )
            await collector.collect_once()
            assert sent[-1]["payload"]["window_start"] == (NOW - timedelta(minutes=20)).isoformat()
            state.update(started_at=(NOW - timedelta(days=10)).isoformat(), checkpoint_at=None, full_scan_at=None)
            await collector.collect_once()
            assert sent[-2]["type"] == "collector_retention_gap"
            assert sent[-1]["payload"]["window_start"] == (NOW - timedelta(days=7)).isoformat()

    asyncio.run(scenario())


def test_disabled_or_future_activation_does_not_contact_e2b() -> None:
    async def scenario() -> None:
        async def provider(request: httpx.Request) -> httpx.Response:
            raise AssertionError("provider must not be queried before activation")

        state = _state(enabled=False)

        async def inner(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=state)

        async with (
            httpx.AsyncClient(transport=httpx.MockTransport(provider)) as p,
            httpx.AsyncClient(transport=httpx.MockTransport(inner)) as i,
        ):
            collector = E2BUsageCollector(
                p, RuntimeUsageClient(i, "http://inner", "inner", "project"), "provider", "project", clock=lambda: NOW
            )
            assert not await collector.collect_once()
            state.update(enabled=True, started_at=(NOW + timedelta(hours=1)).isoformat())
            assert not await collector.collect_once()

    asyncio.run(scenario())


@pytest.fixture
def collector_redis_socket():
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path

    executable = shutil.which("redis-server")
    if executable is None:
        pytest.skip("requires local redis-server executable")
    with tempfile.TemporaryDirectory(prefix="usage-leader-", dir="/tmp") as directory:
        socket = str(Path(directory) / "redis.sock")
        process = subprocess.Popen(
            [executable, "--port", "0", "--unixsocket", socket, "--dir", directory, "--save", "", "--appendonly", "no"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            yield socket
        finally:
            process.terminate()
            process.wait(timeout=5)


async def _leader_test_redis(socket: str):
    from redis.asyncio import Redis
    from redis.exceptions import ConnectionError as RedisConnectionError

    redis = Redis(unix_socket_path=socket)
    async with asyncio.timeout(5):
        while True:
            try:
                await redis.ping()
                return redis
            except RedisConnectionError:
                await asyncio.sleep(0.01)


@pytest.mark.integration
def test_leader_renew_and_release_cannot_modify_successor(collector_redis_socket: str) -> None:
    from dify_agent.server.e2b_usage_collector import _CollectorLease

    async def scenario() -> None:
        redis = await _leader_test_redis(collector_redis_socket)
        try:
            old = _CollectorLease(redis, "leader", renewal_interval_seconds=0.01)
            assert await old.acquire()
            assert not await _CollectorLease(redis, "leader").acquire()
            # Model expiry/takeover deterministically without a test relying on wall-clock expiry.
            await redis.set("leader", "successor", px=10000)
            with pytest.raises(RuntimeError, match="leadership lost"):
                await old.renew()
            assert old.lost.is_set()
            assert not await old.is_owner()
            await old.release()
            assert await redis.get("leader") == b"successor"
            assert await redis.pttl("leader") <= 10000
        finally:
            await redis.aclose()

    asyncio.run(scenario())


@pytest.mark.integration
def test_only_one_collector_polls_same_project_and_shutdown_releases_lease(collector_redis_socket: str) -> None:
    async def scenario() -> None:
        redis = await _leader_test_redis(collector_redis_socket)
        calls = 0
        entered = asyncio.Event()
        tasks: list[asyncio.Task[None]] = []

        async def provider(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            entered.set()
            await asyncio.Event().wait()
            return httpx.Response(200, json=[])

        async def inner(request: httpx.Request) -> httpx.Response:
            assert request.method == "GET"  # blocked page can never produce a checkpoint
            return httpx.Response(200, json=_state())

        try:
            async with (
                httpx.AsyncClient(transport=httpx.MockTransport(provider)) as p,
                httpx.AsyncClient(transport=httpx.MockTransport(inner)) as i,
            ):
                client = RuntimeUsageClient(i, "http://inner", "inner", "project")
                collectors = [
                    E2BUsageCollector(p, client, "provider", "project", redis=redis, clock=lambda: NOW)
                    for _ in range(2)
                ]
                tasks = [asyncio.create_task(collector.run()) for collector in collectors]
                async with asyncio.timeout(2):
                    await entered.wait()
                await asyncio.sleep(0.05)
                assert calls == 1
                assert await redis.pttl("dify-agent:sandbox-usage:project:collector-lease") > 0
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                assert await redis.get("dify-agent:sandbox-usage:project:collector-lease") is None
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await redis.aclose()

    asyncio.run(scenario())


@pytest.mark.integration
def test_lost_renewal_cancels_incomplete_scan_without_checkpoint(
    collector_redis_socket: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    import dify_agent.server.e2b_usage_collector as module

    lease_class = module._CollectorLease
    monkeypatch.setattr(
        module, "_CollectorLease", lambda **kwargs: lease_class(**kwargs, renewal_interval_seconds=0.01)
    )

    async def scenario() -> None:
        redis = await _leader_test_redis(collector_redis_socket)
        entered = asyncio.Event()
        cancelled = asyncio.Event()
        posts: list[dict[str, Any]] = []
        task = None

        async def provider(request: httpx.Request) -> httpx.Response:
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
            return httpx.Response(200, json=[])

        async def inner(request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                posts.append(json.loads(request.content))
            return httpx.Response(200, json=_state())

        try:
            async with (
                httpx.AsyncClient(transport=httpx.MockTransport(provider)) as p,
                httpx.AsyncClient(transport=httpx.MockTransport(inner)) as i,
            ):
                collector = E2BUsageCollector(
                    p,
                    RuntimeUsageClient(i, "http://inner", "inner", "project"),
                    "provider",
                    "project",
                    redis=redis,
                    clock=lambda: NOW,
                )
                task = asyncio.create_task(collector.run())
                async with asyncio.timeout(2):
                    await entered.wait()
                    await redis.set("dify-agent:sandbox-usage:project:collector-lease", "successor", px=10000)
                    await cancelled.wait()
                assert posts == []
                assert await redis.get("dify-agent:sandbox-usage:project:collector-lease") == b"successor"
        finally:
            if task is not None:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await redis.aclose()

    asyncio.run(scenario())
