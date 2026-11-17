from __future__ import annotations

import asyncio
import hashlib
import hmac
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import cast

import grpc
import httpx2 as httpx
import pytest
from httpx2 import AsyncClient

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
from dify_agent.runtime_backend.noop import NoopHomeSnapshotBackend
from dify_agent.runtime_backend.openshell import (
    OpenShellExecutionBindingBackend,
    OpenShellNotFoundError,
    OpenShellRuntimeLease,
)
from dify_agent.runtime_backend.protocols import RuntimeLayout
from dify_agent.runtime_backend.shellctl import ShellctlRuntimeLease


# The gateway caps sandbox names at 19 chars, so Binding names carry a
# sha256 digest of the Binding id; restated here independently of the
# implementation to pin the naming contract.
_BINDING_NAME = f"dify-{hashlib.sha256(b'binding-1').hexdigest()[:14]}"
_BINDING_NAME_2 = f"dify-{hashlib.sha256(b'binding-2').hexdigest()[:14]}"
_SHELLCTL_MASTER = "shellctl-token"
_SHELLCTL_TOKEN = "14a48efcf8bbf86f7634183598653f071c2ea87f132d52f987d012bed5548551"
_OPAQUE_TENANT = hashlib.sha256(b"tenant-1").hexdigest()[:14]
_OPAQUE_AGENT = hashlib.sha256(b"agent-1").hexdigest()[:14]
_OPAQUE_BINDING = hashlib.sha256(b"binding-1").hexdigest()[:14]
_OPAQUE_WORKSPACE = hashlib.sha256(b"workspace-1").hexdigest()[:14]
_SNAPSHOT_REF = f"{_OPAQUE_TENANT}--home-snap-1"


@dataclass(slots=True)
class _ControlPlane:
    created: list[tuple[str, dict[str, str]]] = field(default_factory=list)
    exec_calls: list[tuple[str, str]] = field(default_factory=list)
    started: list[str] = field(default_factory=list)
    stopped: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    exposed: list[tuple[str, int]] = field(default_factory=list)
    service_url: str = "http://dify-test--shellctl.openshell.localhost:17670/"
    expose_error: BaseException | None = None
    ready_names: dict[str, str] = field(default_factory=dict)
    generation: dict[str, int] = field(default_factory=dict)
    missing: set[str] = field(default_factory=set)
    exec_results: list[tuple[int, str]] = field(default_factory=list)
    stop_error: Exception | None = None
    service_clients: list[httpx.AsyncClient] = field(default_factory=list)

    async def create_sandbox(
        self,
        *,
        name: str,
        labels: dict[str, str],
    ) -> None:
        self.created.append((name, labels))
        self.generation[name] = 1

    async def wait_ready(self, name: str) -> str:
        self._require(name)
        # Sandbox ids churn across restarts; exec and exposure address the
        # sandbox by its stable canonical name.
        return self.ready_names.get(name, name)

    async def start_sandbox(self, name: str) -> None:
        self._require(name)
        self.started.append(name)
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

    async def exec_script(self, sandbox_name: str, script: str) -> tuple[int, str]:
        self.exec_calls.append((sandbox_name, script))
        if self.exec_results:
            return self.exec_results.pop(0)
        return (0, "")

    async def expose_service(self, name: str, port: int) -> str:
        self._require(name)
        if self.expose_error is not None:
            raise self.expose_error
        self.exposed.append((name, port))
        return self.service_url

    def create_service_http_client(self, base_url: str) -> httpx.AsyncClient:
        # Going through the module attribute lets _mock_http inject its
        # MockTransport, matching how the SDK plane builds the real client.
        # The deployment gateway credential never leaves the gRPC control
        # plane, so the service client starts with no auth headers; the
        # shellctl bearer is attached per request by the shellctl SDK.
        client = openshell_module.httpx.AsyncClient(
            base_url=base_url,
            follow_redirects=False,
            trust_env=False,
            timeout=httpx.Timeout(60.0),
        )
        self.service_clients.append(client)
        return client

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
        shellctl_auth_token=_SHELLCTL_MASTER,
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
    closed: int = 0
    close_error: BaseException | None = None

    async def health(self) -> object:
        return object()

    async def close(self) -> None:
        self.closed += 1
        if self.close_error is not None:
            raise self.close_error


def _source_lease(commands: _RecordingCommands) -> OpenShellRuntimeLease:
    data_plane = ShellctlRuntimeLease(
        handle=_BINDING_NAME,
        layout=RuntimeLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace"),
        client=_FakeShellctlClient(),  # pyright: ignore[reportArgumentType]
        commands=commands,  # pyright: ignore[reportArgumentType]
    )
    return OpenShellRuntimeLease(data_plane=data_plane)


