from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol import (
    CreateHomeSnapshotFromSandboxRequest,
    HomeSnapshotResponse,
    InitializeHomeSnapshotRequest,
    SandboxLocator,
)
from dify_agent.server import home_snapshots as home_snapshots_module
from dify_agent.server.home_snapshots import HomeSnapshotService, HomeSnapshotServiceError
from dify_agent.server.routes.home_snapshots import create_home_snapshots_router
from dify_agent.runtime_backend import HomeSnapshotCreateError, HomeSnapshotCreateSpec, HomeSnapshotDriver


def _sandbox_locator(
    *,
    tenant_id: str = "tenant-1",
    agent_id: str = "agent-1",
    agent_config_version_kind: str = "build_draft",
) -> SandboxLocator:
    return SandboxLocator.model_validate(
        {
            "composition": {
                "schema_version": 1,
                "layers": [
                    {
                        "name": "execution_context",
                        "type": "dify.execution_context",
                        "config": {
                            "tenant_id": tenant_id,
                            "user_from": "account",
                            "agent_id": agent_id,
                            "agent_config_version_kind": agent_config_version_kind,
                            "agent_mode": "agent_app",
                            "invoke_from": "service-api",
                        },
                    },
                    {
                        "name": "shell",
                        "type": "dify.shell",
                        "deps": {"execution_context": "execution_context"},
                        "config": {},
                    },
                ],
            },
            "session_snapshot": {
                "layers": [
                    {"name": "execution_context", "lifecycle_state": "suspended", "runtime_state": {}},
                    {
                        "name": "shell",
                        "lifecycle_state": "suspended",
                        "runtime_state": {"session_id": "session-1", "workspace_cwd": "/workspace"},
                    },
                ]
            },
        }
    )


@dataclass(slots=True)
class _EnteredCompositor:
    execution_context: DifyExecutionContextLayerConfig
    source_lease: object = field(default_factory=object)
    suspend: MagicMock = field(default_factory=MagicMock)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    def suspend_on_exit(self) -> None:
        self.suspend()

    def get_layer(self, name: str, _layer_type: object):
        if name == "execution_context":
            return SimpleNamespace(config=self.execution_context)
        if name == "sandbox":
            return SimpleNamespace(lease=self.source_lease)
        raise KeyError(name)


@dataclass(slots=True)
class _Compositor:
    execution_context: DifyExecutionContextLayerConfig
    resume_sandbox: MagicMock
    source_lease: object = field(default_factory=object)
    suspend: MagicMock = field(default_factory=MagicMock)

    def enter(self, **_kwargs: object) -> _EnteredCompositor:
        self.resume_sandbox()
        return _EnteredCompositor(self.execution_context, self.source_lease, self.suspend)


@pytest.mark.anyio
async def test_from_sandbox_snapshots_exact_resumed_lease_and_suspends_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    locator = _sandbox_locator()
    execution_context = DifyExecutionContextLayerConfig.model_validate(locator.composition.layers[0].config)
    source_lease = object()
    resume_sandbox = MagicMock()
    suspend_source = MagicMock()
    compositor = _Compositor(execution_context, resume_sandbox, source_lease, suspend_source)
    build_compositor = MagicMock(return_value=compositor)
    monkeypatch.setattr(home_snapshots_module, "build_pydantic_ai_compositor", build_compositor)
    driver = SimpleNamespace(
        initialize=AsyncMock(),
        create_from_sandbox=AsyncMock(return_value="snapshot-build"),
        delete=AsyncMock(),
    )
    service = HomeSnapshotService(driver=cast(HomeSnapshotDriver, cast(object, driver)), layer_providers=())

    response = await service.create_from_sandbox(
        CreateHomeSnapshotFromSandboxRequest(
            tenant_id="tenant-1",
            agent_id="agent-1",
            home_snapshot_id="home-2",
            source_sandbox=locator,
        )
    )

    assert response == HomeSnapshotResponse(snapshot_ref="snapshot-build")
    resume_sandbox.assert_called_once_with()
    suspend_source.assert_called_once_with()
    driver.create_from_sandbox.assert_awaited_once_with(
        spec=HomeSnapshotCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            home_snapshot_id="home-2",
        ),
        source=source_lease,
    )
    driver.initialize.assert_not_awaited()
    driver.delete.assert_not_awaited()


