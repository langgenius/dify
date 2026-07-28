from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import cast

import opendal
import pytest

from dify_agent.adapters.shell.protocols import (
    CompleteShellCommandResult,
    ShellCommandResult,
    ShellCommandStatus,
)
from dify_agent.agent_stub.protocol import (
    AGENT_STUB_API_BASE_URL_ENV_VAR,
    AGENT_STUB_AUTH_JWE_ENV_VAR,
)
from dify_agent.agent_stub.server.tokens.home_snapshot import (
    HOME_SNAPSHOT_SCOPE_READ,
    HOME_SNAPSHOT_SCOPE_WRITE,
    HomeSnapshotTransferTokenCodec,
)
from dify_agent.runtime_backend import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
    BindingLostError,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateError,
    HomeSnapshotCreateSpec,
    RuntimeLayout,
)
from dify_agent.runtime_backend.e2b import E2BControlPlaneNotFoundError, E2BRuntimeLease, E2BSandbox
from dify_agent.runtime_backend.e2b_s3 import (
    E2BHomeSnapshotCLI,
    E2BS3ExecutionBindingBackend,
    E2BS3HomeSnapshotBackend,
    E2BS3RuntimeLease,
    HomeSnapshotTransferError,
    OpenDALHomeArchiveStore,
)
from dify_agent.runtime_backend.errors import HomeArchiveConflictError, HomeSnapshotNotFoundError
from dify_agent.runtime_backend.home_snapshot_refs import (
    build_home_snapshot_ref,
    validate_home_snapshot_ref,
)
from dify_agent.runtime_backend.shellctl import ShellctlRuntimeLease

_WORKSPACE = "/home/dify/workspace"
_HOMES = "/home/dify/.dify-agent-materialized-homes"
_RUNTIME = "/home/dify/.dify-agent-runtime"
_WORKSPACE_ID = f"{_RUNTIME}/workspace-id"
_SNAPSHOT = "home-snapshots/tenant-1/agent-1/snapshot-1.tar.zst"


class _FileType(Enum):
    FILE = "file"
    DIR = "dir"


@dataclass(frozen=True, slots=True)
class _FileInfo:
    type: _FileType | None
    symlink_target: str | None = None


@dataclass(slots=True)
class _Files:
    paths: set[str] = field(default_factory=set)
    content: dict[str, str] = field(default_factory=dict)
    info_overrides: dict[str, _FileInfo] = field(default_factory=dict)
    make_dir_overrides: dict[str, _FileInfo] = field(default_factory=dict)

    async def make_dir(self, path: str) -> bool:
        if override := self.make_dir_overrides.get(path):
            self.info_overrides[path] = override
            return True
        self.info_overrides.pop(path, None)
        self.paths.add(path)
        return True

    async def exists(self, path: str) -> bool:
        return path in self.paths or path in self.content or path in self.info_overrides

    async def get_info(self, path: str) -> _FileInfo:
        if override := self.info_overrides.get(path):
            return override
        if path in self.paths:
            return _FileInfo(type=_FileType.DIR)
        if path in self.content:
            return _FileInfo(type=_FileType.FILE)
        raise FileNotFoundError(path)

    async def remove(self, path: str) -> None:
        self.paths = {
            candidate for candidate in self.paths if candidate != path and not candidate.startswith(path + "/")
        }
        self.content = {
            candidate: value
            for candidate, value in self.content.items()
            if candidate != path and not candidate.startswith(path + "/")
        }
        self.info_overrides = {
            candidate: value
            for candidate, value in self.info_overrides.items()
            if candidate != path and not candidate.startswith(path + "/")
        }

    async def read(self, path: str) -> str:
        return self.content[path]

    async def write(self, path: str, data: str | bytes) -> object:
        self.content[path] = data.decode() if isinstance(data, bytes) else data
        return object()


@dataclass(slots=True)
class _Sandbox:
    sandbox_id: str
    files: _Files = field(default_factory=_Files)
    traffic_access_token: str | None = None
    pauses: list[bool] = field(default_factory=list)
    kills: int = 0
    kill_error: BaseException | None = None
    pause_error: Exception | None = None

    def get_host(self, port: int) -> str:
        return f"{self.sandbox_id}-{port}.example.test"

    async def pause(self, keep_memory: bool = True) -> bool:
        self.pauses.append(keep_memory)
        if self.pause_error is not None:
            raise self.pause_error
        return True

    async def kill(self) -> bool:
        self.kills += 1
        if self.kill_error is not None:
            raise self.kill_error
        return True