@pytest.mark.anyio
async def test_openshell_binding_create_initializes_layout_then_stops() -> None:
    control = _ControlPlane()
    allocation = await _backend(control).create_binding(_create_spec())

    assert allocation.binding_ref == _BINDING_NAME
    assert allocation.workspace_ref == allocation.binding_ref
    ((name, labels),) = control.created
    assert name == _BINDING_NAME
    assert labels == {
        "dify.resource": "runtime-sandbox",
        "dify.binding": _OPAQUE_BINDING,
        "dify.workspace": _OPAQUE_WORKSPACE,
        "dify.tenant": _OPAQUE_TENANT,
        "dify.agent": _OPAQUE_AGENT,
    }
    ((exec_name, script),) = control.exec_calls
    assert exec_name == _BINDING_NAME
    assert "rm -rf -- /home/dify/workspace" in script
    assert "mkdir -p /home/dify/workspace" in script
    assert "cp -a" not in script
    assert control.stopped == [_BINDING_NAME]
    assert control.deleted == []


@pytest.mark.anyio
async def test_openshell_binding_create_ignores_supplied_snapshot_ref() -> None:
    # The backend has no snapshot capability: a supplied ref must produce an
    # image-fresh Home — no copy step, no maintenance sandbox, no extra grants.
    control = _ControlPlane()
    _ = await _backend(control).create_binding(_create_spec(home_snapshot_ref=_SNAPSHOT_REF))

    ((_, script),) = control.exec_calls
    assert "cp -a" not in script
    assert "test -d" not in script
    assert control.created[0][0] == _BINDING_NAME


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
async def test_openshell_acquire_bootstraps_shellctl_and_exposes_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_http(monkeypatch, _healthy_handler)
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())

    lease = await backend.acquire(_BINDING_NAME)

    assert isinstance(lease, OpenShellRuntimeLease)
    assert control.started == [_BINDING_NAME]
    # Exec addresses the sandbox by its stable canonical name.
    bootstrap_name, bootstrap = control.exec_calls[-1]
    assert bootstrap_name == _BINDING_NAME
    assert "shellctl serve --listen 127.0.0.1:5004" in bootstrap
    assert f"SHELLCTL_AUTH_TOKEN={_SHELLCTL_TOKEN}" in bootstrap
    assert _SHELLCTL_MASTER not in bootstrap
    assert "SHELLCTL_ENABLE_PATH_ISOLATION=false" in bootstrap
    # Exposure is keyed by the stable sandbox name, not the changing id.
    assert control.exposed == [(_BINDING_NAME, 5004)]
    assert lease.layout.home_dir == "/home/dify"

    await backend.release(lease)
    assert isinstance(lease.data_plane.owned_transport, AsyncClient)
    assert lease.data_plane.owned_transport.is_closed
    assert control.stopped == [_BINDING_NAME]


@pytest.mark.anyio
async def test_openshell_data_plane_sends_shellctl_bearer_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen_headers: list[httpx.Headers] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.append(request.headers)
        if request.url.path.startswith("/v1/jobs/"):
            return httpx.Response(
                200,
                json={
                    "job_id": "job-1",
                    "status": "running",
                    "done": False,
                    "created_at": "2026-01-01T00:00:00Z",
                    "offset": 0,
                },
            )
        return _healthy_handler(request)

    _mock_http(monkeypatch, handler)
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())

    lease = await backend.acquire(_BINDING_NAME)

    assert isinstance(lease, OpenShellRuntimeLease)
    # /healthz is unauthenticated; an authenticated endpoint proves the SDK
    # attaches the shellctl bearer. Bearer passthrough means Authorization
    # reaches shellctl unchanged, so it must carry the shellctl token — never
    # the deployment gateway credential (a gRPC control-plane credential) or
    # a custom header.
    _ = await lease.data_plane.client.status("job-1")
    authed = [headers for headers in seen_headers if "authorization" in headers]
    assert authed
    for headers in authed:
        assert headers["authorization"] == f"Bearer {_SHELLCTL_TOKEN}"
        assert "x-shellctl-token" not in headers
    await backend.release(lease)


def _exported_token(script: str) -> str:
    line = next(line for line in script.splitlines() if "SHELLCTL_AUTH_TOKEN" in line)
    return line.split("=", 1)[1]


