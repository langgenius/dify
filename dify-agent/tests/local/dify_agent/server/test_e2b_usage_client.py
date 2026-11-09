from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from dify_agent.server.e2b_usage_client import E2BUsageApiClient


def _event(event_id: str = "event-1") -> dict[str, Any]:
    return {"id": event_id, "source": "provider", "type": "sandbox.lifecycle.paused", "payload": {}}


def _ack(request: httpx.Request) -> httpx.Response:
    count = len(json.loads(request.content)["events"])
    return httpx.Response(200, json={"accepted": count, "duplicates": 0, "conflicts": 0, "ignored": 0})


def test_client_rejects_wrong_project_state_and_incomplete_ack() -> None:
    async def scenario() -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(
                    200, json={"enabled": True, "project_id": "wrong", "started_at": "2026-09-20T00:00:00Z"}
                )
            return httpx.Response(200, json={"accepted": 0, "duplicates": 0, "conflicts": 0, "ignored": 0})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = E2BUsageApiClient(http, "http://inner", "inner", "project")
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

        events = [{**_event(str(i)), "payload": {"provider_metadata": "x" * 60000}} for i in range(40)]
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = E2BUsageApiClient(http, "http://inner", "inner", "project")
            with pytest.raises(httpx.HTTPStatusError):
                await client.post_events(events)
            fail_second = False
            await client.post_events(events)
        assert bodies[0] == bodies[2]
        assert [event["id"] for batch in bodies[2:] for event in batch] == [str(i) for i in range(40)]

    asyncio.run(scenario())