@pytest.mark.anyio
async def test_from_sandbox_create_failure_does_not_initialize_or_retry_with_another_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    locator = _sandbox_locator()
    execution_context = DifyExecutionContextLayerConfig.model_validate(locator.composition.layers[0].config)
    source_lease = object()
    compositor = _Compositor(execution_context, MagicMock(), source_lease)
    monkeypatch.setattr(home_snapshots_module, "build_pydantic_ai_compositor", MagicMock(return_value=compositor))
    driver = SimpleNamespace(
        initialize=AsyncMock(),
        create_from_sandbox=AsyncMock(side_effect=HomeSnapshotCreateError("snapshot failed")),
        delete=AsyncMock(),
    )
    service = HomeSnapshotService(driver=cast(HomeSnapshotDriver, cast(object, driver)), layer_providers=())

    with pytest.raises(HomeSnapshotServiceError) as exc_info:
        await service.create_from_sandbox(
            CreateHomeSnapshotFromSandboxRequest(
                tenant_id="tenant-1",
                agent_id="agent-1",
                home_snapshot_id="home-2",
                source_sandbox=locator,
            )
        )

    assert exc_info.value.code == "home_snapshot_create_failed"
    driver.create_from_sandbox.assert_awaited_once()
    assert driver.create_from_sandbox.await_args.kwargs["source"] is source_lease
    driver.initialize.assert_not_awaited()
    driver.delete.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("locator", "request_tenant_id", "request_agent_id"),
    [
        (_sandbox_locator(tenant_id="tenant-other"), "tenant-1", "agent-1"),
        (_sandbox_locator(agent_id="agent-other"), "tenant-1", "agent-1"),
        (_sandbox_locator(agent_config_version_kind="draft"), "tenant-1", "agent-1"),
    ],
)
async def test_from_sandbox_rejects_cross_owner_and_non_build_locator(
    monkeypatch: pytest.MonkeyPatch,
    locator: SandboxLocator,
    request_tenant_id: str,
    request_agent_id: str,
) -> None:
    execution_context = DifyExecutionContextLayerConfig.model_validate(locator.composition.layers[0].config)
    resume_sandbox = MagicMock()
    build_compositor = MagicMock(return_value=_Compositor(execution_context, resume_sandbox))
    monkeypatch.setattr(
        home_snapshots_module,
        "build_pydantic_ai_compositor",
        build_compositor,
    )
    driver = SimpleNamespace(create_from_sandbox=AsyncMock())
    service = HomeSnapshotService(driver=cast(HomeSnapshotDriver, cast(object, driver)), layer_providers=())

    with pytest.raises(HomeSnapshotServiceError) as exc_info:
        await service.create_from_sandbox(
            CreateHomeSnapshotFromSandboxRequest(
                tenant_id=request_tenant_id,
                agent_id=request_agent_id,
                home_snapshot_id="home-2",
                source_sandbox=locator,
            )
        )

    assert exc_info.value.code == "invalid_sandbox_locator"
    assert exc_info.value.status_code == 400
    build_compositor.assert_not_called()
    resume_sandbox.assert_not_called()
    driver.create_from_sandbox.assert_not_awaited()


@dataclass(slots=True)
class _Service:
    initialized: list[InitializeHomeSnapshotRequest] = field(default_factory=list)
    captured: list[CreateHomeSnapshotFromSandboxRequest] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    error: HomeSnapshotServiceError | None = None

    async def initialize(self, request: InitializeHomeSnapshotRequest) -> HomeSnapshotResponse:
        self.initialized.append(request)
        if self.error is not None:
            raise self.error
        return HomeSnapshotResponse(snapshot_ref="snapshot-initial")

    async def create_from_sandbox(
        self, request: CreateHomeSnapshotFromSandboxRequest
    ) -> HomeSnapshotResponse:
        self.captured.append(request)
        if self.error is not None:
            raise self.error
        return HomeSnapshotResponse(snapshot_ref="snapshot-build")

    async def delete(self, snapshot_ref: str) -> None:
        self.deleted.append(snapshot_ref)
        if self.error is not None:
            raise self.error


def _app(service: _Service | None) -> FastAPI:
    app = FastAPI()
    app.include_router(create_home_snapshots_router(lambda: cast(HomeSnapshotService | None, service)))
    return app


def test_initialize_route_forwards_stable_product_identity() -> None:
    service = _Service()

    with TestClient(_app(service)) as client:
        response = client.post(
            "/home-snapshots/initialize",
            json={"tenant_id": "tenant-1", "agent_id": "agent-1", "home_snapshot_id": "home-1"},
        )

    assert response.status_code == 201
    assert response.json() == {"snapshot_ref": "snapshot-initial"}
    assert service.initialized == [
        InitializeHomeSnapshotRequest(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-1")
    ]


def test_from_sandbox_route_forwards_exact_locator() -> None:
    service = _Service()
    locator = _sandbox_locator()

    with TestClient(_app(service)) as client:
        response = client.post(
            "/home-snapshots/from-sandbox",
            json={
                "tenant_id": "tenant-1",
                "agent_id": "agent-1",
                "home_snapshot_id": "home-2",
                "source_sandbox": locator.model_dump(mode="json"),
            },
        )

    assert response.status_code == 201
    assert response.json() == {"snapshot_ref": "snapshot-build"}
    assert service.captured == [
        CreateHomeSnapshotFromSandboxRequest(
            tenant_id="tenant-1",
            agent_id="agent-1",
            home_snapshot_id="home-2",
            source_sandbox=locator,
        )
    ]


def test_routes_map_service_errors_and_unconfigured_backend() -> None:
    service = _Service(error=HomeSnapshotServiceError("home_snapshot_create_failed", "boom", status_code=502))

    with TestClient(_app(service)) as client:
        failed = client.post(
            "/home-snapshots/initialize",
            json={"tenant_id": "tenant-1", "agent_id": "agent-1", "home_snapshot_id": "home-1"},
        )
    with TestClient(_app(None)) as client:
        unavailable = client.delete("/home-snapshots/snapshot-1")

    assert failed.status_code == 502
    assert failed.json() == {
        "detail": {"code": "home_snapshot_create_failed", "message": "boom"}
    }
    assert unavailable.status_code == 503


def test_delete_route_quotes_path_and_returns_204() -> None:
    service = _Service()

    with TestClient(_app(service)) as client:
        response = client.delete("/home-snapshots/team/home%201")

    assert response.status_code == 204
    assert service.deleted == ["team/home 1"]