def _expected_token(master: str, sandbox_name: str) -> str:
    return hmac.new(
        master.encode(),
        f"dify-agent/openshell/shellctl/v1:{sandbox_name}".encode(),
        hashlib.sha256,
    ).hexdigest()


@pytest.mark.anyio
async def test_openshell_shellctl_token_stable_across_leases_and_backends(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_http(monkeypatch, _healthy_handler)
    control = _ControlPlane()
    first_backend = _backend(control)
    _ = await first_backend.create_binding(_create_spec())

    first = await first_backend.acquire(_BINDING_NAME)
    await first_backend.release(first)
    second = await first_backend.acquire(_BINDING_NAME)
    await first_backend.release(second)

    other_backend = _backend(control)
    third = await other_backend.acquire(_BINDING_NAME)
    await other_backend.release(third)

    tokens = [_exported_token(script) for _, script in control.exec_calls if "SHELLCTL_AUTH_TOKEN" in script]
    assert tokens == [_SHELLCTL_TOKEN] * 3


@pytest.mark.anyio
async def test_openshell_shellctl_token_depends_on_canonical_sandbox_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_http(monkeypatch, _healthy_handler)
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())
    _ = await backend.create_binding(_create_spec(binding_id="binding-2", workspace_id="workspace-2"))

    control.ready_names[_BINDING_NAME_2] = "dify-canonical2"
    first = await backend.acquire(_BINDING_NAME)
    second = await backend.acquire(_BINDING_NAME_2)
    try:
        tokens = [_exported_token(script) for _, script in control.exec_calls if "SHELLCTL_AUTH_TOKEN" in script]
        assert tokens == [
            _SHELLCTL_TOKEN,
            _expected_token(_SHELLCTL_MASTER, "dify-canonical2"),
        ]
        assert tokens[0] != tokens[1]
    finally:
        await backend.release(first)
        await backend.release(second)


@pytest.mark.anyio
async def test_openshell_shellctl_token_changes_with_master(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_http(monkeypatch, _healthy_handler)
    control = _ControlPlane()
    backend = _backend(control)
    rotated = OpenShellExecutionBindingBackend(
        control_plane=control,
        shellctl_auth_token="rotated-master",
    )
    _ = await backend.create_binding(_create_spec())

    lease = await backend.acquire(_BINDING_NAME)
    await backend.release(lease)
    rotated_lease = await rotated.acquire(_BINDING_NAME)
    await rotated.release(rotated_lease)

    tokens = [_exported_token(script) for _, script in control.exec_calls if "SHELLCTL_AUTH_TOKEN" in script]
    assert tokens == [_SHELLCTL_TOKEN, _expected_token("rotated-master", _BINDING_NAME)]
    assert tokens[0] != tokens[1]


@pytest.mark.anyio
async def test_openshell_distinct_bindings_reject_cross_sandbox_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from shellctl.client import ShellctlClient, ShellctlClientError

    token_b = _expected_token(_SHELLCTL_MASTER, _BINDING_NAME_2)
    url_a = "http://svc-a.openshell.localhost:17670/"
    url_b = "http://svc-b.openshell.localhost:17670/"
    expected_by_host = {
        "svc-a.openshell.localhost": _SHELLCTL_TOKEN,
        "svc-b.openshell.localhost": token_b,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/jobs/probe":
            if request.headers.get("authorization") == f"Bearer {expected_by_host[request.url.host]}":
                return httpx.Response(
                    200,
                    json={
                        "job_id": "probe",
                        "status": "running",
                        "done": False,
                        "created_at": "2026-01-01T00:00:00Z",
                        "offset": 0,
                    },
                )
            return httpx.Response(
                401,
                json={"error": {"code": "unauthorized", "message": "invalid token"}},
            )
        return _healthy_handler(request)

    _mock_http(monkeypatch, handler)
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())
    _ = await backend.create_binding(_create_spec(binding_id="binding-2", workspace_id="workspace-2"))

    control.service_url = url_a
    lease_a = await backend.acquire(_BINDING_NAME)
    control.service_url = url_b
    lease_b = await backend.acquire(_BINDING_NAME_2)
    assert isinstance(lease_a, OpenShellRuntimeLease)
    assert isinstance(lease_b, OpenShellRuntimeLease)
    try:
        assert isinstance(lease_a.data_plane.client, ShellctlClient)
        assert isinstance(lease_b.data_plane.client, ShellctlClient)
        _ = await lease_a.data_plane.client.status("probe")
        _ = await lease_b.data_plane.client.status("probe")

        foreign_transport = control.create_service_http_client(url_b)
        foreign_client = ShellctlClient(url_b, token=_SHELLCTL_TOKEN, client=foreign_transport)
        try:
            with pytest.raises(ShellctlClientError) as exc_info:
                _ = await foreign_client.status("probe")
            assert exc_info.value.status_code == 401
        finally:
            await foreign_client.close()
            await foreign_transport.aclose()
    finally:
        await backend.release(lease_a)
        await backend.release(lease_b)


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
    # A failed acquisition leaves the shared sandbox running; no data plane leaks.
    assert control.stopped == [_BINDING_NAME]
    assert control.exposed == []


@pytest.mark.anyio
async def test_openshell_acquire_leaves_sandbox_running_when_expose_fails() -> None:
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())
    control.expose_error = RuntimeError("service store unavailable")

    with pytest.raises(BindingAcquireError, match="service store unavailable"):
        _ = await backend.acquire(_BINDING_NAME)
    assert control.stopped == [_BINDING_NAME]
    assert control.exposed == []


