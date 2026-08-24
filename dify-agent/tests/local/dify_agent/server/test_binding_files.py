from __future__ import annotations

import asyncio
import base64
import json
import os
import shlex
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, cast
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from dify_agent.adapters.shell.protocols import ShellCommandResult, ShellExecutionMode, ShellProviderError
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol import BindingFileDownloadRequest, BindingFileListRequest, BindingFileReadRequest
from dify_agent.runtime_backend import BindingAcquireError, BindingLostError, RuntimeLayout, RuntimeLease
from dify_agent.server import binding_files as binding_files_module
from dify_agent.server.binding_files import BindingFileError, BindingFileService, resolve_binding_path
from dify_agent.server.routes.binding_files import create_binding_files_router

_REFERENCE = "dify-file-ref:eyJyZWNvcmRfaWQiOiJ0b29sLTEifQ=="


def _framed(payload: dict[str, object]) -> str:
    encoded = base64.b64encode(json.dumps(payload).encode()).decode()
    return f"<<<DIFY_BINDING_FILE_BEGIN>>>{encoded}<<<DIFY_BINDING_FILE_END>>>"


@dataclass(slots=True)
class _Commands:
    outputs: list[str]
    exit_codes: list[int] = field(default_factory=list)
    calls: list[tuple[str, str | None, dict[str, str] | None, float]] = field(default_factory=list)
    deletes: list[str] = field(default_factory=list)

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env=None,
        timeout: float,
        mode: ShellExecutionMode = "pty",
    ) -> ShellCommandResult:
        assert mode == "stdio"
        self.calls.append((script, cwd, env, timeout))
        output = self.outputs.pop(0)
        exit_code = self.exit_codes.pop(0) if self.exit_codes else 0
        return ShellCommandResult(
            job_id=f"job-{len(self.calls)}",
            status="exited",
            done=True,
            exit_code=exit_code,
            output=output,
            offset=len(output),
            truncated=False,
        )

    async def wait(self, job_id: str, *, offset: int, timeout: float) -> ShellCommandResult:
        raise AssertionError("unexpected wait")

    async def read_output(self, job_id: str, *, offset: int):
        raise AssertionError("unexpected read_output")

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float):
        raise AssertionError("unexpected input")

    async def interrupt(self, job_id: str, *, grace_seconds: float):
        raise AssertionError("unexpected interrupt")

    async def tail(self, job_id: str):
        raise AssertionError("unexpected tail")

    async def delete(self, job_id: str, *, force: bool = False, grace_seconds: float | None = None) -> None:
        assert force is True
        self.deletes.append(job_id)


@dataclass(slots=True)
class _ProviderErrorCommands(_Commands):
    phase: Literal["run", "wait"] = "run"
    error_code: str = "timeout"

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env=None,
        timeout: float,
        mode: ShellExecutionMode = "pty",
    ) -> ShellCommandResult:
        assert mode == "stdio"
        self.calls.append((script, cwd, env, timeout))
        if self.phase == "run":
            raise ShellProviderError("shell provider failed", code=self.error_code)
        return ShellCommandResult(
            job_id="job-1",
            status="running",
            done=False,
            exit_code=None,
            output="",
            offset=0,
            truncated=False,
        )

    async def wait(self, job_id: str, *, offset: int, timeout: float) -> ShellCommandResult:
        assert (job_id, offset) == ("job-1", 0)
        assert timeout > 0
        raise ShellProviderError("shell provider failed", code=self.error_code)


@dataclass(slots=True)
class _LocalCommands(_Commands):
    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env=None,
        timeout: float,
        mode: ShellExecutionMode = "pty",
    ) -> ShellCommandResult:
        assert mode == "stdio"
        self.calls.append((script, cwd, env, timeout))
        process = await asyncio.create_subprocess_shell(
            script,
            cwd=cwd,
            env={**os.environ, **(env or {})},
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        output, _ = await asyncio.wait_for(process.communicate(), timeout=timeout)
        text = output.decode(errors="replace")
        return ShellCommandResult(
            job_id=f"local-job-{len(self.calls)}",
            status="exited",
            done=True,
            exit_code=process.returncode,
            output=text,
            offset=len(text),
            truncated=False,
        )


@dataclass(slots=True)
class _Lease:
    commands: _Commands
    layout: RuntimeLayout = RuntimeLayout(home_dir="/home/agent", workspace_dir="/workspace")


@dataclass(slots=True)
class _Backend:
    lease: RuntimeLease
    acquired: list[str] = field(default_factory=list)
    releases: int = 0

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        self.acquired.append(binding_ref)
        return self.lease

    async def release(self, lease: RuntimeLease) -> None:
        assert lease is self.lease
        self.releases += 1


def _context() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="account-1",
        user_from="account",
        agent_mode="agent_app",
        invoke_from="debugger",
    )


