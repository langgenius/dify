from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx2 as httpx
import pytest

from dify_agent.adapters.shell.protocols import ShellCommandResult, ShellCommandStatus, ShellExecutionMode
from dify_agent.runtime_backend import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
    BindingLostError,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateSpec,
    SharedWorkspaceUnsupportedError,
    WorkspacePreservationUnsupportedError,
)
from dify_agent.runtime_backend import openshell as openshell_module
from dify_agent.runtime_backend.errors import HomeSnapshotCreateError
from dify_agent.runtime_backend.openshell import (
    OpenShellExecutionBindingBackend,
    OpenShellHomeSnapshotBackend,
    OpenShellNotFoundError,
    OpenShellRuntimeLease,
    _SshSessionTokenSupplier,  # pyright: ignore[reportPrivateUsage]
)
from dify_agent.runtime_backend.protocols import RuntimeLayout
from dify_agent.runtime_backend.shellctl import ShellctlRuntimeLease


# The gateway caps sandbox names at 19 chars, so Binding names carry a
# sha256 digest of the Binding id; restated here independently of the
# implementation to pin the naming contract.
_BINDING_NAME = f"dify-{hashlib.sha256(b'binding-1').hexdigest()[:14]}"
_OPAQUE_TENANT = hashlib.sha256(b"tenant-1").hexdigest()[:14]
_OPAQUE_AGENT = hashlib.sha256(b"agent-1").hexdigest()[:14]
_OPAQUE_BINDING = hashlib.sha256(b"binding-1").hexdigest()[:14]
_OPAQUE_WORKSPACE = hashlib.sha256(b"workspace-1").hexdigest()[:14]
_SNAPSHOT_REF = f"{_OPAQUE_TENANT}--home-snap-1"
_TENANT_SNAPSHOT_ROOT = f"/mnt/dify-agent-shared/home-snapshots/{_OPAQUE_TENANT}"
_SNAPSHOT_DIR = f"{_TENANT_SNAPSHOT_ROOT}/home-snap-1"


@dataclass(slots=True)
class _FakeTunnel:
    base_url: str = "http://tunnel.invalid"
    closed: int = 0

    async def close(self) -> None:
        self.closed += 1


@dataclass(slots=True)
class _ControlPlane:
    created: list[tuple[str, dict[str, str]]] = field(default_factory=list)
    extra_read_write: list[tuple[str, ...]] = field(default_factory=list)
    exec_calls: list[tuple[str, str]] = field(default_factory=list)
    started: list[str] = field(default_factory=list)
    stopped: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    tunnels: list[_FakeTunnel] = field(default_factory=list)
    generation: dict[str, int] = field(default_factory=dict)
    missing: set[str] = field(default_factory=set)
    exec_results: list[tuple[int, str]] = field(default_factory=list)
    stop_error: Exception | None = None

    async def create_sandbox(
        self,
        *,
        name: str,
        labels: dict[str, str],
        extra_read_write: tuple[str, ...] = (),
    ) -> None:
        self.created.append((name, labels))
        self.extra_read_write.append(extra_read_write)
        self.generation[name] = 1

    async def wait_ready(self, name: str) -> str:
        self._require(name)
        return f"{name}-id-{self.generation[name]}"

    async def start_sandbox(self, name: str) -> None:
        self._require(name)
        self.started.append(name)
        # Ids change across stop/start cycles; acquire must re-resolve them.
        self.generation[name] += 1

    async def stop_sandbox(self, name: str) -> None:
        self._require(name)
        if self.stop_error is not None:
            raise self.stop_error
        self.stopped.append(name)

    async def delete_sandbox(self, name: str) -> None:
        self._require(name)
        self.deleted.append(name)
        self.generation.pop(name, None)

    async def exec_script(self, sandbox_id: str, script: str) -> tuple[int, str]:
        self.exec_calls.append((sandbox_id, script))
        if self.exec_results:
            return self.exec_results.pop(0)
        return (0, "")

    async def open_tunnel(self, sandbox_id: str, port: int) -> _FakeTunnel:
        del sandbox_id, port
        tunnel = _FakeTunnel()
        self.tunnels.append(tunnel)
        return tunnel

    def _require(self, name: str) -> None:
        if name in self.missing or name not in self.generation:
            raise OpenShellNotFoundError(name)