@dataclass(slots=True)
class _ControlPlane:
    sandboxes: dict[str, _Sandbox] = field(default_factory=dict)
    creates: list[tuple[str, str, dict[str, str]]] = field(default_factory=list)
    connects: list[str] = field(default_factory=list)
    kills: list[str] = field(default_factory=list)
    sandbox_kill_error: BaseException | None = None
    sandbox_pause_error: Exception | None = None

    async def create(
        self,
        template: str,
        *,
        timeout: int,
        metadata: dict[str, str],
        on_timeout: str,
    ) -> _Sandbox:
        del timeout
        sandbox = _Sandbox(
            sandbox_id=f"sandbox-{len(self.sandboxes) + 1}",
            kill_error=self.sandbox_kill_error,
            pause_error=self.sandbox_pause_error,
        )
        self.sandboxes[sandbox.sandbox_id] = sandbox
        self.creates.append((template, on_timeout, metadata))
        return sandbox

    async def connect(self, handle: str, *, timeout: int) -> _Sandbox:
        del timeout
        self.connects.append(handle)
        try:
            return self.sandboxes[handle]
        except KeyError as exc:
            raise E2BControlPlaneNotFoundError(handle) from exc

    async def kill(self, handle: str) -> bool:
        self.kills.append(handle)
        if self.sandboxes.pop(handle, None) is None:
            raise E2BControlPlaneNotFoundError(handle)
        return True

    async def delete_snapshot(self, snapshot_ref: str) -> bool:
        del snapshot_ref
        return True


@dataclass(slots=True)
class _LifecycleCLI:
    uploads: list[tuple[str, str, str, tuple[str, ...]]] = field(default_factory=list)
    downloads: list[tuple[str, str, str]] = field(default_factory=list)
    fail_upload: bool = False
    fail_download: bool = False

    async def upload(
        self,
        *,
        sandbox: _Sandbox,
        home_dir: str,
        snapshot_ref: str,
        excludes: tuple[str, ...] = (),
    ) -> None:
        self.uploads.append((sandbox.sandbox_id, home_dir, snapshot_ref, excludes))
        if self.fail_upload:
            raise RuntimeError("upload failed")

    async def download(self, *, sandbox: _Sandbox, home_dir: str, snapshot_ref: str) -> None:
        self.downloads.append((sandbox.sandbox_id, home_dir, snapshot_ref))
        if self.fail_download:
            raise RuntimeError("download failed")
        sandbox.files.paths.add(f"{home_dir}/restored")


@dataclass(slots=True)
class _Commands:
    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
    ) -> ShellCommandResult:
        del script, cwd, env, timeout
        return ShellCommandResult("job", "exited", True, 0, "", 0, False)

    async def wait(self, job_id: str, *, offset: int, timeout: float) -> ShellCommandResult:
        raise AssertionError((job_id, offset, timeout))

    async def read_output(self, job_id: str, *, offset: int) -> ShellCommandResult:
        raise AssertionError((job_id, offset))

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float) -> ShellCommandResult:
        raise AssertionError((job_id, text, offset, timeout))

    async def interrupt(self, job_id: str, *, grace_seconds: float) -> ShellCommandStatus:
        raise AssertionError((job_id, grace_seconds))

    async def tail(self, job_id: str) -> ShellCommandResult:
        raise AssertionError(job_id)

    async def delete(self, job_id: str, *, force: bool = False, grace_seconds: float | None = None) -> None:
        del job_id, force, grace_seconds


@dataclass(slots=True)
class _DataPlane:
    layout: RuntimeLayout
    commands: _Commands = field(default_factory=_Commands)
    files: object = field(default_factory=object)
    close_calls: int = 0

    async def close(self) -> None:
        self.close_calls += 1


def _backend(control: _ControlPlane, cli: _LifecycleCLI) -> E2BS3ExecutionBindingBackend:
    return E2BS3ExecutionBindingBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        lifecycle_cli=cast(E2BHomeSnapshotCLI, cast(object, cli)),
        template="prepared-template",
        active_timeout_seconds=3600,
        shellctl_auth_token="shell-token",
        shellctl_port=5004,
    )


@pytest.fixture
def fake_e2b_lease(monkeypatch: pytest.MonkeyPatch):
    leases: list[_DataPlane] = []

    async def create_lease(*, sandbox, layout, shellctl_auth_token, shellctl_port):
        del sandbox, shellctl_auth_token, shellctl_port
        lease = _DataPlane(layout=layout)
        leases.append(lease)
        return cast(ShellctlRuntimeLease, cast(object, lease))

    monkeypatch.setattr("dify_agent.runtime_backend.e2b_s3.create_e2b_shellctl_lease", create_lease)
    return leases