def _service(
    commands: _Commands,
    *,
    configured: bool = True,
    download_command_timeout_seconds: float = 210.0,
) -> tuple[BindingFileService, _Backend]:
    backend = _Backend(lease=cast(RuntimeLease, _Lease(commands=commands)))
    service = BindingFileService(
        execution_bindings=backend,  # pyright: ignore[reportArgumentType]
        agent_stub_api_base_url="http://stub/agent-stub" if configured else None,
        agent_stub_token_factory=(lambda execution_context, *, session_id: "secret-jwe") if configured else None,
        download_command_timeout_seconds=download_command_timeout_seconds,
    )
    return service, backend


def _local_service(tmp_path: Path) -> tuple[BindingFileService, _Backend, _LocalCommands, Path, Path]:
    workspace = tmp_path / "workspace"
    home = tmp_path / "home"
    workspace.mkdir()
    home.mkdir()
    commands = _LocalCommands(outputs=[])
    backend = _Backend(
        lease=cast(
            RuntimeLease,
            _Lease(
                commands=commands,
                layout=RuntimeLayout(home_dir=str(home), workspace_dir=str(workspace)),
            ),
        )
    )
    service = BindingFileService(
        execution_bindings=backend,  # pyright: ignore[reportArgumentType]
        agent_stub_api_base_url=None,
        agent_stub_token_factory=None,
        download_command_timeout_seconds=210.0,
    )
    return service, backend, commands, workspace, home


def test_resolve_binding_path_supports_workspace_home_absolute_and_parent_paths() -> None:
    layout = RuntimeLayout(home_dir="/home/agent", workspace_dir="/workspace")

    assert resolve_binding_path("", layout) == "/workspace"
    assert resolve_binding_path("reports/out.csv", layout) == "/workspace/reports/out.csv"
    assert resolve_binding_path("~", layout) == "/home/agent"
    assert resolve_binding_path("~/outputs/out.csv", layout) == "/home/agent/outputs/out.csv"
    assert resolve_binding_path("/var/data/out.csv", layout) == "/var/data/out.csv"
    assert resolve_binding_path("../shared/out.csv", layout) == "/shared/out.csv"


@pytest.mark.anyio
async def test_list_and_read_use_commands_with_consistent_binding_paths_and_release_leases() -> None:
    commands = _Commands(
        outputs=[
            _framed(
                {
                    "path": "reports",
                    "entries": [{"name": "note.txt", "type": "file", "size": 4, "mtime": 1}],
                    "truncated": False,
                }
            ),
            _framed(
                {
                    "path": "~/note.txt",
                    "size": 4,
                    "truncated": False,
                    "binary": False,
                    "text": "note",
                }
            ),
        ]
    )
    service, backend = _service(commands)

    listing = await service.list_files(BindingFileListRequest(backend_binding_ref="binding-ref", path="reports"))
    preview = await service.read_file(BindingFileReadRequest(backend_binding_ref="binding-ref", path="~/note.txt"))

    assert listing.entries[0].name == "note.txt"
    assert preview.text == "note"
    assert "/workspace/reports" in commands.calls[0][0]
    assert "/home/agent/note.txt" in commands.calls[1][0]
    assert all(call[1] == "/workspace" for call in commands.calls)
    assert all(call[2] == {"HOME": "/home/agent"} for call in commands.calls)
    assert backend.acquired == ["binding-ref", "binding-ref"]
    assert backend.releases == 2
    assert commands.deletes == ["job-1", "job-2"]


@pytest.mark.anyio
async def test_real_list_script_caps_1001_entries_at_1000(tmp_path: Path) -> None:
    service, backend, commands, workspace, _ = _local_service(tmp_path)
    for index in range(1001):
        (workspace / f"{index:04d}.txt").write_bytes(b"x")

    listing = await service.list_files(BindingFileListRequest(backend_binding_ref="binding-ref", path="."))

    assert len(listing.entries) == 1000
    assert listing.entries[0].name == "0000.txt"
    assert listing.entries[-1].name == "0999.txt"
    assert listing.truncated is True
    assert commands.deletes == ["local-job-1"]
    assert backend.releases == 1