def _mock_http(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> None:
    original_async_client = httpx.AsyncClient
    transport = httpx.MockTransport(handler)

    def create_client(*args: object, **kwargs: object) -> httpx.AsyncClient:
        _ = kwargs.setdefault("transport", transport)
        return original_async_client(*args, **kwargs)

    monkeypatch.setattr(openshell_module.httpx, "AsyncClient", create_client)


def _healthy_handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/healthz":
        return httpx.Response(200, json={"status": "ok"})
    return httpx.Response(404, json={"error": {"code": "not_found", "message": "missing"}})


def _backend(control: _ControlPlane) -> OpenShellExecutionBindingBackend:
    return OpenShellExecutionBindingBackend(
        control_plane=control,
        shellctl_auth_token="shellctl-token",
    )


def _create_spec(**overrides: object) -> ExecutionBindingCreateSpec:
    values: dict[str, object] = {
        "tenant_id": "tenant-1",
        "agent_id": "agent-1",
        "binding_id": "binding-1",
        "workspace_id": "workspace-1",
        "existing_workspace_ref": None,
        "home_snapshot_ref": None,
    }
    values.update(overrides)
    return ExecutionBindingCreateSpec(**values)  # pyright: ignore[reportArgumentType]


@dataclass(slots=True)
class _RecordingCommands:
    scripts: list[str] = field(default_factory=list)
    exit_codes: list[int] = field(default_factory=list)

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
        mode: ShellExecutionMode = "pty",
    ) -> ShellCommandResult:
        del cwd, env, timeout, mode
        self.scripts.append(script)
        exit_code = self.exit_codes.pop(0) if self.exit_codes else 0
        return ShellCommandResult(
            job_id=f"job-{len(self.scripts)}",
            status="exited",
            done=True,
            exit_code=exit_code,
            output="output",
            offset=0,
            truncated=False,
        )

    async def wait(self, job_id: str, *, offset: int, timeout: float) -> ShellCommandResult:
        raise AssertionError("control commands complete on run in this fake")

    async def read_output(self, job_id: str, *, offset: int) -> ShellCommandResult:
        raise AssertionError("unused")

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float) -> ShellCommandResult:
        raise AssertionError("unused")

    async def interrupt(self, job_id: str, *, grace_seconds: float) -> ShellCommandStatus:
        raise AssertionError("unused")

    async def tail(self, job_id: str) -> ShellCommandResult:
        raise AssertionError("unused")

    async def delete(self, job_id: str, *, force: bool = False, grace_seconds: float | None = None) -> None:
        del job_id, force, grace_seconds


@dataclass(slots=True)
class _FakeShellctlClient:
    async def health(self) -> object:
        return object()

    async def close(self) -> None:
        return None


def _source_lease(commands: _RecordingCommands) -> OpenShellRuntimeLease:
    data_plane = ShellctlRuntimeLease(
        handle=_BINDING_NAME,
        layout=RuntimeLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace"),
        client=_FakeShellctlClient(),  # pyright: ignore[reportArgumentType]
        commands=commands,  # pyright: ignore[reportArgumentType]
    )
    return OpenShellRuntimeLease(tunnel=_FakeTunnel(), data_plane=data_plane)