@pytest.mark.anyio
async def test_openshell_failed_acquire_refresh_does_not_interrupt_running_lease(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output_path = "/tmp/job-1/output"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/v1/jobs/run":
            return httpx.Response(
                200,
                json={
                    "job_id": "job-1",
                    "status": "running",
                    "done": False,
                    "exit_code": None,
                    "output_path": output_path,
                    "output": "",
                    "offset": 0,
                    "truncated": False,
                },
            )
        if request.method == "POST" and request.url.path == "/v1/jobs/job-1/wait":
            if len(control.stopped) > 1:
                return httpx.Response(
                    500,
                    json={"error": {"code": "job_lost", "message": "sandbox stopped"}},
                )
            return httpx.Response(
                200,
                json={
                    "job_id": "job-1",
                    "status": "exited",
                    "done": True,
                    "exit_code": 0,
                    "output_path": output_path,
                    "output": "done",
                    "offset": 4,
                    "truncated": False,
                },
            )
        return _healthy_handler(request)

    _mock_http(monkeypatch, handler)
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())
    first = await backend.acquire(_BINDING_NAME)
    try:
        assert isinstance(first, OpenShellRuntimeLease)
        started = await first.commands.run("sleep 30; printf done", timeout=0.01, mode="stdio")
        assert not started.done

        control.expose_error = RuntimeError("service store unavailable")
        with pytest.raises(BindingAcquireError, match="service store unavailable"):
            _ = await backend.acquire(_BINDING_NAME)

        assert control.stopped == [_BINDING_NAME]
        assert control.deleted == []
        assert control.exposed == [(_BINDING_NAME, 5004)]
        assert isinstance(first.data_plane.owned_transport, AsyncClient)
        assert not first.data_plane.owned_transport.is_closed

        finished = await first.commands.wait(started.job_id, offset=0, timeout=0.01)
        assert finished.done
        assert finished.exit_code == 0
        assert finished.output == "done"
        assert finished.offset == 4
    finally:
        await backend.release(first)

    assert isinstance(first.data_plane.owned_transport, AsyncClient)
    assert first.data_plane.owned_transport.is_closed


@pytest.mark.anyio
async def test_openshell_failed_acquire_closes_attempt_transport_when_readiness_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/healthz":
            return httpx.Response(
                401,
                json={"error": {"code": "unauthorized", "message": "invalid token"}},
            )
        return _healthy_handler(request)

    _mock_http(monkeypatch, handler)
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())

    with pytest.raises(BindingAcquireError):
        _ = await backend.acquire(_BINDING_NAME)

    assert len(control.service_clients) == 1
    assert control.service_clients[0].is_closed
    assert control.stopped == [_BINDING_NAME]
    assert control.deleted == []


@pytest.mark.anyio
async def test_openshell_release_leaves_other_leases_open(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_http(monkeypatch, _healthy_handler)
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())
    first = await backend.acquire(_BINDING_NAME)
    second = await backend.acquire(_BINDING_NAME)
    assert isinstance(second, OpenShellRuntimeLease)
    # Each acquire refreshes the shared name-keyed endpoint; the fake records
    # one call per acquire.
    assert control.exposed == [(_BINDING_NAME, 5004), (_BINDING_NAME, 5004)]

    await backend.release(first)

    assert control.stopped == [_BINDING_NAME]
    assert isinstance(first.data_plane.owned_transport, AsyncClient)
    assert first.data_plane.owned_transport.is_closed
    assert isinstance(second.data_plane.owned_transport, AsyncClient)
    assert not second.data_plane.owned_transport.is_closed
    await second.data_plane.client.health()
    await backend.release(second)
    assert second.data_plane.owned_transport.is_closed
    assert control.stopped == [_BINDING_NAME]
    assert control.deleted == []


