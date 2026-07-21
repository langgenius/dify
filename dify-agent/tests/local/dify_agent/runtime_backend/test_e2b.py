from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Literal, cast

import pytest
from e2b import AsyncSandbox, NotFoundException, SandboxNotFoundException
import httpx2 as httpx

from dify_agent.runtime_backend import e2b as e2b_module
from dify_agent.runtime_backend.e2b import (
    E2BControlPlane,
    E2BHomeSnapshotDriver,
    E2BSDKControlPlane,
    E2BSandboxDriver,
    E2BSandboxLease,
)
from dify_agent.runtime_backend.errors import (
    HomeSnapshotCreateError,
    SandboxCleanupError,
    SandboxCreateError,
    SandboxLostError,
    SandboxResumeError,
)
from dify_agent.runtime_backend.protocols import (
    CreateHomeSnapshotRequest,
    HomeSnapshotFile,
    HomeSnapshotSource,
    SandboxCreateSpec,
)


@dataclass(slots=True)
class _FakeFiles:
    made_directories: list[str] = field(default_factory=list)
    exists_error: BaseException | None = None
    make_dir_error: BaseException | None = None
    writes: list[tuple[str, bytes]] = field(default_factory=list)

    async def write(self, path: str, data: bytes) -> object:
        self.writes.append((path, data))
        return (path, data)

    async def make_dir(self, path: str) -> bool:
        self.made_directories.append(path)
        if self.make_dir_error is not None:
            raise self.make_dir_error
        return True

    async def exists(self, path: str) -> bool:
        if self.exists_error is not None:
            raise self.exists_error
        return path in self.made_directories


@dataclass(slots=True)
class _FakeSnapshotInfo:
    snapshot_id: str = "snapshot-immutable-id"
    names: list[str] = field(default_factory=lambda: ["team/readable-name"])


@dataclass(slots=True)
class _FakeSandbox:
    sandbox_id: str = "sandbox-id"
    traffic_access_token: str | None = "traffic-token"
    files: _FakeFiles = field(default_factory=_FakeFiles)
    snapshot_names: list[str | None] = field(default_factory=list)
    killed: bool = False
    pause_calls: list[bool] = field(default_factory=list)
    pause_error: Exception | None = None
    host_error: Exception | None = None

    def get_host(self, port: int) -> str:
        if self.host_error is not None:
            raise self.host_error
        return f"{port}-sandbox.e2b.app"

    async def pause(self, keep_memory: bool = True) -> bool:
        self.pause_calls.append(keep_memory)
        if self.pause_error is not None:
            raise self.pause_error
        return keep_memory

    async def kill(self) -> bool:
        self.killed = True
        return True

    async def create_snapshot(self, name: str | None = None) -> _FakeSnapshotInfo:
        self.snapshot_names.append(name)
        return _FakeSnapshotInfo()


@dataclass(slots=True)
class _CreateCall:
    template: str
    timeout: int
    metadata: dict[str, str]
    on_timeout: Literal["kill", "pause"]


@dataclass(slots=True)
class _FakeControlPlane:
    sandbox: _FakeSandbox = field(default_factory=_FakeSandbox)
    create_calls: list[_CreateCall] = field(default_factory=list)
    connect_calls: list[tuple[str, int]] = field(default_factory=list)
    kill_calls: list[str] = field(default_factory=list)

    async def create(
        self,
        template: str,
        *,
        timeout: int,
        metadata: dict[str, str],
        on_timeout: Literal["kill", "pause"],
    ) -> _FakeSandbox:
        self.create_calls.append(_CreateCall(template, timeout, metadata, on_timeout))
        return self.sandbox

    async def connect(self, handle: str, *, timeout: int) -> _FakeSandbox:
        self.connect_calls.append((handle, timeout))
        return self.sandbox

    async def kill(self, handle: str) -> bool:
        self.kill_calls.append(handle)
        return True

    async def delete_snapshot(self, snapshot_ref: str) -> bool:
        del snapshot_ref
        return True


class _TrackingTransport(httpx.MockTransport):
    close_calls: int

    def __init__(self) -> None:
        super().__init__(lambda request: httpx.Response(500, request=request))
        self.close_calls = 0

    async def aclose(self) -> None:
        self.close_calls += 1
        await super().aclose()


