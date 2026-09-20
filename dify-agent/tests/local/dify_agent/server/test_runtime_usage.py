from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from dify_agent.server.runtime_usage import BufferedRuntimeUsageObserver, RuntimeUsageClient, RuntimeUsageDispatcher


def _event(event_id: str = "event-1") -> dict[str, Any]:
    return {"id": event_id, "source": "application", "type": "operation_observed", "payload": {"operation": "pause"}}


class MemoryRedis:
    """Exercise outbox ACK ownership, not Redis protocol/server compatibility."""

    def __init__(self) -> None:
        self.entries: list[tuple[bytes, dict[bytes, bytes]]] = []
        self.fail = False
        self.add_calls: list[tuple[str, dict[str, str]]] = []

    async def xadd(self, key: str, fields: dict[str, str]) -> bytes:
        self.add_calls.append((key, fields))
        if self.fail:
            raise ConnectionError("offline")
        entry_id = f"{len(self.entries) + 1}-0".encode()
        self.entries.append((entry_id, {b"event": fields["event"].encode()}))
        return entry_id

    async def xrange(self, key: str, *, count: int) -> list[tuple[bytes, dict[bytes, bytes]]]:
        return self.entries[:count]

    async def xdel(self, key: str, *ids: bytes) -> int:
        self.entries = [entry for entry in self.entries if entry[0] not in ids]
        return len(ids)

    async def xlen(self, key: str) -> int:
        return len(self.entries)


def test_observer_does_not_suspend_or_touch_redis_on_business_path() -> None:
    redis = MemoryRedis()
    observer = BufferedRuntimeUsageObserver(redis=redis, project_id="project", buffer_size=1)  # type: ignore[arg-type]
    # Manually drive the coroutine: one send finishes it without yielding at all.
    # A pending cancellation cannot interrupt between a remote create and its handle return.
    coroutine = observer.observe_safely(_event())
    with pytest.raises(StopIteration):
        coroutine.send(None)
    assert redis.add_calls == []
    second = observer.observe_safely(_event("event-2"))
    with pytest.raises(StopIteration):
        second.send(None)
    assert observer.dropped_events == 1


def test_observer_retries_redis_and_dispatcher_deletes_only_after_ack() -> None:
    async def scenario() -> None:
        redis = MemoryRedis()
        redis.fail = True
        observer = BufferedRuntimeUsageObserver(
            redis=redis,
            project_id="project",
            retry_interval_seconds=0.001,  # type: ignore[arg-type]
        )
        await observer.observe_safely(_event())
        flusher = asyncio.create_task(observer.run())
        while observer.failed_flushes == 0:
            await asyncio.sleep(0)
        redis.fail = False
        await observer.flush_on_shutdown(timeout_seconds=1)
        flusher.cancel()
        await asyncio.gather(flusher, return_exceptions=True)
        assert len(redis.entries) == 1
        assert redis.add_calls[0][0] == "dify-agent:sandbox-usage:project:outbox"
        fail_api = True
        attempts: list[dict[str, Any]] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal fail_api
            attempts.append(json.loads(request.content))
            assert request.headers["X-Inner-Api-Key"] == "inner-only"
            assert "X-API-Key" not in request.headers
            if fail_api:
                return httpx.Response(503)
            return httpx.Response(200, json={"accepted": 1, "duplicates": 0, "conflicts": 0, "ignored": 0})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = RuntimeUsageClient(http, "http://inner", "inner-only", "project")
            dispatcher = RuntimeUsageDispatcher(redis=redis, observer=observer, client=client)  # type: ignore[arg-type]
            with pytest.raises(httpx.HTTPStatusError):
                await dispatcher.dispatch_once()
            assert len(redis.entries) == 1
            fail_api = False
            assert await dispatcher.dispatch_once() == 1
            assert redis.entries == []
            assert attempts[0] == attempts[1]

    asyncio.run(scenario())


def test_incomplete_ack_keeps_outbox_and_state_rejects_wrong_project() -> None:
    async def scenario() -> None:
        redis = MemoryRedis()
        await redis.xadd("ignored", {"event": json.dumps(_event())})
        observer = BufferedRuntimeUsageObserver(redis=redis, project_id="project")  # type: ignore[arg-type]

        async def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(
                    200, json={"enabled": True, "project_id": "wrong", "started_at": "2026-09-20T00:00:00Z"}
                )
            return httpx.Response(200, json={"accepted": 0, "duplicates": 0, "conflicts": 0, "ignored": 0})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = RuntimeUsageClient(http, "http://inner", "inner", "project")
            dispatcher = RuntimeUsageDispatcher(redis=redis, observer=observer, client=client)  # type: ignore[arg-type]
            with pytest.raises(ValueError, match="entire batch"):
                await dispatcher.dispatch_once()
            assert len(redis.entries) == 1
            with pytest.raises(ValueError, match="project mismatch"):
                await client.get_state()

    asyncio.run(scenario())