@pytest.mark.anyio
async def test_openshell_release_does_not_require_existing_sandbox(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_http(monkeypatch, _healthy_handler)
    control = _ControlPlane()
    backend = _backend(control)
    _ = await backend.create_binding(_create_spec())
    lease = await backend.acquire(_BINDING_NAME)
    assert isinstance(lease, OpenShellRuntimeLease)
    control.missing.add(_BINDING_NAME)

    await backend.release(lease)

    assert isinstance(lease.data_plane.owned_transport, AsyncClient)
    assert lease.data_plane.owned_transport.is_closed
    assert control.stopped == [_BINDING_NAME]
    # Release never deletes the shared exposed endpoint or the sandbox.
    assert control.deleted == []


@pytest.mark.anyio
async def test_openshell_release_closes_transport_on_client_error() -> None:
    control = _ControlPlane()
    lease = _source_lease(_RecordingCommands())
    client = lease.data_plane.client
    assert isinstance(client, _FakeShellctlClient)
    transport = httpx.AsyncClient(transport=httpx.MockTransport(_healthy_handler))
    lease.data_plane.owned_transport = transport
    client.close_error = RuntimeError("client close failed")

    with pytest.raises(BindingAcquireError, match="client close failed") as exc_info:
        await _backend(control).release(lease)

    assert exc_info.value.__cause__ is client.close_error
    assert client.closed == 1
    assert transport.is_closed
    assert control.stopped == []


@pytest.mark.anyio
async def test_openshell_release_preserves_cancellation_and_closes_transport() -> None:
    control = _ControlPlane()
    lease = _source_lease(_RecordingCommands())
    client = lease.data_plane.client
    assert isinstance(client, _FakeShellctlClient)
    transport = httpx.AsyncClient(transport=httpx.MockTransport(_healthy_handler))
    lease.data_plane.owned_transport = transport
    cancellation = asyncio.CancelledError()
    client.close_error = cancellation

    with pytest.raises(asyncio.CancelledError) as exc_info:
        await _backend(control).release(lease)

    assert exc_info.value is cancellation
    assert client.closed == 1
    assert transport.is_closed
    assert control.stopped == []


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
async def test_noop_home_snapshot_backend_reports_unsupported() -> None:
    # The OpenShell profile wires NoopHomeSnapshotBackend: create returns the
    # explicit "no snapshot captured" result and delete is a no-op, both with
    # no command I/O against the lease.
    commands = _RecordingCommands()
    snapshots = NoopHomeSnapshotBackend()

    assert (
        await snapshots.create_from_runtime(
            spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="snap-1"),
            source=_source_lease(commands),
        )
        is None
    )
    await snapshots.delete(_SNAPSHOT_REF)
    assert commands.scripts == []


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
    assert control.exposed == []
    assert control.stopped == [_BINDING_NAME]


class _FakeRpcError(grpc.RpcError, grpc.Call):
    """Stands in for a failed stub call at the SDK boundary.

    ``isinstance(exc, grpc.Call)`` gates ``code()`` reads in the adapter, so
    the fake must be both ``grpc.RpcError`` and ``grpc.Call`` like real call
    errors.
    """

    def __init__(self, code: grpc.StatusCode) -> None:
        super().__init__(f"rpc failed: {code}")
        self._code = code

    def code(self) -> grpc.StatusCode:
        return self._code

    def trailing_metadata(self) -> tuple[()]:
        # openshell.GatewayError decodes rich status from trailing metadata.
        return ()


def _sdk_plane_with_stub(stub: object, **kwargs: object) -> "openshell_module.OpenShellSDKControlPlane":
    from openshell import SandboxClient
    from openshell._proto import openshell_pb2_grpc

    plane = openshell_module.OpenShellSDKControlPlane(endpoint="localhost:1", insecure=True, **kwargs)
    client = SandboxClient("localhost:1")
    client.close()
    client._stub = cast("openshell_pb2_grpc.OpenShellStub", stub)  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    plane._client_cache = client  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    return plane


