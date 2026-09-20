from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from dify_agent.server.runtime_usage import DirectRuntimeUsageObserver, RuntimeUsageClient


def _event(event_id: str = "event-1") -> dict[str, Any]:
    return {"id": event_id, "source": "application", "type": "operation_observed", "payload": {"operation": "pause"}}


def _ack(request: httpx.Request) -> httpx.Response:
    count = len(json.loads(request.content)["events"])
    return httpx.Response(200, json={"accepted": count, "duplicates": 0, "conflicts": 0, "ignored": 0})


def test_observation_waits_for_one_http_request_without_background_delivery() -> None:
    async def scenario() -> None:
        entered = asyncio.Event()
        finish = asyncio.Event()
        received: list[dict[str, Any]] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/inner/api/agent/sandbox-usage/events"
            assert request.headers["X-Inner-Api-Key"] == "inner-only"
            assert "X-API-Key" not in request.headers
            body = json.loads(request.content)
            assert body["project_id"] == "project"
            assert len(body["events"]) == 1
            received.extend(body["events"])
            entered.set()
            await finish.wait()
            return _ack(request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            observer = DirectRuntimeUsageObserver(RuntimeUsageClient(http, "http://inner", "inner-only", "project"))
            call = asyncio.create_task(observer.observe_safely(_event()))
            async with asyncio.timeout(1):
                await entered.wait()
            assert not call.done()
            finish.set()
            await call
            assert received == [_event()]
            await observer.observe_safely(_event("second"))
            assert [event["id"] for event in received] == ["event-1", "second"]

    asyncio.run(scenario())


@pytest.mark.parametrize("failure", ["status", "network", "timeout", "ack"])
def test_failed_observation_is_not_retried_and_next_call_still_sends(
    failure: str, caplog: pytest.LogCaptureFixture
) -> None:
    async def scenario() -> None:
        calls: list[str] = []
        cancelled = asyncio.Event()

        async def handler(request: httpx.Request) -> httpx.Response:
            event = json.loads(request.content)["events"][0]
            calls.append(event["id"])
            if len(calls) == 1:
                if failure == "status":
                    return httpx.Response(503)
                if failure == "network":
                    raise httpx.ConnectError("sensitive-error-do-not-log", request=request)
                if failure == "timeout":
                    try:
                        await asyncio.Event().wait()
                    finally:
                        cancelled.set()
                return httpx.Response(200, json={"accepted": 0, "duplicates": 0, "conflicts": 0, "ignored": 0})
            return _ack(request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            observer = DirectRuntimeUsageObserver(
                RuntimeUsageClient(http, "http://inner", "inner", "project"), timeout_seconds=0.02
            )
            async with asyncio.timeout(0.5):
                await observer.observe_safely(_event("failed"))
            assert calls == ["failed"]
            if failure == "timeout":
                assert cancelled.is_set()
            await observer.observe_safely(_event("later"))
            assert calls == ["failed", "later"]
        assert "observation dropped" in caplog.text
        assert "sensitive-error-do-not-log" not in caplog.text

    asyncio.run(scenario())


def test_cancellation_during_http_is_propagated_and_request_is_closed() -> None:
    async def scenario() -> None:
        entered = asyncio.Event()
        closed = asyncio.Event()

        async def handler(request: httpx.Request) -> httpx.Response:
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                closed.set()
            return _ack(request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            observer = DirectRuntimeUsageObserver(RuntimeUsageClient(http, "http://inner", "inner", "project"))
            call = asyncio.create_task(observer.observe_safely(_event()))
            await entered.wait()
            call.cancel("business-cancel")
            with pytest.raises(asyncio.CancelledError, match="business-cancel"):
                await call
            assert closed.is_set()
            assert call.cancelling() == 1

    asyncio.run(scenario())


def test_observation_skips_http_without_consuming_pending_resource_cancellation() -> None:
    async def scenario() -> None:
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return _ack(request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            observer = DirectRuntimeUsageObserver(RuntimeUsageClient(http, "http://inner", "inner", "project"))

            async def resource_operation() -> None:
                task = asyncio.current_task()
                assert task is not None
                task.cancel()
                await observer.observe_safely(_event())
                assert task.cancelling() == 1
                assert calls == 0
                await asyncio.sleep(0)
                raise AssertionError("resource cancellation was consumed")

            call = asyncio.create_task(resource_operation())
            with pytest.raises(asyncio.CancelledError):
                await call

    asyncio.run(scenario())


@pytest.mark.parametrize("event", [{"id": ""}, {"id": "oversized", "payload": "x" * 65536}])
def test_invalid_diagnostics_are_discarded_without_http(event: dict[str, Any]) -> None:
    async def scenario() -> None:
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return _ack(request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            observer = DirectRuntimeUsageObserver(RuntimeUsageClient(http, "http://inner", "inner", "project"))
            await observer.observe_safely(event)
            assert calls == 0

    asyncio.run(scenario())


@pytest.mark.parametrize("timeout", [0.0, -1.0, float("inf"), float("nan")])
def test_observer_requires_a_finite_positive_deadline(timeout: float) -> None:
    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(_ack)) as http:
            with pytest.raises(ValueError, match="finite and positive"):
                DirectRuntimeUsageObserver(RuntimeUsageClient(http, "http://inner", "inner", "project"), timeout)

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
