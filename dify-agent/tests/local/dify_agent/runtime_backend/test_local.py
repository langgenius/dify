from __future__ import annotations

from dataclasses import dataclass, field
import shlex
from typing import Mapping

import pytest
from shellctl.shared import DeleteJobResponse, JobMode, JobResult, JobStatusName, JobStatusView

from dify_agent.runtime_backend import (
    BindingCreateError,
    BindingDestroyError,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateSpec,
)
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend, LocalHomeSnapshotBackend


@dataclass(slots=True)
class _RunCall:
    commands: tuple[tuple[str, ...], ...]
    cwd: str | None
    env: Mapping[str, str] | None
    mode: JobMode


@dataclass(slots=True)
class _Client:
    runs: list[_RunCall]
    closed: bool = False
    exit_code: int = 0
    output: str = ""
    close_error: Exception | None = None
    exit_codes: list[int] = field(default_factory=list)

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
        timeout: float = 10.0,
        mode: JobMode = JobMode.PTY,
    ) -> JobResult:
        del timeout
        commands = tuple(
            tuple(shlex.split(line)) for line in script.splitlines() if line.strip() and line.strip() != "set -eu"
        )
        self.runs.append(_RunCall(commands=commands, cwd=cwd, env=env, mode=mode))
        return JobResult(
            job_id=f"job-{len(self.runs)}",
            status=JobStatusName.EXITED,
            done=True,
            exit_code=self.exit_codes.pop(0) if self.exit_codes else self.exit_code,
            output_path="/tmp/output.log",
            output=self.output,
            offset=0,
            truncated=False,
        )

    async def wait(self, job_id: str, *, offset: int, timeout: float = 10.0) -> JobResult:
        raise AssertionError((job_id, offset, timeout))

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float = 10.0) -> JobResult:
        raise AssertionError((job_id, text, offset, timeout))

    async def tail(self, job_id: str) -> JobResult:
        raise AssertionError(job_id)

    async def terminate(self, job_id: str, grace_seconds: float = 2.0) -> JobStatusView:
        raise AssertionError((job_id, grace_seconds))

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> DeleteJobResponse:
        del force, grace_seconds
        return DeleteJobResponse(job_id=job_id)

    async def close(self) -> None:
        self.closed = True
        if self.close_error is not None:
            raise self.close_error


@dataclass(slots=True)
class _Factory:
    clients: list[_Client] = field(default_factory=list)
    runs: list[_RunCall] = field(default_factory=list)

    def __call__(self) -> _Client:
        client = _Client(runs=self.runs)
        self.clients.append(client)
        return client

    @property
    def commands(self) -> tuple[tuple[str, ...], ...]:
        return tuple(command for run in self.runs for command in run.commands)


@dataclass(slots=True)
class _FailingFactory:
    clients: list[_Client] = field(default_factory=list)
    runs: list[_RunCall] = field(default_factory=list)

    def __call__(self) -> _Client:
        client = _Client(
            runs=self.runs,
            exit_code=1,
            output="primary shellctl failure",
            close_error=RuntimeError("secondary close failure"),
        )
        self.clients.append(client)
        return client


@dataclass(slots=True)
class _FailThenSucceedFactory:
    clients: list[_Client] = field(default_factory=list)
    runs: list[_RunCall] = field(default_factory=list)

    def __call__(self) -> _Client:
        client = _Client(
            runs=self.runs,
            output="primary shellctl failure",
            exit_codes=[1, 0],
        )
        self.clients.append(client)
        return client

    @property
    def commands(self) -> tuple[tuple[str, ...], ...]:
        return tuple(command for run in self.runs for command in run.commands)