def test_home_snapshot_build_uses_active_timeout_with_kill_policy() -> None:
    control_plane = _FakeControlPlane()
    driver = E2BHomeSnapshotDriver(
        control_plane=cast(E2BControlPlane, cast(object, control_plane)),
        template="prepared-template",
        active_timeout_seconds=900,
    )

    snapshot_ref = asyncio.run(
        driver.create(
            CreateHomeSnapshotRequest(
                tenant_id="tenant",
                agent_id="agent",
                agent_config_version_id="config",
                source_digest="digest",
                source=HomeSnapshotSource(),
            )
        )
    )

    assert snapshot_ref == "snapshot-immutable-id"
    assert control_plane.sandbox.snapshot_names == [None]
    assert control_plane.sandbox.killed is True
    assert control_plane.create_calls == [
        _CreateCall(
            template="prepared-template",
            timeout=900,
            metadata={
                "dify.resource": "home-snapshot-build",
                "dify.tenant_id": "tenant",
                "dify.agent_id": "agent",
                "dify.agent_config_version_id": "config",
                "dify.source_digest": "digest",
            },
            on_timeout="kill",
        )
    ]


def test_home_snapshot_materializes_source_files_under_home() -> None:
    control_plane = _FakeControlPlane()
    driver = E2BHomeSnapshotDriver(
        control_plane=cast(E2BControlPlane, cast(object, control_plane)),
        template="prepared-template",
        active_timeout_seconds=900,
    )

    snapshot_ref = asyncio.run(
        driver.create(
            CreateHomeSnapshotRequest(
                tenant_id="tenant",
                agent_id="agent",
                agent_config_version_id="config",
                source_digest="digest",
                source=HomeSnapshotSource(files=(HomeSnapshotFile(path=".dify/config/settings.json", content=b"{}"),)),
            )
        )
    )

    assert snapshot_ref == "snapshot-immutable-id"
    assert control_plane.sandbox.files.made_directories == ["/home/dify", "/home/dify/.dify/config"]
    assert control_plane.sandbox.files.writes == [("/home/dify/.dify/config/settings.json", b"{}")]
    assert control_plane.sandbox.killed is True


@pytest.mark.parametrize("path", ["/etc/passwd", "../secret", "dir/../../secret", "~/secret"])
def test_home_snapshot_rejects_non_home_relative_source_paths(path: str) -> None:
    control_plane = _FakeControlPlane()
    driver = E2BHomeSnapshotDriver(
        control_plane=cast(E2BControlPlane, cast(object, control_plane)),
        template="prepared-template",
        active_timeout_seconds=900,
    )

    with pytest.raises(HomeSnapshotCreateError, match="home-relative"):
        asyncio.run(
            driver.create(
                CreateHomeSnapshotRequest(
                    tenant_id="tenant",
                    agent_id="agent",
                    agent_config_version_id="config",
                    source_digest="digest",
                    source=HomeSnapshotSource(files=(HomeSnapshotFile(path=path, content=b"secret"),)),
                )
            )
        )

    assert control_plane.sandbox.files.writes == []
    assert control_plane.sandbox.killed is True


def test_home_snapshot_cancellation_after_build_creation_kills_sandbox() -> None:
    control_plane = _FakeControlPlane()
    control_plane.sandbox.files.make_dir_error = asyncio.CancelledError()
    driver = E2BHomeSnapshotDriver(
        control_plane=cast(E2BControlPlane, cast(object, control_plane)),
        template="prepared-template",
        active_timeout_seconds=900,
    )

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            driver.create(
                CreateHomeSnapshotRequest(
                    tenant_id="tenant",
                    agent_id="agent",
                    agent_config_version_id="config",
                    source_digest="digest",
                    source=HomeSnapshotSource(),
                )
            )
        )

    assert control_plane.sandbox.killed is True