@pytest.mark.anyio
async def test_real_read_script_handles_boundary_truncation_and_binary(tmp_path: Path) -> None:
    service, backend, commands, workspace, _ = _local_service(tmp_path)
    (workspace / "boundary.txt").write_bytes(b"a" * 262144)
    (workspace / "truncated.txt").write_bytes(b"b" * 262145)
    (workspace / "binary.bin").write_bytes(b"\xff\x00")

    boundary = await service.read_file(
        BindingFileReadRequest(backend_binding_ref="binding-ref", path="boundary.txt", max_bytes=262144)
    )
    truncated = await service.read_file(
        BindingFileReadRequest(backend_binding_ref="binding-ref", path="truncated.txt", max_bytes=262144)
    )
    binary = await service.read_file(
        BindingFileReadRequest(backend_binding_ref="binding-ref", path="binary.bin", max_bytes=262144)
    )

    assert boundary.size == 262144
    assert boundary.truncated is False
    assert boundary.binary is False
    assert boundary.text == "a" * 262144
    assert truncated.size == 262145
    assert truncated.truncated is True
    assert truncated.binary is False
    assert truncated.text == "b" * 262144
    assert binary.size == 2
    assert binary.truncated is False
    assert binary.binary is True
    assert binary.text is None
    assert commands.deletes == ["local-job-1", "local-job-2", "local-job-3"]
    assert backend.releases == 3


@pytest.mark.anyio
async def test_real_browse_script_output_over_command_cap_normalizes_to_unavailable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, backend, commands, workspace, _ = _local_service(tmp_path)
    (workspace / "report.txt").write_bytes(b"report")
    monkeypatch.setattr(binding_files_module, "_BROWSE_OUTPUT_MAX_BYTES", 64)

    with pytest.raises(BindingFileError) as exc_info:
        await service.list_files(BindingFileListRequest(backend_binding_ref="binding-ref", path="."))

    assert exc_info.value.code == "binding_unavailable"
    assert exc_info.value.status_code == 502
    assert commands.deletes == ["local-job-1"]
    assert backend.releases == 1


@pytest.mark.parametrize("operation", ["list", "read"])
@pytest.mark.anyio
async def test_browse_preserves_binding_file_error_and_releases_lease(operation: str) -> None:
    commands = _Commands(outputs=["FileNotFoundError: missing"], exit_codes=[1])
    service, backend = _service(commands)

    with pytest.raises(BindingFileError) as exc_info:
        if operation == "list":
            await service.list_files(BindingFileListRequest(backend_binding_ref="binding-ref", path="missing"))
        else:
            await service.read_file(BindingFileReadRequest(backend_binding_ref="binding-ref", path="missing"))

    assert exc_info.value.code == "invalid_binding_path"
    assert exc_info.value.status_code == 400
    assert backend.releases == 1


@pytest.mark.parametrize("operation", ["list", "read"])
@pytest.mark.anyio
async def test_browse_maps_malformed_backend_response_to_unavailable_and_releases_lease(operation: str) -> None:
    commands = _Commands(outputs=[_framed({"path": "."})])
    service, backend = _service(commands)

    with pytest.raises(BindingFileError) as exc_info:
        if operation == "list":
            await service.list_files(BindingFileListRequest(backend_binding_ref="binding-ref", path="."))
        else:
            await service.read_file(BindingFileReadRequest(backend_binding_ref="binding-ref", path="report.txt"))

    assert exc_info.value.code == "binding_unavailable"
    assert exc_info.value.status_code == 502
    assert backend.releases == 1


@pytest.mark.parametrize("missing_field", ["user_id", "user_from"])
@pytest.mark.anyio
async def test_download_rejects_each_missing_identity_before_token_or_lease(missing_field: str) -> None:
    context = _context().model_copy(update={missing_field: None})
    request = BindingFileDownloadRequest(
        backend_binding_ref="binding-ref",
        path="report.txt",
        execution_context=context,
    )
    commands = _Commands(outputs=[])
    service, backend = _service(commands)
    issued_tokens: list[tuple[DifyExecutionContextLayerConfig, str | None]] = []

    def issue_token(execution_context: DifyExecutionContextLayerConfig, *, session_id: str | None) -> str:
        issued_tokens.append((execution_context, session_id))
        return "must-not-be-issued"

    service.agent_stub_token_factory = issue_token

    with pytest.raises(BindingFileError) as identity_error:
        await service.download_file(request)

    assert identity_error.value.code == "invalid_execution_context"
    assert identity_error.value.status_code == 400
    assert issued_tokens == []
    assert backend.acquired == []
    assert commands.calls == []