@pytest.mark.anyio
async def test_e2b_s3_bindings_share_workspace_and_keep_private_homes(fake_e2b_lease) -> None:
    control = _ControlPlane()
    cli = _LifecycleCLI()
    backend = _backend(control, cli)

    first = await backend.create_binding(
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-a",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref=_SNAPSHOT,
        )
    )
    second = await backend.create_binding(
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-2",
            binding_id="binding-b",
            workspace_id="workspace-1",
            existing_workspace_ref=first.workspace_ref,
            home_snapshot_ref=_SNAPSHOT,
        )
    )

    assert first.workspace_ref == second.workspace_ref == "sandbox-1"
    assert first.binding_ref == "sandbox-1:binding-a"
    assert second.binding_ref == "sandbox-1:binding-b"
    sandbox = control.sandboxes["sandbox-1"]
    assert sandbox.files.content[_WORKSPACE_ID] == "workspace-1\n"
    assert f"{_HOMES}/binding-a/restored" in sandbox.files.paths
    assert f"{_HOMES}/binding-b/restored" in sandbox.files.paths
    assert sandbox.pauses == [True]

    lease = await backend.acquire(second.binding_ref)
    assert lease.layout == RuntimeLayout(home_dir=f"{_HOMES}/binding-b", workspace_dir=_WORKSPACE)
    acquired_data_plane = fake_e2b_lease[-1]
    await backend.release(lease)
    assert acquired_data_plane.close_calls == 1
    assert sandbox.pauses == [True]

    await backend.destroy_binding(ExecutionBindingDestroySpec(binding_ref=second.binding_ref, destroy_workspace=False))
    assert not await sandbox.files.exists(f"{_HOMES}/binding-b")
    assert await sandbox.files.exists(f"{_HOMES}/binding-a")
    assert await sandbox.files.exists(_WORKSPACE)
    await backend.destroy_binding(
        ExecutionBindingDestroySpec(
            binding_ref=first.binding_ref,
            destroy_workspace=True,
            workspace_ref=first.workspace_ref,
        )
    )
    assert control.kills == ["sandbox-1"]


@pytest.mark.anyio
async def test_e2b_s3_existing_workspace_mismatch_fails_before_home_write(fake_e2b_lease) -> None:
    control = _ControlPlane()
    cli = _LifecycleCLI()
    backend = _backend(control, cli)
    first = await backend.create_binding(
        ExecutionBindingCreateSpec("tenant-1", "agent-1", "binding-a", "workspace-1", None, _SNAPSHOT)
    )

    with pytest.raises(BindingCreateError, match="does not match"):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                "tenant-1",
                "agent-2",
                "binding-b",
                "workspace-other",
                first.workspace_ref,
                _SNAPSHOT,
            )
        )

    assert not await control.sandboxes["sandbox-1"].files.exists(f"{_HOMES}/binding-b")


@pytest.mark.parametrize("path", (_WORKSPACE, _HOMES, _RUNTIME))
@pytest.mark.parametrize(
    "info",
    (
        _FileInfo(type=_FileType.FILE),
        _FileInfo(type=_FileType.DIR, symlink_target="/tmp/redirected"),
    ),
    ids=("file", "symlink"),
)
@pytest.mark.anyio
async def test_e2b_s3_existing_workspace_rejects_non_directory_layout_before_home_write(
    fake_e2b_lease,
    path: str,
    info: _FileInfo,
) -> None:
    control = _ControlPlane()
    cli = _LifecycleCLI()
    backend = _backend(control, cli)
    first = await backend.create_binding(
        ExecutionBindingCreateSpec("tenant-1", "agent-1", "binding-a", "workspace-1", None, _SNAPSHOT)
    )
    sandbox = control.sandboxes[first.workspace_ref]
    sandbox.files.info_overrides[path] = info

    with pytest.raises(BindingCreateError, match="not a real directory"):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                "tenant-1",
                "agent-2",
                "binding-b",
                "workspace-1",
                first.workspace_ref,
                _SNAPSHOT,
            )
        )

    assert len(cli.downloads) == 1
    assert not await sandbox.files.exists(f"{_HOMES}/binding-b")


@pytest.mark.anyio
async def test_e2b_s3_existing_participant_home_is_not_overwritten(fake_e2b_lease) -> None:
    control = _ControlPlane()
    cli = _LifecycleCLI()
    backend = _backend(control, cli)
    first = await backend.create_binding(
        ExecutionBindingCreateSpec("tenant-1", "agent-1", "binding-a", "workspace-1", None, _SNAPSHOT)
    )

    with pytest.raises(BindingCreateError, match="already exists"):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                "tenant-1",
                "agent-1",
                "binding-a",
                "workspace-1",
                first.workspace_ref,
                _SNAPSHOT,
            )
        )

    assert len(cli.downloads) == 1
    assert await control.sandboxes["sandbox-1"].files.exists(f"{_HOMES}/binding-a/restored")