def _expose_response(
    url: str = "http://dify-a--shellctl.openshell.localhost:17670/",
    *,
    authorization_mode: object = "passthrough",
) -> object:
    from openshell._proto import openshell_pb2

    if authorization_mode == "passthrough":
        mode = openshell_pb2.SERVICE_AUTHORIZATION_MODE_BEARER_PASSTHROUGH
    else:
        mode = cast("openshell_pb2.ServiceAuthorizationMode", authorization_mode)
    return openshell_pb2.ServiceEndpointResponse(
        endpoint=openshell_pb2.ServiceEndpoint(authorization_mode=mode),
        url=url,
    )


@pytest.mark.anyio
async def test_openshell_sdk_expose_service_request_shape() -> None:
    # The fake pins the adapter's outgoing ExposeService call shape on the real
    # generated message: the endpoint is upserted by sandbox *name* (ids churn
    # across restarts) under the fixed "shellctl" service name, with a routed
    # domain URL, the deployment workspace, and bearer passthrough so the
    # shellctl token reaches the sandbox on Authorization.
    from openshell._proto import openshell_pb2

    calls: list[dict[str, object]] = []

    class _Stub:
        def ExposeService(self, request: object, timeout: float | None = None) -> object:
            calls.append({"request": request, "timeout": timeout})
            return _expose_response()

    plane = _sdk_plane_with_stub(_Stub(), workspace="tenant-a")
    url = await plane.expose_service("dify-a", 5004)

    assert url == "http://dify-a--shellctl.openshell.localhost:17670/"
    (call,) = calls
    request = call["request"]
    assert isinstance(request, openshell_pb2.ExposeServiceRequest)
    assert request.sandbox == "dify-a"
    assert request.name == "shellctl"
    assert request.target_port == 5004
    assert request.workspace_scope.workspace == "tenant-a"
    assert request.domain is True
    assert request.authorization_mode == openshell_pb2.SERVICE_AUTHORIZATION_MODE_BEARER_PASSTHROUGH
    assert call["timeout"] == 30.0


@pytest.mark.anyio
@pytest.mark.parametrize(
    "bad_url",
    [
        "",
        "   ",
        "not-a-url",
        "ftp://dify-a--shellctl.openshell.localhost:17670/",
        "http:///missing-host",
        "http://user:pw@dify-a--shellctl.openshell.localhost:17670/",
        "http://dify-a--shellctl.openshell.localhost:17670/subpath",
        "http://dify-a--shellctl.openshell.localhost:17670/?q=1",
        "http://dify-a--shellctl.openshell.localhost:17670/#frag",
    ],
)
async def test_openshell_sdk_expose_service_rejects_malformed_urls(bad_url: str) -> None:
    class _Stub:
        def ExposeService(self, request: object, timeout: float | None = None) -> object:
            return _expose_response(bad_url)

    plane = _sdk_plane_with_stub(_Stub())
    with pytest.raises(ValueError):
        await plane.expose_service("dify-a", 5004)


@pytest.mark.anyio
@pytest.mark.parametrize("field", ["strip", "unspecified", "absent"])
async def test_openshell_sdk_expose_service_rejects_unapplied_auth_mode(field: str) -> None:
    # A gateway predating authorization_mode leaves it UNSPECIFIED or applies
    # STRIP; silently proceeding would drop the shellctl bearer in transit.
    from openshell._proto import openshell_pb2

    if field == "strip":
        response = _expose_response(authorization_mode=openshell_pb2.SERVICE_AUTHORIZATION_MODE_STRIP)
    elif field == "unspecified":
        response = _expose_response(authorization_mode=openshell_pb2.SERVICE_AUTHORIZATION_MODE_UNSPECIFIED)
    else:
        response = openshell_pb2.ServiceEndpointResponse(url="http://dify-a--shellctl.openshell.localhost:17670/")

    class _Stub:
        def ExposeService(self, request: object, timeout: float | None = None) -> object:
            return response

    plane = _sdk_plane_with_stub(_Stub())
    with pytest.raises(RuntimeError, match="endpoint|bearer-passthrough"):
        await plane.expose_service("dify-a", 5004)


@pytest.mark.anyio
async def test_openshell_sdk_expose_service_normalizes_not_found() -> None:
    # SDK surfaces wrap raw call errors in GatewayError, which is an RpcError
    # but not a grpc.Call; the adapter must still read its code.
    from openshell import GatewayError

    class _Stub:
        def ExposeService(self, request: object, timeout: float | None = None) -> object:
            raise GatewayError(_FakeRpcError(grpc.StatusCode.NOT_FOUND))

    plane = _sdk_plane_with_stub(_Stub())
    with pytest.raises(OpenShellNotFoundError):
        await plane.expose_service("dify-gone", 5004)