@pytest.mark.anyio
async def test_download_rejects_missing_configuration_before_acquiring_lease() -> None:
    request = BindingFileDownloadRequest(
        backend_binding_ref="binding-ref",
        path="report.txt",
        execution_context=_context(),
    )
    commands = _Commands(outputs=[])
    unavailable_service, unavailable_backend = _service(commands, configured=False)

    with pytest.raises(BindingFileError) as unavailable_error:
        await unavailable_service.download_file(request)

    assert unavailable_error.value.code == "agent_stub_upload_unavailable"
    assert unavailable_error.value.status_code == 503
    assert unavailable_backend.acquired == []
    assert commands.calls == []


@pytest.mark.anyio
async def test_download_shell_quotes_resolved_path_and_returns_only_reference_inside_lease() -> None:
    commands = _Commands(
        outputs=[json.dumps({"transfer_method": "tool_file", "reference": _REFERENCE, "public_download_url": "bad"})]
    )
    service, backend = _service(commands, download_command_timeout_seconds=123.5)
    issued_tokens: list[tuple[DifyExecutionContextLayerConfig, str | None]] = []

    def issue_token(execution_context: DifyExecutionContextLayerConfig, *, session_id: str | None) -> str:
        issued_tokens.append((execution_context, session_id))
        return "secret-jwe"

    service.agent_stub_token_factory = issue_token
    context = _context()

    result = await service.download_file(
        BindingFileDownloadRequest(
            backend_binding_ref="binding-ref",
            path="../shared/report $(touch should-not-run); final.txt",
            execution_context=context,
        )
    )

    assert result.reference == _REFERENCE
    script, cwd, env, timeout = commands.calls[0]
    assert shlex.split(script) == [
        "dify-agent",
        "file",
        "upload",
        "--no-download-link",
        "/shared/report $(touch should-not-run); final.txt",
    ]
    assert cwd == "/workspace"
    assert env == {
        "HOME": "/home/agent",
        "DIFY_AGENT_STUB_API_BASE_URL": "http://stub/agent-stub",
        "DIFY_AGENT_STUB_AUTH_JWE": "secret-jwe",
    }
    assert timeout == pytest.approx(123.5, rel=0, abs=0.01)
    assert issued_tokens == [(context, None)]
    assert issued_tokens[0][0].model_dump() == context.model_dump()
    assert backend.releases == 1


@pytest.mark.parametrize(
    ("output", "exit_code"),
    [
        ("upload failed", 1),
        ("not-json", 0),
        (json.dumps({"transfer_method": "url", "reference": _REFERENCE}), 0),
        (json.dumps({"transfer_method": "tool_file", "reference": "raw-id"}), 0),
        ("x" * (32 * 1024 + 1), 0),
    ],
)
@pytest.mark.anyio
async def test_download_normalizes_cli_failures_and_releases_lease(output: str, exit_code: int) -> None:
    commands = _Commands(outputs=[output], exit_codes=[exit_code])
    service, backend = _service(commands)

    with pytest.raises(BindingFileError) as exc_info:
        await service.download_file(
            BindingFileDownloadRequest(
                backend_binding_ref="binding-ref",
                path="report.txt",
                execution_context=_context(),
            )
        )

    assert exc_info.value.code == "binding_file_download_failed"
    assert backend.releases == 1


@pytest.mark.anyio
async def test_download_command_timeout_releases_lease_and_returns_download_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    commands = _Commands(outputs=[])
    service, backend = _service(commands)

    async def timed_out(*_args, **_kwargs):
        return type(
            "TimedOutResult",
            (),
            {"exit_code": None, "output_complete": False, "output": "", "incomplete_reason": "timeout"},
        )()

    monkeypatch.setattr(binding_files_module, "execute_complete_with_commands", timed_out)

    with pytest.raises(BindingFileError) as exc_info:
        await service.download_file(
            BindingFileDownloadRequest(
                backend_binding_ref="binding-ref",
                path="report.txt",
                execution_context=_context(),
            )
        )

    assert exc_info.value.code == "binding_file_download_failed"
    assert exc_info.value.status_code == 502
    assert backend.releases == 1


