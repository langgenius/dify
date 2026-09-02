from __future__ import annotations

import asyncio
import posixpath
from collections.abc import Callable
from dataclasses import dataclass, field
import logging
from typing import cast

import httpx as e2b_httpx
import httpx2 as httpx
import pytest
from shellctl.client import ShellctlClientError

from dify_agent.runtime_backend import (
    BindingAcquireError,
    BindingCreateError,
    BindingLostError,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateError,
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
    make_dir_errors: list[BaseException] = field(default_factory=list)
    list_errors: list[BaseException] = field(default_factory=list)
    remove_errors: list[BaseException] = field(default_factory=list)
    make_dir_calls: int = 0
    list_calls: int = 0
    remove_calls: int = 0

    async def make_dir(self, path: str) -> bool:
        self.make_dir_calls += 1
        if self.make_dir_errors:
            raise self.make_dir_errors.pop(0)
        self.paths.add(path)
        return True

    async def exists(self, path: str) -> bool:
        return path in self.paths

    async def list(self, path: str) -> list[_FileEntry]:
        self.list_calls += 1
        if self.list_errors:
            raise self.list_errors.pop(0)
        prefix = f"{path.rstrip('/')}/"
        return [
            _FileEntry(path=entry)
            for entry in sorted(self.paths)
            if entry.startswith(prefix) and "/" not in entry.removeprefix(prefix)
        ]

    async def remove(self, path: str) -> None:
        self.remove_calls += 1
        if self.remove_errors:
            raise self.remove_errors.pop(0)
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
    pause_errors: list[BaseException] = field(default_factory=list)
    kill_errors: list[BaseException] = field(default_factory=list)
    snapshot_errors: list[BaseException] = field(default_factory=list)

    def get_host(self, port: int) -> str:
        return f"{self.sandbox_id}-{port}.example.test"

    async def pause(self, keep_memory: bool = True) -> bool:
        self.pauses.append(keep_memory)
        if self.pause_errors:
            raise self.pause_errors.pop(0)
        if self.pause_error is not None:
            raise self.pause_error
        return True

    async def kill(self) -> bool:
        self.killed += 1
        if self.kill_errors:
            raise self.kill_errors.pop(0)
        return True

    async def create_snapshot(self, name: str | None = None) -> _Snapshot:
        del name
        self.snapshots += 1
        if self.snapshot_errors:
            raise self.snapshot_errors.pop(0)
        return _Snapshot(snapshot_id=f"snapshot-{self.sandbox_id}-{self.snapshots}")


@dataclass(slots=True)
class _ControlPlane:
    created: list[tuple[str, str]] = field(default_factory=list)
    sandboxes: dict[str, _Sandbox] = field(default_factory=dict)
    killed: list[str] = field(default_factory=list)
    deleted_snapshots: list[str] = field(default_factory=list)
    pause_error: Exception | None = None
    sandbox_pause_errors: list[BaseException] = field(default_factory=list)
    sandbox_kill_errors: list[BaseException] = field(default_factory=list)
    create_errors: list[BaseException] = field(default_factory=list)
    connect_errors: list[BaseException] = field(default_factory=list)
    kill_errors: list[BaseException] = field(default_factory=list)
    delete_snapshot_errors: list[BaseException] = field(default_factory=list)
    connect_attempts: list[str] = field(default_factory=list)
    file_make_dir_errors: list[BaseException] = field(default_factory=list)
    file_list_errors: list[BaseException] = field(default_factory=list)
    file_remove_errors: list[BaseException] = field(default_factory=list)

    async def create(self, template: str, *, timeout: int, metadata: dict[str, str], on_timeout: str) -> _Sandbox:
        del timeout
        self.created.append((template, on_timeout))
        if self.create_errors:
            raise self.create_errors.pop(0)
        sandbox_id = f"sandbox-{len(self.sandboxes) + 1}"
        sandbox = _Sandbox(
            sandbox_id=sandbox_id,
            pause_error=self.pause_error,
            pause_errors=list(self.sandbox_pause_errors),
            kill_errors=list(self.sandbox_kill_errors),
        )
        sandbox.files.make_dir_errors = list(self.file_make_dir_errors)
        sandbox.files.list_errors = list(self.file_list_errors)
        sandbox.files.remove_errors = list(self.file_remove_errors)
        sandbox.files.paths.update(
            {
                "/workspace",
                "/workspace/stale-dir",
                "/workspace/stale-dir/nested.txt",
                "/workspace/stale.txt",
            }
        )
        self.sandboxes[sandbox_id] = sandbox
        assert metadata["dify.resource"] == "runtime-sandbox"
        return sandbox

    async def connect(self, handle: str, *, timeout: int) -> _Sandbox:
        del timeout
        self.connect_attempts.append(handle)
        if self.connect_errors:
            raise self.connect_errors.pop(0)
        return self.sandboxes[handle]

    async def kill(self, handle: str) -> bool:
        self.killed.append(handle)
        if self.kill_errors:
            raise self.kill_errors.pop(0)
        return True

    async def delete_snapshot(self, snapshot_ref: str) -> bool:
        self.deleted_snapshots.append(snapshot_ref)
        if self.delete_snapshot_errors:
            raise self.delete_snapshot_errors.pop(0)
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


@dataclass(slots=True)
class _ReleaseDataPlane:
    close_error: BaseException | None = None
    close_calls: int = 0

    async def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


def _transport_error(error_type: type[e2b_httpx.RequestError]) -> e2b_httpx.RequestError:
    request = e2b_httpx.Request("POST", "https://api.e2b.test/sandboxes")
    return error_type("stale E2B connection", request=request)


def _http_status_error() -> e2b_httpx.HTTPStatusError:
    request = e2b_httpx.Request("POST", "https://api.e2b.test/sandboxes")
    response = e2b_httpx.Response(503, request=request)
    return e2b_httpx.HTTPStatusError("E2B unavailable", request=request, response=response)


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
async def test_e2b_connect_retries_one_transport_failure(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    control = _ControlPlane(connect_errors=[_transport_error(e2b_httpx.ConnectError)])
    sandbox = _Sandbox(sandbox_id="sandbox-1")
    sandbox.files.paths.add("/workspace")
    control.sandboxes[sandbox.sandbox_id] = sandbox
    backend = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )
    clients = _mock_http(monkeypatch, lambda _request: httpx.Response(200, json={"status": "ok"}))
    sleeps: list[float] = []

    async def record_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(e2b_module.asyncio, "sleep", record_sleep)
    with caplog.at_level(logging.WARNING, logger="dify_agent.runtime_backend.e2b"):
        lease = await backend.acquire(sandbox.sandbox_id)

    assert control.connect_attempts == [sandbox.sandbox_id, sandbox.sandbox_id]
    assert sleeps == [0.25]
    retry_record = next(record for record in caplog.records if record.__dict__.get("outcome") == "retrying")
    assert retry_record.__dict__["e2b_operation"] == "connect"
    assert retry_record.__dict__["sandbox_id"] == sandbox.sandbox_id
    assert retry_record.__dict__["attempt"] == 1
    assert retry_record.__dict__["cleanup_stage"] == "binding_acquire"
    assert retry_record.__dict__["exception_type"] == "ConnectError"
    await cast(E2BRuntimeLease, lease).data_plane.close()
    assert clients[0].is_closed


@pytest.mark.anyio
async def test_e2b_initial_pause_retries_one_transport_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    control = _ControlPlane(sandbox_pause_errors=[_transport_error(e2b_httpx.ReadError)])
    backend = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )
    sleeps: list[float] = []

    async def record_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(e2b_module.asyncio, "sleep", record_sleep)
    allocation = await backend.create_binding(
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
        )
    )

    sandbox = control.sandboxes[allocation.binding_ref]
    assert control.created == [("prepared-template", "pause")]
    assert sandbox.pauses == [True, True]
    assert sleeps == [0.25]