@pytest.mark.anyio
async def test_local_binding_create_materializes_home_and_new_workspace() -> None:
    factory = _Factory()
    backend = LocalExecutionBindingBackend(
        endpoint="http://shellctl",
        auth_token="",
        materialized_home_root="/homes",
        workspace_root="/workspaces",
        snapshot_root="/snapshots",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )

    allocation = await backend.create_binding(
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref="home-home-1",
        )
    )

    assert allocation.binding_ref == "binding-1:workspace-1"
    assert allocation.workspace_ref == "workspace-1"
    assert factory.commands[0] == ("test", "-d", "/snapshots/home-home-1")
    assert ("mkdir", "-p", "/workspaces/workspace-1") in factory.commands
    assert ("mkdir", "-p", "/homes/binding-1") in factory.commands
    assert ("cp", "-a", "/snapshots/home-home-1/.", "/homes/binding-1/") in factory.commands
    assert ("chmod", "700", "/homes/binding-1", "/workspaces/workspace-1") in factory.commands
    assert all(run.mode is JobMode.STDIO for run in factory.runs)


@pytest.mark.anyio
async def test_local_binding_create_uses_empty_default_home_without_snapshot_access() -> None:
    factory = _Factory()
    backend = LocalExecutionBindingBackend(
        endpoint="http://shellctl",
        auth_token="",
        materialized_home_root="/homes",
        workspace_root="/workspaces",
        snapshot_root="/snapshots",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )

    allocation = await backend.create_binding(
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref=None,
        )
    )

    assert allocation.binding_ref == "binding-1:workspace-1"
    assert ("mkdir", "-p", "/homes/binding-1") in factory.commands
    assert all("/snapshots" not in part for command in factory.commands for part in command)


@pytest.mark.anyio
async def test_local_binding_bootstraps_custom_roots_from_common_root() -> None:
    factory = _Factory()
    backend = LocalExecutionBindingBackend(
        endpoint="http://shellctl",
        auth_token="",
        materialized_home_root="/tmp/dify-agent/homes",
        workspace_root="/tmp/dify-agent/workspaces",
        snapshot_root="/tmp/dify-agent/snapshots",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )

    await backend.create_binding(
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref=None,
        )
    )

    assert factory.runs[0].cwd == "/tmp/dify-agent"
    assert factory.runs[0].env == {"HOME": "/tmp/dify-agent"}


@pytest.mark.anyio
async def test_local_binding_separates_root_workspace_from_home_control_scope() -> None:
    factory = _Factory()
    backend = LocalExecutionBindingBackend(
        endpoint="http://shellctl",
        auth_token="",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )

    await backend.create_binding(
        ExecutionBindingCreateSpec(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            existing_workspace_ref=None,
            home_snapshot_ref=None,
        )
    )

    assert factory.runs[0].cwd == "/workspace"
    assert factory.runs[0].env == {"HOME": "/home/dify"}


@pytest.mark.anyio
async def test_local_binding_create_failure_removes_partial_home_and_workspace() -> None:
    factory = _FailThenSucceedFactory()
    backend = LocalExecutionBindingBackend(
        endpoint="http://shellctl",
        auth_token="",
        materialized_home_root="/homes",
        workspace_root="/workspaces",
        snapshot_root="/snapshots",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )

    with pytest.raises(BindingCreateError, match="primary shellctl failure"):
        await backend.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                binding_id="binding-1",
                workspace_id="workspace-1",
                existing_workspace_ref=None,
                home_snapshot_ref="home-home-1",
            )
        )

    assert ("rm", "-rf", "--", "/homes/binding-1", "/workspaces/workspace-1") in factory.commands


@pytest.mark.anyio
async def test_local_binding_acquire_scopes_commands_to_materialized_home_and_workspace() -> None:
    factory = _Factory()
    backend = LocalExecutionBindingBackend(
        endpoint="http://shellctl",
        auth_token="",
        materialized_home_root="/homes",
        workspace_root="/workspaces",
        snapshot_root="/snapshots",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )

    lease = await backend.acquire("binding-1:workspace-1")

    assert lease.layout.home_dir == "/homes/binding-1"
    assert lease.layout.workspace_dir == "/workspaces/workspace-1"
    assert ("test", "-d", "/homes/binding-1") in factory.commands
    assert ("test", "-d", "/workspaces/workspace-1") in factory.commands

    await lease.commands.run("pwd", cwd=None, env={"HOME": "/homes/other"}, timeout=10.0)
    pwd_run = next(run for run in factory.runs if run.commands == (("pwd",),))
    assert pwd_run.cwd == "/workspaces/workspace-1"
    assert pwd_run.env == {"HOME": "/homes/binding-1"}
    assert pwd_run.mode is JobMode.PTY
    with pytest.raises(ValueError, match="outside this RuntimeLease"):
        await lease.commands.run("cat secret", cwd="/homes/other", timeout=10.0)
    await backend.release(lease)