@pytest.mark.parametrize(
    "info",
    (
        _FileInfo(type=_FileType.FILE),
        _FileInfo(type=_FileType.DIR, symlink_target="/tmp/redirected"),
    ),
    ids=("file", "symlink"),
)
@pytest.mark.anyio
async def test_e2b_s3_existing_workspace_rejects_non_directory_home_created_by_provider(
    fake_e2b_lease,
    info: _FileInfo,
) -> None:
    control = _ControlPlane()
    cli = _LifecycleCLI()
    backend = _backend(control, cli)
    first = await backend.create_binding(
        ExecutionBindingCreateSpec("tenant-1", "agent-1", "binding-a", "workspace-1", None, _SNAPSHOT)
    )
    sandbox = control.sandboxes[first.workspace_ref]
    home_dir = f"{_HOMES}/binding-b"
    sandbox.files.make_dir_overrides[home_dir] = info

    with pytest.raises(BindingCreateError, match="not a real directory"):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                "tenant-1",
                "agent-2",
                "binding-b",
                "workspace-1",
                first.workspace_ref,
                _SNAPSHOT,
            )
        )

    assert len(cli.downloads) == 1
    assert not await sandbox.files.exists(home_dir)


@pytest.mark.anyio
async def test_e2b_s3_materialization_failure_removes_only_new_home(fake_e2b_lease) -> None:
    control = _ControlPlane()
    cli = _LifecycleCLI()
    backend = _backend(control, cli)
    first = await backend.create_binding(
        ExecutionBindingCreateSpec("tenant-1", "agent-1", "binding-a", "workspace-1", None, _SNAPSHOT)
    )
    cli.fail_download = True

    with pytest.raises(BindingCreateError, match="download failed"):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                "tenant-1",
                "agent-2",
                "binding-b",
                "workspace-1",
                first.workspace_ref,
                _SNAPSHOT,
            )
        )

    sandbox = control.sandboxes["sandbox-1"]
    assert await sandbox.files.exists(f"{_HOMES}/binding-a")
    assert not await sandbox.files.exists(f"{_HOMES}/binding-b")
    assert await sandbox.files.exists(_WORKSPACE)


@pytest.mark.parametrize("failure_stage", ("materialize", "control", "pause"))
@pytest.mark.anyio
async def test_e2b_s3_first_binding_failure_kills_new_sandbox(
    fake_e2b_lease,
    monkeypatch: pytest.MonkeyPatch,
    failure_stage: str,
) -> None:
    control = _ControlPlane(sandbox_pause_error=RuntimeError("pause failed") if failure_stage == "pause" else None)
    cli = _LifecycleCLI(fail_download=failure_stage == "materialize")
    if failure_stage == "control":

        async def fail_control_lease(**_kwargs: object) -> ShellctlRuntimeLease:
            raise RuntimeError("control failed")

        monkeypatch.setattr("dify_agent.runtime_backend.e2b_s3.create_e2b_shellctl_lease", fail_control_lease)
    backend = _backend(control, cli)

    expected_error = {
        "materialize": "download failed",
        "control": "control failed",
        "pause": "pause failed",
    }[failure_stage]
    with pytest.raises(BindingCreateError, match=expected_error):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                "tenant-1",
                "agent-1",
                "binding-a",
                "workspace-1",
                None,
                _SNAPSHOT,
            )
        )

    sandbox = control.sandboxes["sandbox-1"]
    assert sandbox.kills == 1


@pytest.mark.anyio
async def test_e2b_s3_invalid_binding_ref_fails_before_connect() -> None:
    control = _ControlPlane()
    backend = _backend(control, _LifecycleCLI())

    with pytest.raises(BindingAcquireError, match="safe path segment"):
        _ = await backend.acquire("../sandbox:binding-a")

    assert control.connects == []


@pytest.mark.anyio
async def test_e2b_s3_invalid_workspace_ref_fails_before_connect_or_write() -> None:
    control = _ControlPlane()
    backend = _backend(control, _LifecycleCLI())

    with pytest.raises(BindingCreateError):
        _ = await backend.create_binding(
            ExecutionBindingCreateSpec(
                "tenant-1",
                "agent-1",
                "binding-a",
                "workspace-1",
                "../sandbox",
                _SNAPSHOT,
            )
        )

    assert control.connects == []
    assert control.sandboxes == {}