@pytest.mark.anyio
async def test_openshell_binding_create_initializes_layout_then_stops() -> None:
    control = _ControlPlane()
    allocation = await _backend(control).create_binding(_create_spec())

    assert allocation.binding_ref == _BINDING_NAME
    assert allocation.workspace_ref == allocation.binding_ref
    (name, labels), = control.created
    assert name == _BINDING_NAME
    assert labels == {
        "dify.resource": "runtime-sandbox",
        "dify.binding": _OPAQUE_BINDING,
        "dify.workspace": _OPAQUE_WORKSPACE,
        "dify.tenant": _OPAQUE_TENANT,
        "dify.agent": _OPAQUE_AGENT,
    }
    assert control.extra_read_write == [(_TENANT_SNAPSHOT_ROOT,)]
    (sandbox_id, script), = control.exec_calls
    assert sandbox_id == f"{_BINDING_NAME}-id-1"
    assert "rm -rf -- /home/dify/workspace" in script
    assert "mkdir -p /home/dify/workspace" in script
    assert "cp -a" not in script
    assert control.stopped == [_BINDING_NAME]
    assert control.deleted == []


@pytest.mark.anyio
async def test_openshell_binding_create_materializes_snapshot_without_fallback() -> None:
    control = _ControlPlane()
    _ = await _backend(control).create_binding(_create_spec(home_snapshot_ref=_SNAPSHOT_REF))

    (_, script), = control.exec_calls
    lines = script.splitlines()
    snapshot_dir = _SNAPSHOT_DIR
    # The snapshot existence check must precede the copy: missing snapshots
    # fail the whole create instead of falling back to a default Home.
    assert lines.index(f"test -d {snapshot_dir}") < lines.index(f"cp -a {snapshot_dir}/. /home/dify/")
    assert "rm -rf -- /home/dify/.local/share/shellctl" in lines


@pytest.mark.anyio
async def test_openshell_binding_create_rejects_shared_workspace() -> None:
    control = _ControlPlane()
    with pytest.raises(SharedWorkspaceUnsupportedError):
        _ = await _backend(control).create_binding(_create_spec(existing_workspace_ref="workspace-1"))
    assert control.created == []


@pytest.mark.anyio
async def test_openshell_binding_create_deletes_sandbox_when_initialization_fails() -> None:
    control = _ControlPlane()
    control.exec_results = [(1, "boom")]
    with pytest.raises(BindingCreateError, match="boom"):
        _ = await _backend(control).create_binding(_create_spec())
    assert control.deleted == [_BINDING_NAME]


@pytest.mark.anyio
async def test_openshell_acquire_bootstraps_shellctl_and_opens_tunnel(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_http(monkeypatch, _healthy_handler)
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())

    lease = await backend.acquire(_BINDING_NAME)

    assert isinstance(lease, OpenShellRuntimeLease)
    assert control.started == [_BINDING_NAME]
    # start bumps the sandbox generation; the bootstrap must target the new id.
    bootstrap_sandbox_id, bootstrap = control.exec_calls[-1]
    assert bootstrap_sandbox_id == f"{_BINDING_NAME}-id-2"
    assert "shellctl serve --listen 127.0.0.1:5004" in bootstrap
    assert "SHELLCTL_AUTH_TOKEN=shellctl-token" in bootstrap
    assert "SHELLCTL_ENABLE_PATH_ISOLATION=false" in bootstrap
    assert len(control.tunnels) == 1
    assert lease.layout.home_dir == "/home/dify"

    await backend.release(lease)
    assert control.tunnels[0].closed == 1
    assert control.stopped == [_BINDING_NAME, _BINDING_NAME]


@pytest.mark.anyio
async def test_openshell_acquire_maps_missing_sandbox_to_binding_lost() -> None:
    control = _ControlPlane()
    with pytest.raises(BindingLostError):
        _ = await _backend(control).acquire("dify-binding-9")


@pytest.mark.anyio
async def test_openshell_acquire_cleans_up_when_bootstrap_fails() -> None:
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())
    control.exec_results = [(0, ""), (1, "no shellctl")]

    with pytest.raises(BindingAcquireError, match="no shellctl"):
        _ = await backend.acquire(_BINDING_NAME)
    # Sandbox is stopped again after the failed acquisition; no tunnel leaks.
    assert control.stopped == [_BINDING_NAME, _BINDING_NAME]
    assert control.tunnels == []