@pytest.mark.anyio
async def test_local_snapshot_checkpoint_copies_only_materialized_home() -> None:
    factory = _Factory()
    snapshots = LocalHomeSnapshotBackend(
        endpoint="http://shellctl",
        auth_token="",
        snapshot_root="/snapshots",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )
    bindings = LocalExecutionBindingBackend(
        endpoint="http://shellctl",
        auth_token="",
        materialized_home_root="/homes",
        workspace_root="/workspaces",
        snapshot_root="/snapshots",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )
    lease = await bindings.acquire("binding-1:workspace-1")

    snapshot_ref = await snapshots.create_from_runtime(
        spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-2"),
        source=lease,
    )
    await bindings.release(lease)

    assert snapshot_ref == "home-home-2"
    assert ("test", "-d", "/homes/binding-1") in factory.commands
    assert ("mkdir", "-p", "/snapshots/home-home-2") in factory.commands
    assert ("cp", "-a", "/homes/binding-1/.", "/snapshots/home-home-2/") in factory.commands
    assert ("cp", "-a", "/workspaces/workspace-1/.", "/snapshots/home-home-2/") not in factory.commands


@pytest.mark.anyio
async def test_local_binding_destroy_removes_home_and_requested_workspace() -> None:
    factory = _Factory()
    backend = LocalExecutionBindingBackend(
        endpoint="http://shellctl",
        auth_token="",
        materialized_home_root="/homes",
        workspace_root="/workspaces",
        snapshot_root="/snapshots",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )

    await backend.destroy_binding(
        ExecutionBindingDestroySpec(
            binding_ref="binding-1:workspace-1",
            workspace_ref="workspace-1",
            destroy_workspace=True,
        )
    )

    assert ("rm", "-rf", "--", "/homes/binding-1", "/workspaces/workspace-1") in factory.commands


@pytest.mark.anyio
async def test_local_snapshot_delete_removes_snapshot_directory() -> None:
    factory = _Factory()
    backend = LocalHomeSnapshotBackend(
        endpoint="http://shellctl",
        auth_token="",
        snapshot_root="/snapshots",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )

    await backend.delete("home-home-2")

    assert ("rm", "-rf", "--", "/snapshots/home-home-2") in factory.commands


@pytest.mark.anyio
async def test_local_snapshot_delete_preserves_shellctl_error_when_close_fails() -> None:
    factory = _FailingFactory()
    backend = LocalHomeSnapshotBackend(
        endpoint="http://shellctl",
        auth_token="",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )

    with pytest.raises(BindingDestroyError, match="primary shellctl failure"):
        await backend.delete("home-1")

    assert factory.clients and all(client.closed for client in factory.clients)


@pytest.mark.anyio
async def test_local_binding_destroy_preserves_shellctl_error_when_close_fails() -> None:
    factory = _FailingFactory()
    backend = LocalExecutionBindingBackend(
        endpoint="http://shellctl",
        auth_token="",
        client_factory=factory,  # pyright: ignore[reportArgumentType]
    )

    with pytest.raises(BindingDestroyError, match="primary shellctl failure"):
        await backend.destroy_binding(
            ExecutionBindingDestroySpec(
                binding_ref="binding-1:workspace-1",
                destroy_workspace=False,
            )
        )

    assert factory.clients and all(client.closed for client in factory.clients)