@pytest.mark.anyio
async def test_e2b_destroy_retries_one_transport_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    control = _ControlPlane(kill_errors=[_transport_error(e2b_httpx.WriteError)])
    backend = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )
    sleeps: list[float] = []

    async def record_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(e2b_module.asyncio, "sleep", record_sleep)
    await backend.destroy_binding(
        ExecutionBindingDestroySpec(
            binding_ref="sandbox-1",
            workspace_ref="sandbox-1",
            destroy_workspace=True,
        )
    )

    assert control.killed == ["sandbox-1", "sandbox-1"]
    assert sleeps == [0.25]


@pytest.mark.anyio
async def test_e2b_snapshot_delete_retries_one_transport_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    control = _ControlPlane(delete_snapshot_errors=[_transport_error(e2b_httpx.RemoteProtocolError)])
    backend = E2BHomeSnapshotBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
    )
    sleeps: list[float] = []

    async def record_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(e2b_module.asyncio, "sleep", record_sleep)
    await backend.delete("snapshot-1")

    assert control.deleted_snapshots == ["snapshot-1", "snapshot-1"]
    assert sleeps == [0.25]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("failure_kind", "expected_error"),
    [
        ("not_found", BindingLostError),
        ("timeout", BindingAcquireError),
        ("http_status", BindingAcquireError),
        ("validation", BindingAcquireError),
        ("cancelled", asyncio.CancelledError),
    ],
)
async def test_e2b_connect_does_not_retry_non_transport_failures(
    monkeypatch: pytest.MonkeyPatch,
    failure_kind: str,
    expected_error: type[BaseException],
) -> None:
    if failure_kind == "not_found":
        failure: BaseException = e2b_module._E2BControlPlaneNotFoundError("missing")
    elif failure_kind == "timeout":
        request = e2b_httpx.Request("POST", "https://api.e2b.test/sandboxes")
        failure = e2b_httpx.ReadTimeout("E2B deadline exceeded", request=request)
    elif failure_kind == "http_status":
        failure = _http_status_error()
    elif failure_kind == "validation":
        failure = ValueError("invalid E2B response")
    else:
        failure = asyncio.CancelledError()
    control = _ControlPlane(connect_errors=[failure])
    backend = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )

    async def fail_sleep(_delay: float) -> None:
        raise AssertionError("non-retryable E2B failures must not sleep")

    monkeypatch.setattr(e2b_module.asyncio, "sleep", fail_sleep)
    with pytest.raises(expected_error):
        _ = await backend.acquire("sandbox-1")

    assert control.connect_attempts == ["sandbox-1"]