@pytest.mark.anyio
async def test_e2b_s3_destroy_workspace_ref_mismatch_does_not_kill() -> None:
    control = _ControlPlane()
    backend = _backend(control, _LifecycleCLI())

    with pytest.raises(BindingDestroyError, match="must match"):
        await backend.destroy_binding(
            ExecutionBindingDestroySpec(
                binding_ref="sandbox-1:binding-a",
                workspace_ref="sandbox-2",
                destroy_workspace=True,
            )
        )

    assert control.kills == []


@pytest.mark.parametrize("path_kind", ("home", "workspace", "home-root", "runtime-root"))
@pytest.mark.parametrize(
    "info",
    (
        _FileInfo(type=_FileType.FILE),
        _FileInfo(type=_FileType.DIR, symlink_target="/tmp/redirected"),
    ),
    ids=("file", "symlink"),
)
@pytest.mark.anyio
async def test_e2b_s3_acquire_rejects_non_directory_layout(
    fake_e2b_lease,
    path_kind: str,
    info: _FileInfo,
) -> None:
    control = _ControlPlane()
    cli = _LifecycleCLI()
    backend = _backend(control, cli)
    allocation = await backend.create_binding(
        ExecutionBindingCreateSpec("tenant-1", "agent-1", "binding-a", "workspace-1", None, _SNAPSHOT)
    )
    paths = {
        "home": f"{_HOMES}/binding-a",
        "workspace": _WORKSPACE,
        "home-root": _HOMES,
        "runtime-root": _RUNTIME,
    }
    control.sandboxes[allocation.workspace_ref].files.info_overrides[paths[path_kind]] = info
    lease_count = len(fake_e2b_lease)

    with pytest.raises(BindingLostError, match="no longer contains"):
        await backend.acquire(allocation.binding_ref)

    assert len(fake_e2b_lease) == lease_count


@pytest.mark.anyio
async def test_e2b_s3_binding_cleanup_is_idempotent_after_workspace_was_removed(fake_e2b_lease) -> None:
    control = _ControlPlane()
    cli = _LifecycleCLI()
    backend = _backend(control, cli)
    allocation = await backend.create_binding(
        ExecutionBindingCreateSpec("tenant-1", "agent-1", "binding-a", "workspace-1", None, _SNAPSHOT)
    )
    await backend.destroy_binding(
        ExecutionBindingDestroySpec(
            binding_ref=allocation.binding_ref,
            workspace_ref=allocation.workspace_ref,
            destroy_workspace=True,
        )
    )

    await backend.destroy_binding(
        ExecutionBindingDestroySpec(binding_ref=allocation.binding_ref, destroy_workspace=False)
    )


@pytest.mark.anyio
async def test_e2b_s3_snapshot_uses_only_its_own_runtime_and_baseline_excludes() -> None:
    control = _ControlPlane()
    cli = _LifecycleCLI()
    store = OpenDALHomeArchiveStore(operator=opendal.AsyncOperator("memory"))
    backend = E2BS3HomeSnapshotBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        archive_store=store,
        lifecycle_cli=cast(E2BHomeSnapshotCLI, cast(object, cli)),
        template="prepared-template",
        active_timeout_seconds=3600,
    )
    source_sandbox = _Sandbox("source")
    source_data_plane = _DataPlane(layout=RuntimeLayout(home_dir=f"{_HOMES}/binding-a", workspace_dir=_WORKSPACE))
    source = E2BS3RuntimeLease(
        sandbox=cast(E2BSandbox, cast(object, source_sandbox)),
        data_plane=cast(
            ShellctlRuntimeLease,
            cast(object, source_data_plane),
        ),
    )

    snapshot_ref = await backend.create_from_runtime(
        spec=HomeSnapshotCreateSpec("tenant-1", "agent-1", "snapshot-1"),
        source=source,
    )
    baseline_ref = await backend.initialize(HomeSnapshotCreateSpec("tenant-1", "agent-1", "baseline"))

    assert snapshot_ref == _SNAPSHOT
    assert cli.uploads[0] == ("source", f"{_HOMES}/binding-a", _SNAPSHOT, ())
    assert source_data_plane.close_calls == 0
    assert source_sandbox.pauses == []
    assert source_sandbox.kills == 0
    assert cli.uploads[1][1] == "/home/dify"
    assert cli.uploads[1][3] == (
        "workspace",
        ".dify-agent-materialized-homes",
        ".dify-agent-runtime",
        ".local/share/shellctl",
    )
    assert baseline_ref.endswith("/baseline.tar.zst")
    temporary = control.sandboxes["sandbox-1"]
    assert temporary.kills == 1

    native_source = E2BRuntimeLease(
        sandbox=cast(E2BSandbox, cast(object, source_sandbox)),
        data_plane=cast(ShellctlRuntimeLease, object()),
    )
    with pytest.raises(HomeSnapshotCreateError, match="E2BS3RuntimeLease"):
        await backend.create_from_runtime(
            spec=HomeSnapshotCreateSpec("tenant-1", "agent-1", "snapshot-2"),
            source=native_source,
        )