@pytest.mark.parametrize(
    ("phase", "error_code", "expected_code", "expected_deletes"),
    [
        ("run", "timeout", "binding_file_download_failed", []),
        ("wait", "timeout", "binding_file_download_failed", ["job-1"]),
        ("wait", "request_error", "binding_unavailable", ["job-1"]),
    ],
)
@pytest.mark.anyio
async def test_download_maps_only_shell_provider_timeout_to_download_failed_and_cleans_up(
    phase: Literal["run", "wait"],
    error_code: str,
    expected_code: str,
    expected_deletes: list[str],
) -> None:
    commands = _ProviderErrorCommands(outputs=[], phase=phase, error_code=error_code)
    service, backend = _service(commands)

    with pytest.raises(BindingFileError) as exc_info:
        await service.download_file(
            BindingFileDownloadRequest(
                backend_binding_ref="binding-ref",
                path="report.txt",
                execution_context=_context(),
            )
        )

    assert exc_info.value.code == expected_code
    assert exc_info.value.status_code == 502
    assert commands.deletes == expected_deletes
    assert backend.acquired == ["binding-ref"]
    assert backend.releases == 1


@pytest.mark.anyio
async def test_download_cancellation_releases_lease(monkeypatch: pytest.MonkeyPatch) -> None:
    commands = _Commands(outputs=[])
    service, backend = _service(commands)
    command_started = asyncio.Event()
    never_finishes = asyncio.Event()

    async def block(*_args, **_kwargs):
        command_started.set()
        await never_finishes.wait()
        raise AssertionError("unreachable")

    monkeypatch.setattr(binding_files_module, "execute_complete_with_commands", block)
    task = asyncio.create_task(
        service.download_file(
            BindingFileDownloadRequest(
                backend_binding_ref="binding-ref",
                path="report.txt",
                execution_context=_context(),
            )
        )
    )
    try:
        await asyncio.wait_for(command_started.wait(), timeout=1)
        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=1)
    finally:
        if not task.done():
            task.cancel()
        with suppress(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=1)

    assert backend.releases == 1


@pytest.mark.parametrize(
    ("backend_error", "expected_code", "expected_status"),
    [
        (BindingLostError("lost"), "binding_not_found", 404),
        (BindingAcquireError("unavailable"), "binding_unavailable", 502),
    ],
)
@pytest.mark.anyio
async def test_download_maps_binding_acquire_errors(
    backend_error: Exception,
    expected_code: str,
    expected_status: int,
) -> None:
    class FailingBackend:
        releases = 0

        async def acquire(self, _binding_ref: str) -> RuntimeLease:
            raise backend_error

        async def release(self, _lease: RuntimeLease) -> None:
            self.releases += 1

    backend = FailingBackend()
    service = BindingFileService(
        execution_bindings=backend,  # pyright: ignore[reportArgumentType]
        agent_stub_api_base_url="http://stub/agent-stub",
        agent_stub_token_factory=lambda execution_context, *, session_id: "secret-jwe",
        download_command_timeout_seconds=210.0,
    )

    with pytest.raises(BindingFileError) as exc_info:
        await service.download_file(
            BindingFileDownloadRequest(
                backend_binding_ref="binding-ref",
                path="report.txt",
                execution_context=_context(),
            )
        )

    assert exc_info.value.code == expected_code
    assert exc_info.value.status_code == expected_status
    assert backend.releases == 0