def test_runtime_sandbox_active_timeout_pauses_and_applies_on_resume() -> None:
    control_plane = _FakeControlPlane()
    driver = E2BSandboxDriver(
        control_plane=cast(E2BControlPlane, cast(object, control_plane)),
        active_timeout_seconds=1200,
    )

    lease = asyncio.run(
        driver.create(
            SandboxCreateSpec(
                tenant_id="tenant",
                agent_id="agent",
                agent_config_version_id="config",
                runtime_session_id="session",
                home_snapshot_ref="snapshot-immutable-id",
            )
        )
    )
    asyncio.run(driver.suspend(lease))
    _ = asyncio.run(driver.resume(lease.handle))

    assert control_plane.create_calls == [
        _CreateCall(
            template="snapshot-immutable-id",
            timeout=1200,
            metadata={
                "dify.resource": "runtime-sandbox",
                "dify.runtime_session_id": "session",
                "dify.tenant_id": "tenant",
                "dify.agent_id": "agent",
                "dify.agent_config_version_id": "config",
            },
            on_timeout="pause",
        )
    ]
    assert control_plane.connect_calls == [("sandbox-id", 1200)]


@pytest.mark.anyio
async def test_runtime_sandbox_suspend_closes_injected_http_transport_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    control_plane = _FakeControlPlane()
    transport = _TrackingTransport()
    http_client = httpx.AsyncClient(transport=transport)
    monkeypatch.setattr(e2b_module.httpx, "AsyncClient", lambda **_kwargs: http_client)
    driver = E2BSandboxDriver(
        control_plane=cast(E2BControlPlane, cast(object, control_plane)),
        active_timeout_seconds=1200,
    )

    lease = await driver.create(
        SandboxCreateSpec(
            tenant_id="tenant",
            agent_id="agent",
            agent_config_version_id="config",
            runtime_session_id="session",
            home_snapshot_ref="snapshot-immutable-id",
        )
    )
    assert isinstance(lease, E2BSandboxLease)
    await driver.suspend(lease)
    await lease.data_plane.close()

    assert transport.close_calls == 1


def test_resume_pauses_connected_sandbox_when_workspace_is_missing() -> None:
    control_plane = _FakeControlPlane()
    driver = E2BSandboxDriver(
        control_plane=cast(E2BControlPlane, cast(object, control_plane)),
        active_timeout_seconds=1200,
    )

    with pytest.raises(SandboxLostError, match="workspace"):
        asyncio.run(driver.resume("sandbox-id"))

    assert control_plane.sandbox.pause_calls == [True]


def test_resume_preserves_probe_failure_when_best_effort_pause_fails() -> None:
    control_plane = _FakeControlPlane()
    control_plane.sandbox.files.exists_error = RuntimeError("workspace probe failed")
    control_plane.sandbox.pause_error = RuntimeError("pause failed")
    driver = E2BSandboxDriver(
        control_plane=cast(E2BControlPlane, cast(object, control_plane)),
        active_timeout_seconds=1200,
    )

    with pytest.raises(SandboxResumeError, match="workspace probe failed"):
        asyncio.run(driver.resume("sandbox-id"))

    assert control_plane.sandbox.pause_calls == [True]


def test_resume_pauses_connected_sandbox_when_lease_construction_fails() -> None:
    control_plane = _FakeControlPlane()
    control_plane.sandbox.files.made_directories.append("/home/dify/workspace")
    control_plane.sandbox.host_error = RuntimeError("host lookup failed")
    driver = E2BSandboxDriver(
        control_plane=cast(E2BControlPlane, cast(object, control_plane)),
        active_timeout_seconds=1200,
    )

    with pytest.raises(SandboxResumeError, match="host lookup failed"):
        asyncio.run(driver.resume("sandbox-id"))

    assert control_plane.sandbox.pause_calls == [True]


def test_sdk_sandbox_not_found_is_normalized_for_resume(monkeypatch: pytest.MonkeyPatch) -> None:
    async def missing_connect(*_args: object, **_kwargs: object) -> object:
        raise SandboxNotFoundException()

    monkeypatch.setattr(AsyncSandbox, "connect", staticmethod(missing_connect))
    driver = E2BSandboxDriver(
        control_plane=E2BSDKControlPlane(api_key="api-key"),
        active_timeout_seconds=1200,
    )

    with pytest.raises(SandboxLostError, match="no longer exists"):
        asyncio.run(driver.resume("missing-sandbox"))