@pytest.mark.anyio
async def test_e2b_s3_initialize_upload_failure_still_kills_temporary_sandbox() -> None:
    control = _ControlPlane()
    backend = E2BS3HomeSnapshotBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        archive_store=OpenDALHomeArchiveStore(operator=opendal.AsyncOperator("memory")),
        lifecycle_cli=cast(E2BHomeSnapshotCLI, cast(object, _LifecycleCLI(fail_upload=True))),
        template="prepared-template",
        active_timeout_seconds=3600,
    )

    with pytest.raises(HomeSnapshotCreateError, match="upload failed"):
        _ = await backend.initialize(HomeSnapshotCreateSpec("tenant-1", "agent-1", "baseline"))

    assert control.sandboxes["sandbox-1"].kills == 1


@pytest.mark.anyio
async def test_e2b_s3_create_from_runtime_failure_does_not_own_source_lease() -> None:
    control = _ControlPlane()
    source_sandbox = _Sandbox("source")
    source_data_plane = _DataPlane(layout=RuntimeLayout(home_dir=f"{_HOMES}/binding-a", workspace_dir=_WORKSPACE))
    source = E2BS3RuntimeLease(
        sandbox=cast(E2BSandbox, cast(object, source_sandbox)),
        data_plane=cast(ShellctlRuntimeLease, cast(object, source_data_plane)),
    )
    backend = E2BS3HomeSnapshotBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        archive_store=OpenDALHomeArchiveStore(operator=opendal.AsyncOperator("memory")),
        lifecycle_cli=cast(E2BHomeSnapshotCLI, cast(object, _LifecycleCLI(fail_upload=True))),
        template="prepared-template",
        active_timeout_seconds=3600,
    )

    with pytest.raises(HomeSnapshotCreateError, match="upload failed"):
        _ = await backend.create_from_runtime(
            spec=HomeSnapshotCreateSpec("tenant-1", "agent-1", "snapshot-1"),
            source=source,
        )

    assert source_data_plane.close_calls == 0
    assert source_sandbox.pauses == []
    assert source_sandbox.kills == 0


@pytest.mark.anyio
async def test_e2b_s3_initialize_propagates_temporary_sandbox_kill_cancellation() -> None:
    control = _ControlPlane(sandbox_kill_error=asyncio.CancelledError())
    cli = _LifecycleCLI()
    backend = E2BS3HomeSnapshotBackend(
        control_plane=control,  # pyright: ignore[reportArgumentType]
        archive_store=OpenDALHomeArchiveStore(operator=opendal.AsyncOperator("memory")),
        lifecycle_cli=cast(E2BHomeSnapshotCLI, cast(object, cli)),
        template="prepared-template",
        active_timeout_seconds=3600,
    )

    with pytest.raises(asyncio.CancelledError):
        _ = await backend.initialize(HomeSnapshotCreateSpec("tenant-1", "agent-1", "baseline"))

    assert control.sandboxes["sandbox-1"].kills == 1


