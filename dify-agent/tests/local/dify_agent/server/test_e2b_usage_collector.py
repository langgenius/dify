from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
import json
from typing import Any

import httpx
import pytest

from dify_agent.server.e2b_usage_collector import E2BUsageCollector, provider_event
from dify_agent.server.e2b_usage_client import E2BUsageApiClient

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
                E2BUsageApiClient(i, "http://inner", "inner", "project"),
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
                E2BUsageApiClient(i, "http://inner", "inner", "project"),
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
                p, E2BUsageApiClient(i, "http://inner", "inner", "project"), "provider", "project", clock=lambda: NOW
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
                p, E2BUsageApiClient(i, "http://inner", "inner", "project"), "provider", "project", clock=lambda: NOW
            )
            assert not await collector.collect_once()
            state.update(enabled=True, started_at=(NOW + timedelta(hours=1)).isoformat())
            assert not await collector.collect_once()

    asyncio.run(scenario())
