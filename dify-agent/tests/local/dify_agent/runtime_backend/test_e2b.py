from __future__ import annotations

import posixpath
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import cast

import httpx2 as httpx
import pytest
from shellctl.client import ShellctlClientError

from dify_agent.runtime_backend import (
    BindingAcquireError,
    BindingCreateError,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateSpec,
    SharedWorkspaceUnsupportedError,
    WorkspacePreservationUnsupportedError,
)
from dify_agent.runtime_backend import e2b as e2b_module
from dify_agent.runtime_backend.e2b import (
    E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    E2BExecutionBindingBackend,
    E2BHomeSnapshotBackend,
    E2BRuntimeLease,
    E2BSDKControlPlane,
)
from dify_agent.runtime_backend.shellctl import ShellctlRuntimeLease


@dataclass(frozen=True, slots=True)
class _FileEntry:
    path: str


@dataclass(slots=True)
class _Files:
    paths: set[str] = field(default_factory=set)
    removed: list[str] = field(default_factory=list)

    async def make_dir(self, path: str) -> bool:
        self.paths.add(path)
        return True

    async def exists(self, path: str) -> bool:
        return path in self.paths

    async def list(self, path: str) -> list[_FileEntry]:
        prefix = f"{path.rstrip('/')}/"
        return [
            _FileEntry(path=entry)
            for entry in sorted(self.paths)
            if entry.startswith(prefix) and "/" not in entry.removeprefix(prefix)
        ]

    async def remove(self, path: str) -> None:
        self.removed.append(path)
        self.paths = {entry for entry in self.paths if entry != path and posixpath.commonpath((entry, path)) != path}


@dataclass(slots=True)
class _Snapshot:
    snapshot_id: str
    names: list[str] = field(default_factory=list)


@dataclass(slots=True)
class _Sandbox:
    sandbox_id: str
    files: _Files = field(default_factory=_Files)
    traffic_access_token: str | None = "traffic-token"
    pauses: list[bool] = field(default_factory=list)
    killed: int = 0
    snapshots: int = 0
    pause_error: Exception | None = None

    def get_host(self, port: int) -> str:
        return f"{self.sandbox_id}-{port}.example.test"

    async def pause(self, keep_memory: bool = True) -> bool:
        self.pauses.append(keep_memory)
        if self.pause_error is not None:
            raise self.pause_error
        return True

    async def kill(self) -> bool:
        self.killed += 1
        return True

    async def create_snapshot(self, name: str | None = None) -> _Snapshot:
        del name
        self.snapshots += 1
        return _Snapshot(snapshot_id=f"snapshot-{self.sandbox_id}-{self.snapshots}")


@dataclass(slots=True)
class _ControlPlane:
    created: list[tuple[str, str]] = field(default_factory=list)
    sandboxes: dict[str, _Sandbox] = field(default_factory=dict)
    killed: list[str] = field(default_factory=list)
    deleted_snapshots: list[str] = field(default_factory=list)
    pause_error: Exception | None = None

    async def create(self, template: str, *, timeout: int, metadata: dict[str, str], on_timeout: str) -> _Sandbox:
        del timeout
        sandbox_id = f"sandbox-{len(self.sandboxes) + 1}"
        sandbox = _Sandbox(sandbox_id=sandbox_id, pause_error=self.pause_error)
        sandbox.files.paths.update(
            {
                "/workspace",
                "/workspace/stale-dir",
                "/workspace/stale-dir/nested.txt",
                "/workspace/stale.txt",
            }
        )
        self.sandboxes[sandbox_id] = sandbox
        self.created.append((template, on_timeout))
        assert metadata["dify.resource"] == "runtime-sandbox"
        return sandbox

    async def connect(self, handle: str, *, timeout: int) -> _Sandbox:
        del timeout
        return self.sandboxes[handle]

    async def kill(self, handle: str) -> bool:
        self.killed.append(handle)
        return True

    async def delete_snapshot(self, snapshot_ref: str) -> bool:
        self.deleted_snapshots.append(snapshot_ref)
        return True