def test_flusher_shutdown_is_bounded_when_redis_is_unavailable() -> None:
    async def scenario() -> None:
        redis = MemoryRedis()
        redis.fail = True
        observer = BufferedRuntimeUsageObserver(redis=redis, project_id="project")  # type: ignore[arg-type]
        await observer.observe_safely(_event())
        task = asyncio.create_task(observer.run())
        await observer.flush_on_shutdown(timeout_seconds=0.001)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert redis.entries == []

    asyncio.run(scenario())


@pytest.mark.integration
def test_real_redis_outbox_survives_restart_and_has_no_run_ttl() -> None:
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path

    from redis.asyncio import Redis
    from redis.exceptions import ConnectionError as RedisConnectionError

    executable = shutil.which("redis-server")
    if executable is None:
        pytest.skip("requires local redis-server executable")

    async def scenario(directory: str) -> None:
        socket = str(Path(directory) / "redis.sock")
        command = [
            executable,
            "--port",
            "0",
            "--unixsocket",
            socket,
            "--dir",
            directory,
            "--save",
            "",
            "--appendonly",
            "yes",
            "--appendfsync",
            "always",
        ]

        async def connect() -> Redis:
            client = Redis(unix_socket_path=socket)
            async with asyncio.timeout(5):
                while True:
                    try:
                        await client.ping()
                        return client
                    except RedisConnectionError:
                        await asyncio.sleep(0.01)

        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        client = None
        try:
            client = await connect()
            observer = BufferedRuntimeUsageObserver(redis=client, project_id="project")
            task = asyncio.create_task(observer.run())
            await observer.observe_safely(_event())
            await observer.flush_on_shutdown(timeout_seconds=1)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            assert await client.xlen(observer.stream_key) == 1
            assert await client.ttl(observer.stream_key) == -1
            await client.aclose()
            process.terminate()
            process.wait(timeout=5)
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            client = await connect()
            assert await client.xlen(observer.stream_key) == 1
            replacement = BufferedRuntimeUsageObserver(redis=client, project_id="project")

            async def committed(request: httpx.Request) -> httpx.Response:
                assert json.loads(request.content)["events"][0]["id"] == "event-1"
                return httpx.Response(200, json={"accepted": 1, "duplicates": 0, "conflicts": 0, "ignored": 0})

            async with httpx.AsyncClient(transport=httpx.MockTransport(committed)) as http:
                dispatcher = RuntimeUsageDispatcher(
                    client=RuntimeUsageClient(http, "http://inner", "inner", "project"),
                    redis=client,
                    observer=replacement,
                )
                assert await dispatcher.dispatch_once() == 1
                assert await client.xlen(observer.stream_key) == 0
        finally:
            if client is not None:
                await client.aclose()
            process.terminate()
            process.wait(timeout=5)

    with tempfile.TemporaryDirectory(prefix="usage-redis-", dir="/tmp") as directory:
        asyncio.run(scenario(directory))


def test_large_batches_respect_api_byte_limit_and_keep_stable_ids_on_retry() -> None:
    async def scenario() -> None:
        bodies: list[list[dict[str, Any]]] = []
        fail_second = True

        async def handler(request: httpx.Request) -> httpx.Response:
            assert len(request.content) <= 1024 * 1024
            assert request.headers["Content-Type"] == "application/json"
            batch = json.loads(request.content)["events"]
            bodies.append(batch)
            if fail_second and len(bodies) == 2:
                return httpx.Response(503)
            return httpx.Response(200, json={"accepted": len(batch), "duplicates": 0, "conflicts": 0, "ignored": 0})

        events = [{**_event(str(i)), "payload": {"diagnostic": "x" * 60000}} for i in range(40)]
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = RuntimeUsageClient(http, "http://inner", "inner", "project")
            with pytest.raises(httpx.HTTPStatusError):
                await client.post_events(events)
            fail_second = False
            await client.post_events(events)
        assert bodies[0] == bodies[2]
        assert [event["id"] for batch in bodies[2:] for event in batch] == [str(i) for i in range(40)]

    asyncio.run(scenario())


def test_dispatcher_progresses_through_oversized_outbox_without_deleting_unsent_entries() -> None:
    async def scenario() -> None:
        redis = MemoryRedis()
        observer = BufferedRuntimeUsageObserver(redis=redis, project_id="project")  # type: ignore[arg-type]
        for i in range(40):
            await redis.xadd(
                observer.stream_key, {"event": json.dumps({**_event(str(i)), "payload": {"detail": "x" * 60000}})}
            )
        received: list[str] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            assert len(request.content) <= 1024 * 1024
            batch = json.loads(request.content)["events"]
            received.extend(event["id"] for event in batch)
            return httpx.Response(200, json={"accepted": len(batch), "duplicates": 0, "conflicts": 0, "ignored": 0})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            dispatcher = RuntimeUsageDispatcher(
                redis=redis, observer=observer, client=RuntimeUsageClient(http, "http://inner", "inner", "project")
            )  # type: ignore[arg-type]
            first = await dispatcher.dispatch_once()
            assert 0 < first < 40
            assert len(redis.entries) == 40 - first
            while redis.entries:
                await dispatcher.dispatch_once()
        assert received == [str(i) for i in range(40)]

    asyncio.run(scenario())
