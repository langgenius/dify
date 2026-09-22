from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
import json
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
import pytest

import dify_agent.server.routes.e2b_usage as route_module
from dify_agent.server.routes.e2b_usage import create_e2b_usage_router
from dify_agent.server.settings import ServerSettings


def _settings(**overrides: Any) -> ServerSettings:
    config = {
        "_env_file": None,
        "sandbox_metering_enabled": True,
        "runtime_backend": "e2b",
        "api_token": "control-only",
        "e2b_api_key": "provider-only",
        "e2b_project_id": "project",
        "inner_api_key": "inner-only",
        "inner_api_url": "http://inner",
    }
    return ServerSettings(**(config | overrides))


def _app(settings: ServerSettings) -> FastAPI:
    app = FastAPI()
    app.include_router(create_e2b_usage_router(settings))
    return app


@pytest.mark.parametrize(
    ("settings", "headers", "project", "status"),
    [
        (_settings(), {}, "project", 401),
        (_settings(), {"Authorization": "Bearer wrong"}, "project", 401),
        (_settings(api_token=None), {}, "project", 503),
        (_settings(sandbox_metering_enabled=False), {"Authorization": "Bearer control-only"}, "project", 503),
        (_settings(e2b_project_id=" "), {"Authorization": "Bearer control-only"}, "project", 503),
        (_settings(e2b_api_key=None), {"Authorization": "Bearer control-only"}, "project", 503),
        (_settings(inner_api_key=None), {"Authorization": "Bearer control-only"}, "project", 503),
        (_settings(runtime_backend="local"), {"Authorization": "Bearer control-only"}, "project", 503),
        (_settings(sandbox_metering_max_pages=0), {"Authorization": "Bearer control-only"}, "project", 503),
        (_settings(sandbox_metering_max_pages="invalid"), {"Authorization": "Bearer control-only"}, "project", 503),
        (_settings(sandbox_metering_overlap_seconds=-1), {"Authorization": "Bearer control-only"}, "project", 503),
        (
            _settings(sandbox_metering_full_scan_interval_seconds=""),
            {"Authorization": "Bearer control-only"},
            "project",
            503,
        ),
        (_settings(), {"Authorization": "Bearer control-only"}, "wrong-project", 403),
        (_settings(), {"Authorization": "Bearer control-only"}, "", 422),
    ],
)
def test_collection_auth_and_configuration_errors_are_local_to_endpoint(
    settings: ServerSettings, headers: dict[str, str], project: str, status: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unexpected_collector(*args: object, **kwargs: object) -> None:
        raise AssertionError("invalid collection must not query the provider")

    monkeypatch.setattr(route_module, "E2BUsageCollector", unexpected_collector)
    with TestClient(_app(settings)) as client:
        response = client.post("/internal/e2b/usage/collect", headers=headers, json={"project_id": project})
    assert response.status_code == status
    assert "provider-only" not in response.text and "inner-only" not in response.text


@pytest.mark.parametrize("failure", [None, "provider", "ack", "bounded"])
def test_explicit_request_scans_once_and_only_completed_scan_commits_checkpoint(
    monkeypatch: pytest.MonkeyPatch, failure: str | None
) -> None:
    calls: list[str] = []
    batches: list[list[dict[str, Any]]] = []
    clients: list[httpx.AsyncClient] = []
    now = datetime.now(UTC)
    event = {
        "version": "v2",
        "id": "event-1",
        "type": "sandbox.lifecycle.paused",
        "sandboxTeamId": "project",
        "sandboxId": "sandbox",
        "sandboxExecutionId": "execution",
        "timestamp": now.isoformat(),
        "eventData": {},
    }

    async def transport(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.host)
        if request.url.host == "api.e2b.app":
            assert request.headers["X-API-Key"] == "provider-only"
            assert "X-Inner-Api-Key" not in request.headers
            if failure == "provider":
                return httpx.Response(503)
            return httpx.Response(200, json=[event] * (100 if failure == "bounded" else 1))
        assert request.url.host == "inner"
        assert request.headers["X-Inner-Api-Key"] == "inner-only"
        assert "X-API-Key" not in request.headers
        if request.method == "GET":
            return httpx.Response(
                200,
                json={"enabled": True, "project_id": "project", "started_at": (now - timedelta(hours=1)).isoformat()},
            )
        batch = json.loads(request.content)["events"]
        batches.append(batch)
        return httpx.Response(
            200,
            json={"accepted": 0 if failure == "ack" else len(batch), "duplicates": 0, "conflicts": 0, "ignored": 0},
        )

    original_client = httpx.AsyncClient

    def client_factory(**kwargs: Any) -> httpx.AsyncClient:
        assert kwargs["trust_env"] is False
        result = original_client(transport=httpx.MockTransport(transport), **kwargs)
        clients.append(result)
        return result

    monkeypatch.setattr(route_module.httpx, "AsyncClient", client_factory)
    with TestClient(_app(_settings(sandbox_metering_max_pages="1", sandbox_metering_overlap_seconds="900"))) as client:
        assert calls == []  # no startup polling, leadership or accounting IO
        response = client.post(
            "/internal/e2b/usage/collect",
            headers={"Authorization": "Bearer control-only"},
            json={"project_id": "project"},
        )
    assert len(clients) == 2 and all(client.is_closed for client in clients)
    assert calls.count("api.e2b.app") == 1
    checkpoints = [event for batch in batches for event in batch if event["type"] == "collector_checkpoint"]
    if failure in {"provider", "ack"}:
        assert response.status_code == 503
        assert checkpoints == []
    else:
        assert response.status_code == 200
        assert response.json() == {"completed": failure != "bounded"}
        assert len(checkpoints) == (0 if failure == "bounded" else 1)


def test_collection_deadline_closes_clients_without_checkpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    clients: list[httpx.AsyncClient] = []
    posts: list[httpx.Request] = []

    async def transport(request: httpx.Request) -> httpx.Response:
        if request.url.host == "inner":
            if request.method == "POST":
                posts.append(request)
            return httpx.Response(
                200, json={"enabled": True, "project_id": "project", "started_at": datetime.now(UTC).isoformat()}
            )
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    original_client = httpx.AsyncClient

    def client_factory(**kwargs: Any) -> httpx.AsyncClient:
        result = original_client(transport=httpx.MockTransport(transport), **kwargs)
        clients.append(result)
        return result

    monkeypatch.setattr(route_module.httpx, "AsyncClient", client_factory)
    monkeypatch.setattr(route_module, "_COLLECTION_TIMEOUT_SECONDS", 0.02)
    with TestClient(_app(_settings())) as client:
        response = client.post(
            "/internal/e2b/usage/collect",
            headers={"Authorization": "Bearer control-only"},
            json={"project_id": "project"},
        )
    assert response.status_code == 504
    assert posts == []
    assert len(clients) == 2 and all(client.is_closed for client in clients)