@pytest.mark.anyio
async def test_openshell_release_rejects_foreign_lease() -> None:
    control = _ControlPlane()
    with pytest.raises(TypeError):
        await _backend(control).release(
            _source_lease(_RecordingCommands()).data_plane,
        )


@pytest.mark.anyio
async def test_openshell_destroy_requires_workspace_destruction_and_is_idempotent() -> None:
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())

    with pytest.raises(WorkspacePreservationUnsupportedError):
        await backend.destroy_binding(
            ExecutionBindingDestroySpec(
                binding_ref=_BINDING_NAME,
                destroy_workspace=False,
            )
        )
    with pytest.raises(BindingDestroyError):
        await backend.destroy_binding(
            ExecutionBindingDestroySpec(
                binding_ref=_BINDING_NAME,
                destroy_workspace=True,
                workspace_ref="dify-other",
            )
        )

    await backend.destroy_binding(
        ExecutionBindingDestroySpec(
            binding_ref=_BINDING_NAME,
            destroy_workspace=True,
            workspace_ref=_BINDING_NAME,
        )
    )
    # A second destroy observes NOT_FOUND and returns without raising.
    await backend.destroy_binding(
        ExecutionBindingDestroySpec(
            binding_ref=_BINDING_NAME,
            destroy_workspace=True,
            workspace_ref=_BINDING_NAME,
        )
    )
    assert control.deleted == [_BINDING_NAME]


@pytest.mark.anyio
async def test_openshell_snapshot_copies_home_to_shared_volume() -> None:
    commands = _RecordingCommands()
    snapshots = OpenShellHomeSnapshotBackend(control_plane=_ControlPlane())

    snapshot_ref = await snapshots.create_from_runtime(
        spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="snap-1"),
        source=_source_lease(commands),
    )

    assert snapshot_ref == _SNAPSHOT_REF
    (script,) = commands.scripts
    assert f"cp -a /home/dify/. {_SNAPSHOT_DIR}/" in script
    assert f"chmod 700 {_SNAPSHOT_DIR}" in script


@pytest.mark.anyio
async def test_openshell_snapshot_failure_removes_partial_copy() -> None:
    commands = _RecordingCommands(exit_codes=[1])
    snapshots = OpenShellHomeSnapshotBackend(control_plane=_ControlPlane())

    with pytest.raises(HomeSnapshotCreateError):
        _ = await snapshots.create_from_runtime(
            spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="snap-1"),
            source=_source_lease(commands),
        )

    assert len(commands.scripts) == 2
    assert commands.scripts[1].startswith("rm -rf -- ")


@pytest.mark.anyio
async def test_openshell_snapshot_rejects_foreign_lease() -> None:
    snapshots = OpenShellHomeSnapshotBackend(control_plane=_ControlPlane())
    foreign = _source_lease(_RecordingCommands()).data_plane
    with pytest.raises(HomeSnapshotCreateError):
        _ = await snapshots.create_from_runtime(
            spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="snap-1"),
            source=foreign,
        )


@pytest.mark.anyio
async def test_openshell_snapshot_delete_uses_short_lived_maintenance_sandbox() -> None:
    control = _ControlPlane()
    snapshots = OpenShellHomeSnapshotBackend(control_plane=control)

    await snapshots.delete(_SNAPSHOT_REF)

    (name, labels), = control.created
    assert name.startswith("gc-")
    assert labels == {"dify.resource": "snapshot-gc"}
    # Unlinking the snapshot dir itself needs write on its parent under
    # Landlock, so the sandbox is granted the tenant's snapshot root.
    assert control.extra_read_write == [(_TENANT_SNAPSHOT_ROOT,)]
    (_, script), = control.exec_calls
    assert script == f"rm -rf -- {_SNAPSHOT_DIR}"
    assert control.deleted == [name]