def _mock_http(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> list[httpx.AsyncClient]:
    original_async_client = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    clients: list[httpx.AsyncClient] = []

    def create_client(*args: object, **kwargs: object) -> httpx.AsyncClient:
        _ = kwargs.setdefault("transport", transport)
        client = original_async_client(*args, **kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr(httpx, "AsyncClient", create_client)
    return clients


def _connected_backend(*, pause_error: Exception | None = None) -> tuple[E2BExecutionBindingBackend, _Sandbox]:
    control = _ControlPlane()
    sandbox = _Sandbox(sandbox_id="sandbox-1", pause_error=pause_error)
    sandbox.files.paths.add("/workspace")
    control.sandboxes[sandbox.sandbox_id] = sandbox
    return (
        E2BExecutionBindingBackend(
            control_plane=control,  # pyright: ignore[reportArgumentType]
            template="prepared-template",
            active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
        ),
        sandbox,
    )


@pytest.mark.anyio
async def test_e2b_sdk_create_disables_public_traffic(monkeypatch: pytest.MonkeyPatch) -> None:
    from e2b import AsyncSandbox

    sandbox = _Sandbox(sandbox_id="sandbox-1")
    create_options: dict[str, object] = {}

    async def create(
        _cls: type[AsyncSandbox],
        template: str,
        **options: object,
    ) -> _Sandbox:
        assert template == "prepared-template"
        create_options.update(options)
        return sandbox

    monkeypatch.setattr(AsyncSandbox, "create", classmethod(create))
    control_plane = E2BSDKControlPlane(api_key="e2b-secret")

    created = await control_plane.create(
        "prepared-template",
        timeout=120,
        metadata={"dify.resource": "runtime-sandbox"},
        on_timeout="pause",
    )

    assert created is sandbox
    assert create_options["network"] == {"allow_public_traffic": False}


@pytest.mark.anyio
async def test_e2b_binding_uses_default_template_or_exact_snapshot_and_couples_refs() -> None:
    control = _ControlPlane()
    snapshots = E2BHomeSnapshotBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
    )
    bindings = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )

    default_allocation = await bindings.create_binding(
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref=None,
        )
    )
    snapshot_allocation = await bindings.create_binding(
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-2",
            workspace_id="workspace-2",
            existing_workspace_ref=None,
            home_snapshot_ref="snapshot-1",
        )
    )

    assert control.created == [("prepared-template", "pause"), ("snapshot-1", "pause")]
    assert default_allocation.binding_ref == default_allocation.workspace_ref
    assert snapshot_allocation.binding_ref == snapshot_allocation.workspace_ref
    assert control.sandboxes[default_allocation.binding_ref].pauses == [True]

    for allocation in (default_allocation, snapshot_allocation):
        runtime = control.sandboxes[allocation.binding_ref]
        assert runtime.files.paths == {"/workspace"}
        assert "/workspace" not in runtime.files.removed

    for allocation in (default_allocation, snapshot_allocation):
        await bindings.destroy_binding(
            ExecutionBindingDestroySpec(
                binding_ref=allocation.binding_ref,
                workspace_ref=allocation.workspace_ref,
                destroy_workspace=True,
            )
        )
    await snapshots.delete("snapshot-1")

    assert control.killed == [default_allocation.binding_ref, snapshot_allocation.binding_ref]
    assert control.deleted_snapshots == ["snapshot-1"]


@pytest.mark.anyio
async def test_e2b_rejects_shared_workspace_and_binding_only_destroy() -> None:
    control = _ControlPlane()
    backend = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )
    spec = ExecutionBindingCreateSpec(
        tenant_id="tenant-1",
        agent_id="agent-2",
        binding_id="binding-2",
        workspace_id="workspace-1",
        existing_workspace_ref="sandbox-1",
        home_snapshot_ref="snapshot-1",
    )

    with pytest.raises(SharedWorkspaceUnsupportedError):
        await backend.create_binding(spec)
    assert control.created == []
    assert control.sandboxes == {}
    with pytest.raises(WorkspacePreservationUnsupportedError):
        await backend.destroy_binding(ExecutionBindingDestroySpec(binding_ref="sandbox-1", destroy_workspace=False))


@pytest.mark.anyio
async def test_e2b_binding_create_kills_sandbox_when_initialization_fails() -> None:
    control = _ControlPlane(pause_error=RuntimeError("pause failed"))
    backend = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )

    with pytest.raises(BindingCreateError, match="pause failed"):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                binding_id="binding-1",
                workspace_id="workspace-1",
                existing_workspace_ref=None,
                home_snapshot_ref="snapshot-1",
            )
        )

    sandbox = next(iter(control.sandboxes.values()))
    assert sandbox.killed == 1


@pytest.mark.anyio
async def test_e2b_missing_explicit_snapshot_does_not_fall_back_to_template() -> None:
    class _FailingControlPlane(_ControlPlane):
        async def create(self, template: str, *, timeout: int, metadata: dict[str, str], on_timeout: str) -> _Sandbox:
            del timeout, metadata
            self.created.append((template, on_timeout))
            raise RuntimeError("snapshot unavailable")

    control = _FailingControlPlane()
    backend = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )

    with pytest.raises(BindingCreateError, match="snapshot unavailable"):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                binding_id="binding-1",
                workspace_id="workspace-1",
                existing_workspace_ref=None,
                home_snapshot_ref="missing-snapshot",
            )
        )

    assert control.created == [("missing-snapshot", "pause")]


@pytest.mark.anyio
async def test_e2b_checkpoint_uses_exact_source_runtime() -> None:
    control = _ControlPlane()
    source_sandbox = _Sandbox(sandbox_id="source")
    source = E2BRuntimeLease(
        sandbox=source_sandbox,  # pyright: ignore[reportArgumentType]
        data_plane=cast(ShellctlRuntimeLease, object()),
    )
    backend = E2BHomeSnapshotBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
    )

    snapshot_ref = await backend.create_from_runtime(
        spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-2"),
        source=source,
    )

    assert snapshot_ref == "snapshot-source-1"
    assert source_sandbox.snapshots == 1