@pytest.mark.anyio
async def test_openshell_sdk_expose_service_retries_aborted_and_is_bounded() -> None:
    from openshell import GatewayError

    attempts = {"count": 0}

    class _Stub:
        def ExposeService(self, request: object, timeout: float | None = None) -> object:
            attempts["count"] += 1
            if attempts["count"] <= 2:
                raise GatewayError(_FakeRpcError(grpc.StatusCode.ABORTED))
            return _expose_response()

    plane = _sdk_plane_with_stub(_Stub())
    assert await plane.expose_service("dify-a", 5004) == "http://dify-a--shellctl.openshell.localhost:17670/"
    assert attempts["count"] == 3

    exhausted = {"count": 0}

    class _AlwaysAborted:
        def ExposeService(self, request: object, timeout: float | None = None) -> object:
            exhausted["count"] += 1
            raise GatewayError(_FakeRpcError(grpc.StatusCode.ABORTED))

    plane = _sdk_plane_with_stub(_AlwaysAborted())
    with pytest.raises(grpc.RpcError):
        await plane.expose_service("dify-a", 5004)
    assert exhausted["count"] == 3


@pytest.mark.anyio
async def test_openshell_sdk_expose_service_does_not_retry_other_codes() -> None:
    attempts = {"count": 0}

    class _Stub:
        def ExposeService(self, request: object, timeout: float | None = None) -> object:
            attempts["count"] += 1
            raise _FakeRpcError(grpc.StatusCode.UNAVAILABLE)

    plane = _sdk_plane_with_stub(_Stub())
    with pytest.raises(grpc.RpcError):
        await plane.expose_service("dify-a", 5004)
    assert attempts["count"] == 1


@pytest.mark.anyio
async def test_openshell_service_client_dials_loopback_and_preserves_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # *.openshell.localhost relies on wildcard DNS the OS resolver does not
    # reliably provide: the client dials 127.0.0.1 on the returned port and
    # pins the original authority on Host for gateway routing.
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"status": "ok"})

    original_async_client = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        openshell_module.httpx,
        "AsyncClient",
        lambda *a, **kw: original_async_client(*a, transport=transport, **kw),
    )
    plane = openshell_module.OpenShellSDKControlPlane(
        endpoint="localhost:1", insecure=True, bearer_token="gateway-token"
    )

    client = plane.create_service_http_client("http://dify-a--shellctl.openshell.localhost:17670/")

    assert client.base_url == httpx.URL("http://127.0.0.1:17670/")
    assert client.headers["host"] == "dify-a--shellctl.openshell.localhost:17670"
    # Bearer passthrough means Authorization reaches the sandbox, so the
    # deployment gateway credential stays off service HTTP entirely.
    assert "authorization" not in client.headers
    assert client.follow_redirects is False
    assert client.trust_env is False
    response = await client.get("/healthz")
    assert response.status_code == 200
    (request,) = captured
    assert request.url.host == "127.0.0.1"
    assert request.headers["host"] == "dify-a--shellctl.openshell.localhost:17670"
    await client.aclose()


def test_openshell_service_client_keeps_https_host_and_tls_material(monkeypatch: pytest.MonkeyPatch) -> None:
    # HTTPS keeps the returned host for SNI and host routing; the deployment
    # TLS material is applied through a real SSLContext built from the
    # configured paths (the insecure gRPC flag never disables verification).
    contexts: list[dict[str, object]] = []

    class _FakeContext:
        def load_cert_chain(self, certfile: str, keyfile: str | None = None) -> None:
            contexts.append({"cert": certfile, "key": keyfile})

    created: list[str | None] = []
    fake_context = _FakeContext()
    monkeypatch.setattr(
        openshell_module.ssl,
        "create_default_context",
        lambda cafile=None: created.append(cafile) or fake_context,
    )
    clients: dict[str, object] = {}

    def fake_async_client(*args: object, **kwargs: object) -> object:
        clients.update(kwargs)
        return object()

    monkeypatch.setattr(openshell_module.httpx, "AsyncClient", fake_async_client)
    plane = openshell_module.OpenShellSDKControlPlane(
        endpoint="localhost:1",
        bearer_token="gateway-token",
        tls_ca_path="/ca/ca.pem",
        tls_client_cert_path="/ca/client.pem",
        tls_client_key_path="/ca/client.key",
    )

    _ = plane.create_service_http_client("https://dify-a--shellctl.openshell.example.com:443/")

    assert clients["base_url"] == "https://dify-a--shellctl.openshell.example.com:443/"
    headers = cast("dict[str, str]", clients["headers"])
    assert "Authorization" not in headers
    assert "Host" not in headers
    assert clients["verify"] is fake_context
    assert created == ["/ca/ca.pem"]
    assert contexts == [{"cert": "/ca/client.pem", "key": "/ca/client.key"}]