@pytest.mark.anyio
async def test_e2b_create_and_snapshot_create_are_not_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    control = _ControlPlane(create_errors=[_transport_error(e2b_httpx.ConnectError)])
    bindings = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )
    snapshot_sandbox = _Sandbox(
        sandbox_id="sandbox-snapshot",
        snapshot_errors=[_transport_error(e2b_httpx.ConnectError)],
    )
    source = E2BRuntimeLease(
        sandbox=snapshot_sandbox,  # pyright: ignore[reportArgumentType]
        data_plane=cast(ShellctlRuntimeLease, object()),
    )
    snapshots = E2BHomeSnapshotBackend(control_plane=control)  # pyright: ignore[reportArgumentType]

    async def fail_sleep(_delay: float) -> None:
        raise AssertionError("non-idempotent E2B creates must not sleep")

    monkeypatch.setattr(e2b_module.asyncio, "sleep", fail_sleep)
    with pytest.raises(BindingCreateError, match="stale E2B connection"):
        _ = await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                binding_id="binding-1",
                workspace_id="workspace-1",
                existing_workspace_ref=None,
            )
        )
    with pytest.raises(HomeSnapshotCreateError, match="stale E2B connection"):
        _ = await snapshots.create_from_runtime(
            spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-1"),
            source=source,
        )

    assert control.created == [("prepared-template", "pause")]
    assert snapshot_sandbox.snapshots == 1


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("failure_stage", "expected_calls"),
    [
        ("make_dir", (1, 0, 0)),
        ("list", (1, 1, 0)),
        ("remove", (1, 1, 1)),
    ],
)
async def test_e2b_file_initialization_is_one_shot_and_compensates_on_failure(
    monkeypatch: pytest.MonkeyPatch,
    failure_stage: str,
    expected_calls: tuple[int, int, int],
) -> None:
    error = _transport_error(e2b_httpx.ReadError)
    control = _ControlPlane(
        file_make_dir_errors=[error] if failure_stage == "make_dir" else [],
        file_list_errors=[error] if failure_stage == "list" else [],
        file_remove_errors=[error] if failure_stage == "remove" else [],
    )
    backend = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )

    async def fail_sleep(_delay: float) -> None:
        raise AssertionError("file initialization must not retry")

    monkeypatch.setattr(e2b_module.asyncio, "sleep", fail_sleep)
    with pytest.raises(BindingCreateError, match="stale E2B connection"):
        _ = await backend.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                binding_id="binding-1",
                workspace_id="workspace-1",
                existing_workspace_ref=None,
            )
        )

    sandbox = next(iter(control.sandboxes.values()))
    assert (sandbox.files.make_dir_calls, sandbox.files.list_calls, sandbox.files.remove_calls) == expected_calls
    assert sandbox.killed == 1


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
async def test_e2b_binding_create_preserves_primary_error_when_compensation_kill_fails(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    control = _ControlPlane(
        pause_error=RuntimeError("primary pause failure"),
        sandbox_kill_errors=[
            _transport_error(e2b_httpx.WriteError),
            _transport_error(e2b_httpx.WriteError),
        ],
    )
    backend = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )
    sleeps: list[float] = []

    async def record_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(e2b_module.asyncio, "sleep", record_sleep)
    with caplog.at_level(logging.WARNING, logger="dify_agent.runtime_backend.e2b"):
        with pytest.raises(BindingCreateError, match="primary pause failure"):
            _ = await backend.create_binding(
                ExecutionBindingCreateSpec(
                    tenant_id="tenant-1",
                    agent_id="agent-1",
                    binding_id="binding-1",
                    workspace_id="workspace-1",
                    existing_workspace_ref=None,
                )
            )

    sandbox = next(iter(control.sandboxes.values()))
    assert sandbox.killed == 2
    assert sleeps == [0.25]
    cleanup_record = next(
        record for record in caplog.records if record.__dict__.get("outcome") == "ignored_cleanup_failure"
    )
    assert cleanup_record.__dict__["e2b_operation"] == "kill"
    assert cleanup_record.__dict__["sandbox_id"] == sandbox.sandbox_id
    assert cleanup_record.__dict__["cleanup_stage"] == "binding_create_compensation"
    assert cleanup_record.__dict__["exception_type"] == "WriteError"