def test_sdk_not_found_is_normalized_for_snapshot_delete(monkeypatch: pytest.MonkeyPatch) -> None:
    async def missing_snapshot(*_args: object, **_kwargs: object) -> bool:
        raise NotFoundException()

    monkeypatch.setattr(AsyncSandbox, "delete_snapshot", staticmethod(missing_snapshot))
    driver = E2BHomeSnapshotDriver(
        control_plane=E2BSDKControlPlane(api_key="api-key"),
        template="prepared-template",
        active_timeout_seconds=900,
    )

    asyncio.run(driver.delete("missing-snapshot"))


def test_message_only_not_found_is_not_treated_as_typed_not_found() -> None:
    class MessageOnlyControlPlane(_FakeControlPlane):
        async def connect(self, handle: str, *, timeout: int) -> _FakeSandbox:
            del handle, timeout
            raise RuntimeError("404 not found")

    driver = E2BSandboxDriver(
        control_plane=cast(E2BControlPlane, cast(object, MessageOnlyControlPlane())),
        active_timeout_seconds=1200,
    )

    with pytest.raises(SandboxResumeError, match="404 not found"):
        asyncio.run(driver.resume("missing-sandbox"))


def test_runtime_create_cancellation_after_provision_kills_sandbox() -> None:
    control_plane = _FakeControlPlane()
    control_plane.sandbox.files.make_dir_error = asyncio.CancelledError()
    driver = E2BSandboxDriver(
        control_plane=cast(E2BControlPlane, cast(object, control_plane)),
        active_timeout_seconds=1200,
    )

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            driver.create(
                SandboxCreateSpec(
                    tenant_id="tenant",
                    agent_id="agent",
                    agent_config_version_id="config",
                    runtime_session_id="session",
                    home_snapshot_ref="snapshot-immutable-id",
                )
            )
        )

    assert control_plane.sandbox.killed is True


def test_runtime_resume_cancellation_after_connect_pauses_sandbox() -> None:
    control_plane = _FakeControlPlane()
    control_plane.sandbox.files.exists_error = asyncio.CancelledError()
    driver = E2BSandboxDriver(
        control_plane=cast(E2BControlPlane, cast(object, control_plane)),
        active_timeout_seconds=1200,
    )

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(driver.resume("sandbox-id"))

    assert control_plane.sandbox.pause_calls == [True]


def test_runtime_create_failure_kills_provisioned_sandbox_and_maps_error() -> None:
    control_plane = _FakeControlPlane()
    control_plane.sandbox.files.make_dir_error = RuntimeError("workspace create failed")
    driver = E2BSandboxDriver(
        control_plane=cast(E2BControlPlane, cast(object, control_plane)),
        active_timeout_seconds=1200,
    )

    with pytest.raises(SandboxCreateError, match="workspace create failed"):
        asyncio.run(
            driver.create(
                SandboxCreateSpec(
                    tenant_id="tenant",
                    agent_id="agent",
                    agent_config_version_id="config",
                    runtime_session_id="session",
                    home_snapshot_ref="snapshot-immutable-id",
                )
            )
        )

    assert control_plane.sandbox.killed is True


def test_runtime_delete_success_and_typed_not_found_are_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def kill(handle: str, **_kwargs: object) -> bool:
        calls.append(handle)
        if len(calls) == 2:
            raise SandboxNotFoundException()
        return True

    monkeypatch.setattr(AsyncSandbox, "kill", staticmethod(kill))
    driver = E2BSandboxDriver(
        control_plane=E2BSDKControlPlane(api_key="api-key"),
        active_timeout_seconds=1200,
    )

    asyncio.run(driver.delete("sandbox-1"))
    asyncio.run(driver.delete("missing-sandbox"))

    assert calls == ["sandbox-1", "missing-sandbox"]


def test_runtime_delete_maps_control_plane_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    async def kill(*_args: object, **_kwargs: object) -> bool:
        raise RuntimeError("E2B unavailable")

    monkeypatch.setattr(AsyncSandbox, "kill", staticmethod(kill))
    driver = E2BSandboxDriver(
        control_plane=E2BSDKControlPlane(api_key="api-key"),
        active_timeout_seconds=1200,
    )

    with pytest.raises(SandboxCleanupError, match="E2B unavailable"):
        asyncio.run(driver.delete("sandbox-1"))