@pytest.mark.anyio
async def test_home_snapshot_cli_uses_operation_env_and_no_total_timeout(
    fake_e2b_lease,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    codec = HomeSnapshotTransferTokenCodec(b"k" * 32)
    calls: list[tuple[str, str | None, dict[str, str] | None, float | None, int]] = []

    async def execute(
        commands,
        script: str,
        *,
        cwd: str | None,
        env: dict[str, str] | None,
        timeout: float | None,
        max_output_bytes: int,
    ) -> CompleteShellCommandResult:
        del commands
        calls.append((script, cwd, env, timeout, max_output_bytes))
        return CompleteShellCommandResult(
            job_id="job",
            status="exited",
            done=True,
            exit_code=0,
            output="",
            output_complete=True,
            incomplete_reason=None,
            offset=0,
            output_path=None,
        )

    monkeypatch.setattr("dify_agent.runtime_backend.e2b_s3.execute_complete_with_commands", execute)
    cli = E2BHomeSnapshotCLI(
        token_codec=codec,
        agent_stub_api_base_url="https://stub.example.test/agent-stub",
        shellctl_auth_token="shell-token",
        shellctl_port=5004,
    )

    await cli.download(
        sandbox=cast(E2BSandbox, cast(object, _Sandbox("sandbox-1"))),
        home_dir=f"{_HOMES}/binding-a",
        snapshot_ref=_SNAPSHOT,
    )

    assert len(calls) == 1
    script, cwd, env, timeout, max_output_bytes = calls[0]
    assert script == "dify-agent home-snapshot download"
    assert cwd is None
    assert timeout is None
    assert max_output_bytes == 256 * 1024
    assert env is not None
    assert env[AGENT_STUB_API_BASE_URL_ENV_VAR] == "https://stub.example.test/agent-stub"
    token = env[AGENT_STUB_AUTH_JWE_ENV_VAR]
    assert codec.decode_token(token, required_scope=HOME_SNAPSHOT_SCOPE_READ).snapshot_ref == _SNAPSHOT
    assert fake_e2b_lease[0].layout == RuntimeLayout(
        home_dir=f"{_HOMES}/binding-a",
        workspace_dir=f"{_HOMES}/binding-a",
    )
    assert fake_e2b_lease[0].close_calls == 1


@pytest.mark.anyio
async def test_home_snapshot_cli_upload_uses_baseline_argv_write_scope_and_home_layout(
    fake_e2b_lease,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    codec = HomeSnapshotTransferTokenCodec(b"k" * 32)
    calls: list[tuple[str, str | None, dict[str, str] | None, float | None]] = []

    async def execute(
        commands,
        script: str,
        *,
        cwd: str | None,
        env: dict[str, str] | None,
        timeout: float | None,
        max_output_bytes: int,
    ) -> CompleteShellCommandResult:
        del commands, max_output_bytes
        calls.append((script, cwd, env, timeout))
        return CompleteShellCommandResult(
            job_id="job",
            status="exited",
            done=True,
            exit_code=0,
            output="",
            output_complete=True,
            incomplete_reason=None,
            offset=0,
            output_path=None,
        )

    monkeypatch.setattr("dify_agent.runtime_backend.e2b_s3.execute_complete_with_commands", execute)
    cli = E2BHomeSnapshotCLI(
        token_codec=codec,
        agent_stub_api_base_url="https://stub.example.test/agent-stub",
        shellctl_auth_token="shell-token",
        shellctl_port=5004,
    )
    excludes = (
        "workspace",
        ".dify-agent-materialized-homes",
        ".dify-agent-runtime",
        ".local/share/shellctl",
    )

    await cli.upload(
        sandbox=cast(E2BSandbox, cast(object, _Sandbox("sandbox-1"))),
        home_dir="/home/dify",
        snapshot_ref=_SNAPSHOT,
        excludes=excludes,
    )

    assert len(calls) == 1
    script, cwd, env, timeout = calls[0]
    assert script == (
        "dify-agent home-snapshot upload"
        " --exclude workspace"
        " --exclude .dify-agent-materialized-homes"
        " --exclude .dify-agent-runtime"
        " --exclude .local/share/shellctl"
    )
    assert cwd is None
    assert timeout is None
    assert env is not None
    token = env[AGENT_STUB_AUTH_JWE_ENV_VAR]
    assert codec.decode_token(token, required_scope=HOME_SNAPSHOT_SCOPE_WRITE).snapshot_ref == _SNAPSHOT
    assert fake_e2b_lease[0].layout == RuntimeLayout(
        home_dir="/home/dify",
        workspace_dir="/home/dify",
    )
    assert fake_e2b_lease[0].close_calls == 1


@pytest.mark.parametrize("failure", ("nonzero", "output-limit", "cancellation"))
@pytest.mark.anyio
async def test_home_snapshot_cli_failure_always_closes_control_lease(
    fake_e2b_lease,
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    async def execute(
        commands,
        script: str,
        *,
        cwd: str | None,
        env: dict[str, str] | None,
        timeout: float | None,
        max_output_bytes: int,
    ) -> CompleteShellCommandResult:
        del commands, script, cwd, env, timeout, max_output_bytes
        if failure == "cancellation":
            raise asyncio.CancelledError
        return CompleteShellCommandResult(
            job_id="job",
            status="exited",
            done=True,
            exit_code=1 if failure == "nonzero" else 0,
            output="command failed" if failure == "nonzero" else "",
            output_complete=failure != "output-limit",
            incomplete_reason="output_limit" if failure == "output-limit" else None,
            offset=0,
            output_path=None,
        )

    monkeypatch.setattr("dify_agent.runtime_backend.e2b_s3.execute_complete_with_commands", execute)
    cli = E2BHomeSnapshotCLI(
        token_codec=HomeSnapshotTransferTokenCodec(b"k" * 32),
        agent_stub_api_base_url="https://stub.example.test/agent-stub",
        shellctl_auth_token="shell-token",
        shellctl_port=5004,
    )

    if failure == "cancellation":
        with pytest.raises(asyncio.CancelledError):
            await cli.upload(
                sandbox=cast(E2BSandbox, cast(object, _Sandbox("sandbox-1"))),
                home_dir="/home/dify",
                snapshot_ref=_SNAPSHOT,
            )
    else:
        with pytest.raises(HomeSnapshotTransferError):
            await cli.upload(
                sandbox=cast(E2BSandbox, cast(object, _Sandbox("sandbox-1"))),
                home_dir="/home/dify",
                snapshot_ref=_SNAPSHOT,
            )

    assert fake_e2b_lease[0].close_calls == 1


def test_opendal_store_constructs_from_uri_when_required_capabilities_are_supported(tmp_path: Path) -> None:
    store = OpenDALHomeArchiveStore.create_from_uri(f"fs://{tmp_path}")

    assert isinstance(store.operator, opendal.AsyncOperator)


def test_opendal_store_rejects_uri_with_missing_required_capabilities() -> None:
    with pytest.raises(
        ValueError,
        match=(
            "OpenDAL Home Snapshot storage is missing required capabilities: "
            "write, write_can_multi, write_with_if_not_exists, delete"
        ),
    ):
        _ = OpenDALHomeArchiveStore.create_from_uri("http://example.com/root")


@pytest.mark.anyio
async def test_opendal_store_conditionally_writes_streams_and_deletes_idempotently() -> None:
    store = OpenDALHomeArchiveStore(operator=opendal.AsyncOperator("memory"))
    writer = await store.open_writer(_SNAPSHOT)
    assert await writer.write(b"archive") == len(b"archive")
    await writer.close()

    conflicting_writer = await store.open_writer(_SNAPSHOT)
    _ = await conflicting_writer.write(b"replacement")
    with pytest.raises(HomeArchiveConflictError):
        await conflicting_writer.close()

    reader = await store.open_reader(_SNAPSHOT)
    assert await reader.read(1024 * 1024) == b"archive"
    assert await reader.read(1024 * 1024) == b""
    await reader.close()
    await store.delete(_SNAPSHOT)
    await store.delete(_SNAPSHOT)


@pytest.mark.anyio
async def test_opendal_memory_store_maps_missing_archive() -> None:
    store = OpenDALHomeArchiveStore(operator=opendal.AsyncOperator("memory"))

    with pytest.raises(HomeSnapshotNotFoundError):
        _ = await store.open_reader(_SNAPSHOT)


@pytest.mark.anyio
async def test_opendal_store_maps_conditional_write_conflict() -> None:
    class _ConflictOperator:
        async def open(self, path: str, mode: str, **kwargs):
            del path, mode, kwargs
            raise opendal.exceptions.ConditionNotMatch("object exists")

    store = OpenDALHomeArchiveStore(operator=cast(opendal.AsyncOperator, cast(object, _ConflictOperator())))

    with pytest.raises(HomeArchiveConflictError):
        _ = await store.open_writer(_SNAPSHOT)


@pytest.mark.anyio
async def test_opendal_store_maps_conditional_write_conflict_reported_on_close() -> None:
    class _ConflictFile:
        async def read(self, size: int | None = None) -> bytes:
            del size
            return b""

        async def write(self, data: bytes) -> int:
            return len(data)

        async def close(self) -> None:
            raise opendal.exceptions.ConditionNotMatch("object exists")

    class _ConflictOperator:
        async def open(self, path: str, mode: str, **kwargs):
            del path, mode, kwargs
            return _ConflictFile()

    store = OpenDALHomeArchiveStore(operator=cast(opendal.AsyncOperator, cast(object, _ConflictOperator())))
    writer = await store.open_writer(_SNAPSHOT)
    _ = await writer.write(b"archive")

    with pytest.raises(HomeArchiveConflictError):
        await writer.close()


@pytest.mark.parametrize(
    "value",
    (
        "",
        "/home-snapshots/tenant-1/agent-1/snapshot-1.tar.zst",
        "home-snapshots/../agent-1/snapshot-1.tar.zst",
        "home-snapshots/tenant-1/agent-1/nested/snapshot-1.tar.zst",
        r"home-snapshots\\tenant-1\\agent-1\\snapshot-1.tar.zst",
        "other/tenant-1/agent-1/snapshot-1.tar.zst",
        "home-snapshots/tenant-1/agent-1/snapshot-1.tar",
    ),
)
def test_home_snapshot_ref_rejects_unsafe_object_keys(value: str) -> None:
    with pytest.raises(ValueError):
        validate_home_snapshot_ref(value)


def test_home_snapshot_ref_is_deterministic() -> None:
    spec = HomeSnapshotCreateSpec("tenant-1", "agent-1", "snapshot-1")
    assert build_home_snapshot_ref(spec) == _SNAPSHOT
    assert validate_home_snapshot_ref(_SNAPSHOT) == _SNAPSHOT