@pytest.mark.anyio
async def test_openshell_snapshot_delete_still_removes_maintenance_sandbox_on_failure() -> None:
    control = _ControlPlane()
    control.exec_results = [(1, "device busy")]
    snapshots = OpenShellHomeSnapshotBackend(control_plane=control)

    with pytest.raises(BindingDestroyError, match="device busy"):
        await snapshots.delete(_SNAPSHOT_REF)
    assert len(control.deleted) == 1


@pytest.mark.anyio
async def test_openshell_snapshot_refs_must_be_safe_path_segments() -> None:
    snapshots = OpenShellHomeSnapshotBackend(control_plane=_ControlPlane())
    with pytest.raises(BindingDestroyError, match="safe path segment"):
        await snapshots.delete("../escape")


@pytest.mark.anyio
async def test_openshell_binding_create_rejects_unsafe_binding_id() -> None:
    control = _ControlPlane()
    with pytest.raises(BindingCreateError, match="safe path segment"):
        _ = await _backend(control).create_binding(_create_spec(binding_id="../escape"))
    assert control.created == []


@pytest.mark.anyio
async def test_openshell_acquire_maps_missing_layout_to_binding_lost(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_http(monkeypatch, _healthy_handler)
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())
    control.exec_results = [(1, "missing home")]

    with pytest.raises(BindingLostError, match="Home or Workspace"):
        _ = await backend.acquire(_BINDING_NAME)
    assert control.tunnels == []
    assert control.stopped == [_BINDING_NAME, _BINDING_NAME]


def test_ssh_session_token_supplier_renews_ahead_of_expiry() -> None:
    minted: list[str] = []
    clock = {"now": 0}

    def mint() -> tuple[str, int]:
        token = f"token-{len(minted)}"
        minted.append(token)
        # every token expires 100_000 ms after it is minted
        return token, clock["now"] + 100_000

    supplier = _SshSessionTokenSupplier(mint=mint, clock_ms=lambda: clock["now"], renewal_margin_ms=60_000)

    assert supplier() == "token-0"
    clock["now"] = 30_000
    assert supplier() == "token-0"  # well before the renewal window
    clock["now"] = 45_000
    assert supplier() == "token-1"  # inside expiry - margin: re-minted
    clock["now"] = 50_000
    assert supplier() == "token-1"  # new token still fresh
    assert minted == ["token-0", "token-1"]


def test_ssh_session_token_supplier_keeps_token_without_expiry() -> None:
    minted: list[str] = []

    def mint() -> tuple[str, int]:
        minted.append("x")
        return "token", 0  # gateway set no expiry

    supplier = _SshSessionTokenSupplier(mint=mint, clock_ms=lambda: 10**15)
    assert supplier() == "token"
    assert supplier() == "token"
    assert len(minted) == 1


def test_ssh_session_token_supplier_fails_closed_when_renewal_fails() -> None:
    clock = {"now": 0}
    fail = {"on": False}

    def mint() -> tuple[str, int]:
        if fail["on"]:
            raise RuntimeError("gateway unavailable")
        return "token-0", 100_000

    supplier = _SshSessionTokenSupplier(mint=mint, clock_ms=lambda: clock["now"], renewal_margin_ms=60_000)
    assert supplier() == "token-0"

    fail["on"] = True
    clock["now"] = 45_000
    with pytest.raises(RuntimeError, match="gateway unavailable"):
        _ = supplier()