@pytest.fixture
def native_scope_http_server():
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    state = {
        "requests": [],
        "status": 200,
        "body": {"scope_id": "scope-one", "generation": 7, "status": "ready", "token": "scope-secret"},
    }

    class Handler(BaseHTTPRequestHandler):
        def handle_request(self):
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            state["requests"].append((self.command, self.path, dict(self.headers), json.loads(body) if body else None))
            self.send_response(state["status"])
            self.send_header("Content-Type", "application/json")
            if state["status"] == 307:
                self.send_header("Location", "/v1/jobs")
            self.end_headers()
            self.wfile.write(json.dumps(state["body"]).encode())

        do_GET = do_POST = do_DELETE = handle_request

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def _native_transport_spec():
    from datetime import datetime, timedelta, timezone
    from shellctl.shared.schemas import NativeScopeSpec

    return NativeScopeSpec.model_validate(
        {
            "scope_id": "scope-one",
            "generation": 7,
            "binding_ref": "binding-one",
            "base_snapshot_ref": "home-one",
            "input_file_refs": ["file-one"],
            "capability_digest": "a" * 64,
            "deadline": datetime.now(timezone.utc) + timedelta(seconds=60),
            "limits": {
                "cpu_quota": 100000,
                "memory_bytes": 128 << 20,
                "pids": 32,
                "fds": 64,
                "wall_seconds": 120,
                "input_bytes": 1 << 20,
                "output_bytes": 1 << 20,
                "disk_bytes": 16 << 20,
            },
        }
    )


@pytest.mark.anyio
async def test_native_scope_transport_create_inspect_destroy_and_ephemeral_handle(native_scope_http_server) -> None:
    from dify_agent.runtime_backend.local import LocalNativeScopeClient

    endpoint, state = native_scope_http_server
    client = LocalNativeScopeClient(endpoint, "control-secret")
    handle = await client.create(_native_transport_spec())
    assert handle.scope_id == "scope-one"
    assert await client.inspect("scope-one", 7) == handle
    state["body"] = {"status": "destroyed"}
    await client.destroy("scope-one", 7)
    requests = state["requests"]
    assert [(method, path) for method, path, _, _ in requests] == [
        ("POST", "/v1/test-scopes"),
        ("GET", "/v1/test-scopes/scope-one"),
        ("DELETE", "/v1/test-scopes/scope-one"),
    ]
    assert all(headers["Authorization"] == "Bearer control-secret" for _, _, headers, _ in requests)
    assert requests[1][2]["X-Scope-Generation"] == "7"
    assert requests[0][3]["input_file_refs"] == ["file-one"]
    assert "control-secret" not in repr(client)
    assert "scope-secret" not in handle.model_dump_json()
    async with client.job_client(handle) as jobs:
        assert jobs.base_url == endpoint
        assert jobs.native_scope is handle


@pytest.mark.anyio
@pytest.mark.parametrize("status", [404, 409, 307])
async def test_native_scope_transport_never_recreates_or_redirects_lost_owner(
    native_scope_http_server, status: int
) -> None:
    from dify_agent.runtime_backend.local import LocalNativeScopeClient
    from shellctl.client import ShellctlClientError

    endpoint, state = native_scope_http_server
    state["status"] = status
    client = LocalNativeScopeClient(endpoint, "control-secret")
    with pytest.raises(ShellctlClientError, match="native_scope_unavailable"):
        await client.inspect("scope-one", 7)
    assert [(method, path) for method, path, _, _ in state["requests"]] == [("GET", "/v1/test-scopes/scope-one")]


@pytest.mark.anyio
async def test_native_scope_transport_rejects_wrong_generation(native_scope_http_server) -> None:
    from dify_agent.runtime_backend.local import LocalNativeScopeClient
    from shellctl.client import ShellctlClientError

    endpoint, state = native_scope_http_server
    state["body"]["generation"] = 8
    with pytest.raises(ShellctlClientError, match="native_scope_identity_mismatch"):
        await LocalNativeScopeClient(endpoint, "control-secret").inspect("scope-one", 7)