@pytest.mark.parametrize(
    ("error", "expected_status", "expected_code"),
    [
        (BindingFileError("binding_not_found", "missing", status_code=404), 404, "binding_not_found"),
        (BindingFileError("binding_unavailable", "unavailable", status_code=502), 502, "binding_unavailable"),
    ],
)
def test_binding_file_route_preserves_structured_error_status_and_code(
    error: BindingFileError,
    expected_status: int,
    expected_code: str,
) -> None:
    class FailingService:
        async def download_file(self, _request):
            raise error

    app = FastAPI()
    app.include_router(create_binding_files_router(lambda: cast(BindingFileService, cast(object, FailingService()))))

    response = TestClient(app).post(
        "/execution-bindings/files/download",
        json={
            "backend_binding_ref": "binding-ref",
            "path": "report.txt",
            "execution_context": {
                "tenant_id": "tenant-1",
                "user_id": "account-1",
                "user_from": "account",
                "agent_mode": "agent_app",
                "invoke_from": "debugger",
            },
        },
    )

    assert response.status_code == expected_status
    assert response.json() == {"detail": {"code": expected_code, "message": error.message}}


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/execution-bindings/files/list", {"backend_binding_ref": "", "path": "."}),
        (
            "/execution-bindings/files/read",
            {"backend_binding_ref": "binding-ref", "path": "report.txt", "max_bytes": 262145},
        ),
    ],
)
def test_list_and_read_route_validation_returns_structured_400_without_calling_service(
    path: str,
    payload: object,
) -> None:
    service, backend = _service(_Commands(outputs=[]))
    app = FastAPI()
    app.include_router(create_binding_files_router(lambda: service))

    with (
        patch.object(BindingFileService, "list_files", new_callable=AsyncMock) as list_files,
        patch.object(BindingFileService, "read_file", new_callable=AsyncMock) as read_file,
    ):
        response = TestClient(app).post(path, json=payload)

    assert response.status_code == 400
    assert response.json() == {
        "detail": {
            "code": "invalid_binding_path",
            "message": "Binding file path or payload is invalid",
        }
    }
    list_files.assert_not_awaited()
    read_file.assert_not_awaited()
    assert backend.acquired == []
    assert backend.releases == 0


def test_list_route_redacts_unexpected_field_value_from_validation_error() -> None:
    service, backend = _service(_Commands(outputs=[]))
    app = FastAPI()
    app.include_router(create_binding_files_router(lambda: service))

    with patch.object(BindingFileService, "list_files", new_callable=AsyncMock) as list_files:
        response = TestClient(app).post(
            "/execution-bindings/files/list",
            json={"backend_binding_ref": "binding-ref", "path": ".", "unexpected": "top-secret"},
        )

    assert response.status_code == 400
    assert response.json() == {
        "detail": {
            "code": "invalid_binding_path",
            "message": "Binding file path or payload is invalid",
        }
    }
    assert "top-secret" not in response.text
    list_files.assert_not_awaited()
    assert backend.acquired == []
    assert backend.releases == 0


def test_download_route_validation_returns_422_without_calling_service() -> None:
    service, backend = _service(_Commands(outputs=[]))
    app = FastAPI()
    app.include_router(create_binding_files_router(lambda: service))

    with patch.object(BindingFileService, "download_file", new_callable=AsyncMock) as download_file:
        download_response = TestClient(app).post(
            "/execution-bindings/files/download",
            json={"backend_binding_ref": "", "path": "", "execution_context": {}},
        )

    assert download_response.status_code == 422
    assert isinstance(download_response.json()["detail"], list)
    download_file.assert_not_awaited()
    assert backend.acquired == []
    assert backend.releases == 0


def test_read_route_accepts_preview_size_limit() -> None:
    commands = _Commands(
        outputs=[
            _framed(
                {
                    "path": "report.txt",
                    "size": 262144,
                    "truncated": False,
                    "binary": False,
                    "text": "preview",
                }
            )
        ]
    )
    service, backend = _service(commands)
    app = FastAPI()
    app.include_router(create_binding_files_router(lambda: service))

    response = TestClient(app).post(
        "/execution-bindings/files/read",
        json={"backend_binding_ref": "binding-ref", "path": "report.txt", "max_bytes": 262144},
    )

    assert response.status_code == 200
    assert response.json()["text"] == "preview"
    assert "262144" in commands.calls[0][0]
    assert backend.acquired == ["binding-ref"]
    assert backend.releases == 1


def test_binding_file_validation_override_preserves_openapi_request_schemas() -> None:
    app = FastAPI()
    app.include_router(create_binding_files_router(lambda: None))
    openapi = app.openapi()
    paths = openapi["paths"]

    assert paths["/execution-bindings/files/list"]["post"]["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/BindingFileListRequest"
    }
    assert paths["/execution-bindings/files/read"]["post"]["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/BindingFileReadRequest"
    }
    max_bytes_schema = openapi["components"]["schemas"]["BindingFileReadRequest"]["properties"]["max_bytes"]
    assert max_bytes_schema["default"] == 262144
    assert max_bytes_schema["minimum"] == 1
    assert max_bytes_schema["maximum"] == 262144