def test_openshell_service_client_rejects_plaintext_http_to_nonlocal_host() -> None:
    plane = openshell_module.OpenShellSDKControlPlane(endpoint="localhost:1", insecure=True)
    with pytest.raises(ValueError, match="local"):
        plane.create_service_http_client("http://shellctl.sandbox.example.com:8080/")


@pytest.mark.anyio
async def test_openshell_sdk_exec_script_sends_script_via_stdin_not_argv() -> None:
    # The fake pins the adapter's outgoing exec shape through the REAL SDK
    # client: exec addresses the sandbox's canonical *name* inside the
    # deployment workspace, and the script travels via stdin because the
    # gateway logs a preview of the assembled argv (scripts can embed the
    # shellctl token, so argv must stay secret-free). The real gateway is
    # exercised by the integration contract in
    # tests/integration/.../test_working_environment.py.
    from typing import cast

    from openshell import SandboxClient
    from openshell._proto import openshell_pb2

    from dify_agent.runtime_backend.openshell import OpenShellSDKControlPlane

    calls: dict[str, object] = {}

    class _Stub:
        def ExecSandbox(self, request: object, timeout: float | None = None) -> object:
            calls["request"] = request
            calls["timeout"] = timeout
            return iter(
                [
                    openshell_pb2.ExecSandboxEvent(stdout=openshell_pb2.ExecSandboxStdout(data=b"out")),
                    openshell_pb2.ExecSandboxEvent(stderr=openshell_pb2.ExecSandboxStderr(data=b"err")),
                    openshell_pb2.ExecSandboxEvent(exit=openshell_pb2.ExecSandboxExit(exit_code=3)),
                ]
            )

    client = SandboxClient("localhost:1")
    client._stub = _Stub()  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    try:
        plane = OpenShellSDKControlPlane(endpoint="localhost:1", insecure=True, workspace="tenant-a")
        plane._client_cache = client  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
        script = "set -eu\nexport SHELLCTL_AUTH_TOKEN=super-secret\n"

        exit_code, output = await plane.exec_script("dify-a", script)
    finally:
        client.close()

    assert exit_code == 3
    assert output == "outerr"
    request = cast("openshell_pb2.ExecSandboxRequest", calls["request"])
    assert request.sandbox == "dify-a"
    assert request.workspace_scope.workspace == "tenant-a"
    assert list(request.command) == ["/bin/sh", "-s"]
    assert request.stdin == script.encode()
    assert request.no_login_shell is True
    assert request.execution_timeout.seconds == plane.exec_timeout_seconds


@pytest.mark.anyio
async def test_openshell_sdk_create_sends_enforced_egress_allowlist() -> None:
    # The fake pins the adapter's own outgoing create-spec shape: opt-in
    # egress_allow becomes one enforced allowlist rule per endpoint, and an
    # empty egress_allow sends no network policy at all so sandbox egress
    # stays on the gateway/driver default. Real gateway enforcement is
    # covered by the opt-in integration contract.
    from types import SimpleNamespace
    from typing import cast

    from openshell._proto import sandbox_pb2

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
    by_endpoint = {(rule.endpoints[0].host, rule.endpoints[0].port): (key, rule) for key, rule in policies.items()}
    assert set(by_endpoint) == {("agent.example.com", 5050), ("dify.example.com", 443)}
    for key, rule in by_endpoint.values():
        assert rule.name == key
        endpoint = rule.endpoints[0]
        assert endpoint.protocol == "rest"
        assert endpoint.enforcement == sandbox_pb2.NETWORK_ENFORCEMENT_MODE_ENFORCE
        assert sandbox_pb2.NetworkEnforcementMode.Name(endpoint.enforcement) == "NETWORK_ENFORCEMENT_MODE_ENFORCE"
        assert endpoint.rules[0].allow.method == "*"
        assert endpoint.rules[0].allow.path == "/**"
        # Endpoints are the allowlist; any in-sandbox binary may connect.
        assert [binary.path for binary in rule.binaries] == ["/**"]

    default = plane_with(())
    await default.create_sandbox(name="dify-b", labels={})

    assert not specs[1].policy.network_policies  # pyright: ignore[reportAttributeAccessIssue]