@pytest.mark.anyio
async def test_e2b_binding_create_fails_closed_when_initial_pause_retries_are_exhausted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    control = _ControlPlane(
        sandbox_pause_errors=[
            _transport_error(e2b_httpx.ReadError),
            _transport_error(e2b_httpx.ReadError),
        ]
    )
    backend = E2BExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        template="prepared-template",
        active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS,
    )
    sleeps: list[float] = []

    async def record_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(e2b_module.asyncio, "sleep", record_sleep)
    with pytest.raises(BindingCreateError, match="stale E2B connection"):
        _ = await backend.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                binding_id="binding-1",
                workspace_id="workspace-1",
                existing_workspace_ref=None,
            )
        )

    sandbox = next(iter(control.sandboxes.values()))
    assert sandbox.pauses == [True, True]
    assert sandbox.killed == 1
    assert sleeps == [0.25]


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
@pytest.mark.parametrize(
    ("close_fails", "pause_fails", "expected_warning_count"),
    [
        (True, False, 1),
        (False, True, 1),
        (True, True, 2),
    ],
)
async def test_e2b_release_warns_without_raising_for_cleanup_failures(
    caplog: pytest.LogCaptureFixture,
    close_fails: bool,
    pause_fails: bool,
    expected_warning_count: int,
) -> None:
    data_plane = _ReleaseDataPlane(close_error=RuntimeError("close failed") if close_fails else None)
    sandbox = _Sandbox(
        sandbox_id="sandbox-release",
        pause_error=RuntimeError("pause failed") if pause_fails else None,
    )
    lease = E2BRuntimeLease(
        sandbox=sandbox,  # pyright: ignore[reportArgumentType]
        data_plane=cast(ShellctlRuntimeLease, cast(object, data_plane)),
    )
    backend, _ = _connected_backend()

    with caplog.at_level(logging.WARNING, logger="dify_agent.runtime_backend.e2b"):
        await backend.release(lease)

    assert data_plane.close_calls == 1
    assert sandbox.pauses == [True]
    records = [record for record in caplog.records if record.name == "dify_agent.runtime_backend.e2b"]
    assert len(records) == expected_warning_count
    for record in records:
        assert record.__dict__["sandbox_id"] == sandbox.sandbox_id
        assert record.__dict__["cleanup_stage"] == "binding_release"
        assert record.__dict__["outcome"] == "ignored_cleanup_failure"
        assert isinstance(record.__dict__["e2b_operation"], str)
        assert isinstance(record.__dict__["attempt"], int)
        assert isinstance(record.__dict__["exception_type"], str)


