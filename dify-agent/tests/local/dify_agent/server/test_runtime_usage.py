from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from dify_agent.server.runtime_usage import BestEffortRuntimeUsageObserver, RuntimeUsageClient


def _event(event_id: str = "event-1") -> dict[str, Any]:
    return {"id": event_id, "source": "application", "type": "operation_observed", "payload": {"operation": "pause"}}


def _ack(request: httpx.Request) -> httpx.Response:
    count = len(json.loads(request.content)["events"])
    return httpx.Response(200, json={"accepted": count, "duplicates": 0, "conflicts": 0, "ignored": 0})


async def _stop(task: asyncio.Task[None]) -> None:
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


def test_observer_does_not_suspend_or_send_http_on_business_path_and_drops_when_full() -> None:
    async def scenario() -> None:
        calls = []

        async def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return _ack(request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            observer = BestEffortRuntimeUsageObserver(
                RuntimeUsageClient(http, "http://inner", "inner", "project"), buffer_size=1
            )
            # One send must finish the coroutine without yielding: there cannot
            # be a new cancellation point after an E2B handle is created.
            for event in (_event(), _event("overflow")):
                coroutine = observer.observe_safely(event)
                with pytest.raises(StopIteration):
                    coroutine.send(None)
            assert calls == []
            assert observer.dropped_events == 1
            task = asyncio.create_task(observer.run())
            await observer.flush_on_shutdown(timeout_seconds=1)
            await _stop(task)
            assert len(calls) == 1
            assert json.loads(calls[0].content)["events"][0]["id"] == "event-1"

    asyncio.run(scenario())


def test_direct_http_delivery_batches_and_snapshots_mutable_events() -> None:
    async def scenario() -> None:
        received: list[dict[str, Any]] = []
        sizes: list[int] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/inner/api/agent/sandbox-usage/events"
            assert request.headers["X-Inner-Api-Key"] == "inner-only"
            assert "X-API-Key" not in request.headers
            body = json.loads(request.content)
            assert body["project_id"] == "project"
            sizes.append(len(body["events"]))
            received.extend(body["events"])
            return _ack(request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            observer = BestEffortRuntimeUsageObserver(RuntimeUsageClient(http, "http://inner", "inner-only", "project"))
            first = _event("0")
            await observer.observe_safely(first)
            first["payload"]["operation"] = "mutated-after-enqueue"
            for i in range(1, 105):
                await observer.observe_safely(_event(str(i)))
            task = asyncio.create_task(observer.run())
            await observer.flush_on_shutdown(timeout_seconds=1)
            await _stop(task)
        assert sizes == [100, 5]
        assert [event["id"] for event in received] == [str(i) for i in range(105)]
        assert received[0]["payload"]["operation"] == "pause"
        assert observer.dropped_events == 0

    asyncio.run(scenario())


@pytest.mark.parametrize("failure", ["status", "network", "timeout", "ack"])
def test_failed_batch_is_not_retried_and_later_observations_continue(failure: str) -> None:
    async def scenario() -> None:
        calls: list[list[str]] = []
        first_request = asyncio.Event()

        async def handler(request: httpx.Request) -> httpx.Response:
            calls.append([event["id"] for event in json.loads(request.content)["events"]])
            if len(calls) == 1:
                first_request.set()
                if failure == "status":
                    return httpx.Response(503)
                if failure == "network":
                    raise httpx.ConnectError("unavailable", request=request)
                if failure == "timeout":
                    await asyncio.Event().wait()
                return httpx.Response(200, json={"accepted": 0, "duplicates": 0, "conflicts": 0, "ignored": 0})
            return _ack(request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            observer = BestEffortRuntimeUsageObserver(
                RuntimeUsageClient(http, "http://inner", "inner", "project"), send_timeout_seconds=0.02
            )
            await observer.observe_safely(_event("drop-1"))
            await observer.observe_safely(_event("drop-2"))
            task = asyncio.create_task(observer.run())
            async with asyncio.timeout(1):
                await first_request.wait()
            await observer.flush_on_shutdown(timeout_seconds=1)
            assert observer.failed_batches == 1
            assert observer.dropped_events == 2
            await observer.observe_safely(_event("later"))
            await observer.flush_on_shutdown(timeout_seconds=1)
            await _stop(task)
            assert calls == [["drop-1", "drop-2"], ["later"]]

    asyncio.run(scenario())


def test_shutdown_timeout_is_bounded_and_cancellation_drops_remaining_logs() -> None:
    async def scenario() -> None:
        entered = asyncio.Event()
        cancelled = asyncio.Event()
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
            return _ack(request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            observer = BestEffortRuntimeUsageObserver(RuntimeUsageClient(http, "http://inner", "inner", "project"))
            await observer.observe_safely(_event("in-flight"))
            task = asyncio.create_task(observer.run())
            async with asyncio.timeout(1):
                await entered.wait()
            await observer.observe_safely(_event("queued"))
            async with asyncio.timeout(0.5):
                await observer.flush_on_shutdown(timeout_seconds=0.01)
            assert not task.done()
            await _stop(task)
            assert cancelled.is_set()
            assert observer.dropped_events == 2
            assert calls == 1
            # A cancelled sender does not leave unfinished queue accounting.
            async with asyncio.timeout(0.5):
                await observer.flush_on_shutdown(timeout_seconds=0.1)

    asyncio.run(scenario())


def test_observation_does_not_consume_pending_resource_cancellation() -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(_ack)) as http:
            observer = BestEffortRuntimeUsageObserver(RuntimeUsageClient(http, "http://inner", "inner", "project"))

            async def resource_operation() -> None:
                task = asyncio.current_task()
                assert task is not None
                task.cancel()
                await observer.observe_safely(_event())
                # The observation did not swallow cancellation or add a yield;
                # the original operation owns its next cancellation point.
                await asyncio.sleep(0)
                raise AssertionError("resource cancellation was consumed")

            task = asyncio.create_task(resource_operation())
            with pytest.raises(asyncio.CancelledError):
                await task

    asyncio.run(scenario())


def test_client_rejects_wrong_project_state_and_incomplete_ack() -> None:
    async def scenario() -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(
                    200, json={"enabled": True, "project_id": "wrong", "started_at": "2026-09-20T00:00:00Z"}
                )
            return httpx.Response(200, json={"accepted": 0, "duplicates": 0, "conflicts": 0, "ignored": 0})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = RuntimeUsageClient(http, "http://inner", "inner", "project")
            with pytest.raises(ValueError, match="project mismatch"):
                await client.get_state()
            with pytest.raises(ValueError, match="entire batch"):
                await client.post_events([_event()])

    asyncio.run(scenario())


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