@pytest.mark.anyio
async def test_e2b_acquire_retries_transient_shellctl_failures_until_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SHELLCTL_AUTH_TOKEN", "ambient-shellctl-token")
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        assert request.headers["e2b-traffic-access-token"] == "traffic-token"
        assert "X-Access-Token" not in request.headers
        assert "Authorization" not in request.headers
        if attempts == 1:
            raise httpx.ReadTimeout("shellctl starting", request=request)
        if attempts == 2:
            raise httpx.ConnectError("shellctl starting", request=request)
        return httpx.Response(200, json={"status": "ok"})

    clients = _mock_http(monkeypatch, handler)
    sleeps: list[float] = []

    async def record_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(e2b_module.asyncio, "sleep", record_sleep)
    backend, sandbox = _connected_backend()

    lease = await backend.acquire(sandbox.sandbox_id)

    assert attempts == 3
    assert sleeps == [0.5, 0.5]
    assert lease.layout.home_dir == "/home/dify"
    assert lease.layout.workspace_dir == "/workspace"
    assert not clients[0].is_closed
    await backend.release(lease)
    assert clients[0].is_closed


@pytest.mark.anyio
@pytest.mark.parametrize("traffic_access_token", [None, ""])
async def test_e2b_acquire_fails_closed_without_traffic_token(
    monkeypatch: pytest.MonkeyPatch,
    traffic_access_token: str | None,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("shellctl must not be called without an E2B traffic access token")

    clients = _mock_http(monkeypatch, handler)
    backend, sandbox = _connected_backend()
    sandbox.traffic_access_token = traffic_access_token

    with pytest.raises(BindingAcquireError, match="traffic access token"):
        _ = await backend.acquire(sandbox.sandbox_id)

    assert clients == []
    assert sandbox.pauses == [True]


@pytest.mark.anyio
async def test_e2b_acquire_closes_transport_and_pauses_after_readiness_retries_exhausted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(503, json={"error": {"code": "starting", "message": "not ready"}})

    clients = _mock_http(monkeypatch, handler)
    sleeps: list[float] = []

    async def record_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(e2b_module.asyncio, "sleep", record_sleep)
    backend, sandbox = _connected_backend()

    with pytest.raises(BindingAcquireError, match="not ready"):
        _ = await backend.acquire(sandbox.sandbox_id)

    assert attempts == 3
    assert sleeps == [0.5, 0.5]
    assert clients[0].is_closed
    assert sandbox.pauses == [True]


@pytest.mark.anyio
async def test_e2b_acquire_does_not_retry_shellctl_4xx_and_preserves_error_when_pause_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(401, json={"error": {"code": "unauthorized", "message": "bad token"}})

    clients = _mock_http(monkeypatch, handler)

    async def fail_sleep(_delay: float) -> None:
        raise AssertionError("non-retryable health failures must not sleep")

    monkeypatch.setattr(e2b_module.asyncio, "sleep", fail_sleep)
    backend, sandbox = _connected_backend(pause_error=RuntimeError("pause failed"))

    with pytest.raises(BindingAcquireError, match="bad token"):
        _ = await backend.acquire(sandbox.sandbox_id)

    assert attempts == 1
    assert clients[0].is_closed
    assert sandbox.pauses == [True]


@pytest.mark.anyio
async def test_e2b_acquire_preserves_health_failure_when_close_and_pause_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    @dataclass(slots=True)
    class _UnavailableHealthClient:
        calls: int = 0

        async def health(self) -> object:
            self.calls += 1
            raise ShellctlClientError(503, "starting", "primary health failure")

    @dataclass(slots=True)
    class _FailingCloseDataPlane:
        client: _UnavailableHealthClient
        close_calls: int = 0

        async def close(self) -> None:
            self.close_calls += 1
            raise RuntimeError("close failed")

    client = _UnavailableHealthClient()
    data_plane = _FailingCloseDataPlane(client=client)

    async def create_lease(
        _self: E2BExecutionBindingBackend,
        sandbox: _Sandbox,
    ) -> E2BRuntimeLease:
        return E2BRuntimeLease(
            sandbox=sandbox,  # pyright: ignore[reportArgumentType]
            data_plane=cast(ShellctlRuntimeLease, cast(object, data_plane)),
        )

    async def skip_sleep(_delay: float) -> None:
        return None

    monkeypatch.setattr(E2BExecutionBindingBackend, "_lease", create_lease)
    monkeypatch.setattr(e2b_module.asyncio, "sleep", skip_sleep)
    backend, sandbox = _connected_backend(pause_error=RuntimeError("pause failed"))

    with pytest.raises(BindingAcquireError, match="primary health failure"):
        _ = await backend.acquire(sandbox.sandbox_id)

    assert client.calls == 3
    assert data_plane.close_calls == 1
    assert sandbox.pauses == [True]