@pytest.mark.anyio
async def test_e2b_release_retries_pause_transport_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    data_plane = _ReleaseDataPlane()
    sandbox = _Sandbox(
        sandbox_id="sandbox-release",
        pause_errors=[_transport_error(e2b_httpx.RemoteProtocolError)],
    )
    lease = E2BRuntimeLease(
        sandbox=sandbox,  # pyright: ignore[reportArgumentType]
        data_plane=cast(ShellctlRuntimeLease, cast(object, data_plane)),
    )
    backend, _ = _connected_backend()
    sleeps: list[float] = []

    async def record_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(e2b_module.asyncio, "sleep", record_sleep)
    await backend.release(lease)

    assert data_plane.close_calls == 1
    assert sandbox.pauses == [True, True]
    assert sleeps == [0.25]


@pytest.mark.anyio
@pytest.mark.parametrize("failure_stage", ["close", "pause"])
async def test_e2b_release_does_not_swallow_base_exceptions(failure_stage: str) -> None:
    data_plane = _ReleaseDataPlane(
        close_error=asyncio.CancelledError() if failure_stage == "close" else None,
    )
    sandbox = _Sandbox(
        sandbox_id="sandbox-release",
        pause_errors=[asyncio.CancelledError()] if failure_stage == "pause" else [],
    )
    lease = E2BRuntimeLease(
        sandbox=sandbox,  # pyright: ignore[reportArgumentType]
        data_plane=cast(ShellctlRuntimeLease, cast(object, data_plane)),
    )
    backend, _ = _connected_backend()

    with pytest.raises(asyncio.CancelledError):
        await backend.release(lease)

    assert data_plane.close_calls == 1
    assert sandbox.pauses == [True]


@pytest.mark.anyio
async def test_e2b_release_preserves_close_base_exception_when_pause_also_raises() -> None:
    close_error = asyncio.CancelledError("close cancelled")
    pause_error = asyncio.CancelledError("pause cancelled")
    data_plane = _ReleaseDataPlane(close_error=close_error)
    sandbox = _Sandbox(sandbox_id="sandbox-release", pause_errors=[pause_error])
    lease = E2BRuntimeLease(
        sandbox=sandbox,  # pyright: ignore[reportArgumentType]
        data_plane=cast(ShellctlRuntimeLease, cast(object, data_plane)),
    )
    backend, _ = _connected_backend()

    with pytest.raises(asyncio.CancelledError) as exc_info:
        await backend.release(lease)

    assert exc_info.value is close_error
    assert exc_info.value.__cause__ is pause_error
    assert data_plane.close_calls == 1
    assert sandbox.pauses == [True]


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
