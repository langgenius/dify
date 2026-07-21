from __future__ import annotations

import base64
from dataclasses import dataclass, field

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dify_agent.runtime_backend import CreateHomeSnapshotRequest
from dify_agent.runtime_backend.errors import HomeSnapshotCreateError, HomeSnapshotNotFoundError
from dify_agent.server.home_snapshots import HomeSnapshotService
from dify_agent.server.routes.home_snapshots import create_home_snapshots_router


@dataclass(slots=True)
class _Driver:
    created: list[CreateHomeSnapshotRequest] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    create_error: Exception | None = None
    delete_error: Exception | None = None

    async def create(self, request: CreateHomeSnapshotRequest) -> str:
        self.created.append(request)
        if self.create_error is not None:
            raise self.create_error
        return "snapshot-1"

    async def delete(self, snapshot_ref: str) -> None:
        self.deleted.append(snapshot_ref)
        if self.delete_error is not None:
            raise self.delete_error


def _app(driver: _Driver | None) -> FastAPI:
    app = FastAPI()
    service = HomeSnapshotService(driver=driver) if driver is not None else None
    app.include_router(create_home_snapshots_router(lambda: service))
    return app


def _create_payload(*, content_base64: str | None = None) -> dict[str, object]:
    return {
        "tenant_id": "tenant-1",
        "agent_id": "agent-1",
        "agent_config_version_id": "config-1",
        "source_digest": "digest-1",
        "files": [
            {
                "path": ".dify/config/settings.json",
                "content_base64": content_base64 or base64.b64encode(b'{"enabled":true}').decode("ascii"),
            }
        ],
    }


def test_create_route_decodes_source_bytes_and_returns_snapshot_ref() -> None:
    driver = _Driver()

    with TestClient(_app(driver)) as client:
        response = client.post("/home-snapshots", json=_create_payload())

    assert response.status_code == 201
    assert response.json() == {"snapshot_ref": "snapshot-1"}
    assert len(driver.created) == 1
    request = driver.created[0]
    assert request.tenant_id == "tenant-1"
    assert request.agent_id == "agent-1"
    assert request.agent_config_version_id == "config-1"
    assert request.source_digest == "digest-1"
    assert request.source.files[0].path == ".dify/config/settings.json"
    assert request.source.files[0].content == b'{"enabled":true}'


def test_create_route_rejects_invalid_base64_without_calling_driver() -> None:
    driver = _Driver()

    with TestClient(_app(driver)) as client:
        response = client.post("/home-snapshots", json=_create_payload(content_base64="%%%invalid%%%"))

    assert response.status_code == 400
    assert response.json() == {
        "detail": {
            "code": "invalid_home_snapshot_source",
            "message": "file content_base64 is invalid",
        }
    }
    assert driver.created == []


def test_create_route_maps_driver_failure_to_502() -> None:
    driver = _Driver(create_error=HomeSnapshotCreateError("backend unavailable"))

    with TestClient(_app(driver)) as client:
        response = client.post("/home-snapshots", json=_create_payload())

    assert response.status_code == 502
    assert response.json() == {
        "detail": {
            "code": "home_snapshot_create_failed",
            "message": "backend unavailable",
        }
    }


def test_routes_return_503_when_runtime_backend_is_unavailable() -> None:
    with TestClient(_app(None)) as client:
        create_response = client.post("/home-snapshots", json=_create_payload())
        delete_response = client.delete("/home-snapshots/snapshot-1")

    expected = {
        "detail": {
            "code": "runtime_backend_unavailable",
            "message": "runtime backend is not configured",
        }
    }
    assert create_response.status_code == 503
    assert create_response.json() == expected
    assert delete_response.status_code == 503
    assert delete_response.json() == expected


def test_delete_route_treats_missing_snapshot_as_idempotent_204() -> None:
    driver = _Driver(delete_error=HomeSnapshotNotFoundError("missing"))

    with TestClient(_app(driver)) as client:
        response = client.delete("/home-snapshots/snapshot-1")

    assert response.status_code == 204
    assert response.content == b""
    assert driver.deleted == ["snapshot-1"]


def test_delete_route_maps_driver_failure_to_502() -> None:
    driver = _Driver(delete_error=RuntimeError("delete unavailable"))

    with TestClient(_app(driver)) as client:
        response = client.delete("/home-snapshots/snapshot-1")

    assert response.status_code == 502
    assert response.json() == {
        "detail": {
            "code": "home_snapshot_delete_failed",
            "message": "delete unavailable",
        }
    }