@pytest.mark.anyio
async def test_openshell_sdk_exec_script_sends_script_via_stdin_not_argv() -> None:
    # The fake pins the adapter's own outgoing call shape (a security
    # contract: no script text in argv), not gateway behavior — the real
    # gateway is exercised by the integration contract in
    # tests/integration/.../test_working_environment.py.
    from types import SimpleNamespace
    from typing import cast

    from dify_agent.runtime_backend.openshell import OpenShellSDKControlPlane

    calls: dict[str, object] = {}

    class _FakeSdkClient:
        def exec(
            self,
            sandbox_id: str,
            command: list[str],
            *,
            stdin: bytes | None = None,
            timeout_seconds: int | None = None,
        ) -> SimpleNamespace:
            calls["sandbox_id"] = sandbox_id
            calls["command"] = list(command)
            calls["stdin"] = stdin
            calls["timeout_seconds"] = timeout_seconds
            return SimpleNamespace(exit_code=3, stdout="out", stderr="err")

    plane = OpenShellSDKControlPlane(endpoint="localhost:1", insecure=True)
    plane._client_cache = cast(  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
        "openshell_module.SandboxClient", cast(object, _FakeSdkClient())
    )
    script = "set -eu\nexport SHELLCTL_AUTH_TOKEN=super-secret\n"

    exit_code, output = await plane.exec_script("sb-1", script)

    assert exit_code == 3
    assert output == "outerr"
    assert calls["sandbox_id"] == "sb-1"
    # The gateway logs a preview of the assembled exec argv; scripts can embed
    # the shellctl token, so they must travel only via stdin (never logged).
    assert calls["command"] == ["/bin/sh", "-s"]
    assert calls["stdin"] == script.encode()
    assert calls["timeout_seconds"] == plane.exec_timeout_seconds


@pytest.mark.anyio
async def test_openshell_sdk_create_sends_enforced_egress_allowlist() -> None:
    # The fake pins the adapter's own outgoing create-spec shape: opt-in
    # egress_allow becomes one enforced allowlist rule per endpoint, and an
    # empty egress_allow sends no network policy at all so sandbox egress
    # stays on the gateway/driver default. Real gateway enforcement is
    # covered by the opt-in integration contract.
    from types import SimpleNamespace
    from typing import cast

    from dify_agent.runtime_backend.openshell import OpenShellSDKControlPlane

    specs: list[object] = []

    class _FakeSdkClient:
        def create(
            self,
            *,
            workspace: str,
            spec: object,
            name: str,
            labels: dict[str, str],
        ) -> SimpleNamespace:
            specs.append(spec)
            return SimpleNamespace(id="sb-1")

    def plane_with(egress_allow: tuple[tuple[str, int], ...]) -> OpenShellSDKControlPlane:
        plane = OpenShellSDKControlPlane(endpoint="localhost:1", insecure=True, egress_allow=egress_allow)
        plane._client_cache = cast(  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
            "openshell_module.SandboxClient", cast(object, _FakeSdkClient())
        )
        return plane

    allowing = plane_with((("agent.example.com", 5050), ("dify.example.com", 443)))
    await allowing.create_sandbox(name="dify-a", labels={})

    policies = specs[0].policy.network_policies  # pyright: ignore[reportAttributeAccessIssue]
    assert len(policies) == 2
    by_endpoint = {
        (rule.endpoints[0].host, rule.endpoints[0].port): (key, rule) for key, rule in policies.items()
    }
    assert set(by_endpoint) == {("agent.example.com", 5050), ("dify.example.com", 443)}
    for key, rule in by_endpoint.values():
        assert rule.name == key
        endpoint = rule.endpoints[0]
        assert endpoint.protocol == "rest"
        assert endpoint.enforcement == "enforce"
        assert endpoint.rules[0].allow.method == "*"
        assert endpoint.rules[0].allow.path == "/**"
        # Endpoints are the allowlist; any in-sandbox binary may connect.
        assert [binary.path for binary in rule.binaries] == ["/**"]

    default = plane_with(())
    await default.create_sandbox(name="dify-b", labels={})

    assert not specs[1].policy.network_policies  # pyright: ignore[reportAttributeAccessIssue]
