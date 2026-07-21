from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import signal
import subprocess
from typing import cast

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.adapters.shell.protocols import ShellCommandResult, ShellCommandStatus
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol, ShellctlFileTransfer
from dify_agent.agent_stub.protocol import (
    AgentStubFileDownloadRequest,
    AgentStubFileDownloadResponse,
    AgentStubFileUploadRequest,
    AgentStubFileUploadResponse,
)
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.home import DifyHomeLayerConfig
from dify_agent.layers.sandbox import DifySandboxLayerConfig
from dify_agent.layers.shell import DifyShellLayerConfig
from dify_agent.layers.workspace import DifyWorkspaceLayerConfig
from dify_agent.protocol import (
    CreateRunRequest,
    RunComposition,
    RunLayerSpec,
    SandboxListRequest,
    SandboxReadRequest,
    SandboxUploadRequest,
    SandboxUploadedFile,
    build_sandbox_locator_from_run_request,
)
from dify_agent.runtime.compositor_factory import create_default_layer_providers
from dify_agent.runtime_backend import (
    HomeSnapshotDriver,
    RuntimeBackendProfile,
    SandboxCreateSpec,
    SandboxDriver,
    SandboxLayout,
    SandboxLease,
    WorkspaceFileEntry,
    WorkspaceFileContent,
    WorkspaceFileTooLargeError,
    WorkspaceListResult,
    WorkspaceReadResult,
)
from dify_agent.server.sandbox_files import (
    AgentStubSandboxFileUploader,
    SandboxFileError,
    SandboxFileService,
    SandboxFileUploader,
)
from dify_agent.server.routes.sandbox_files import create_sandbox_files_router


def _file_reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


@dataclass(slots=True)
class FakeFiles:
    list_result: WorkspaceListResult = WorkspaceListResult(
        path=".",
        entries=(WorkspaceFileEntry(name="notes.txt", type="file", size=5, mtime=1),),
        truncated=False,
    )
    read_result: WorkspaceReadResult = WorkspaceReadResult(
        path="notes.txt", size=5, truncated=False, binary=False, text="hello"
    )
    content_result: WorkspaceFileContent = WorkspaceFileContent(path="notes.txt", size=5, content=b"hello")
    list_calls: list[tuple[str, str, int]] = field(default_factory=list)
    read_calls: list[tuple[str, str, int]] = field(default_factory=list)
    read_bytes_calls: list[tuple[str, str, int]] = field(default_factory=list)
    read_bytes_error: Exception | None = None

    async def list_directory(self, *, workspace_dir: str, path: str, limit: int) -> WorkspaceListResult:
        self.list_calls.append((workspace_dir, path, limit))
        return self.list_result

    async def read_file(self, *, workspace_dir: str, path: str, max_bytes: int) -> WorkspaceReadResult:
        self.read_calls.append((workspace_dir, path, max_bytes))
        return self.read_result

    async def read_bytes(self, *, workspace_dir: str, path: str, max_bytes: int) -> WorkspaceFileContent:
        self.read_bytes_calls.append((workspace_dir, path, max_bytes))
        if self.read_bytes_error is not None:
            raise self.read_bytes_error
        return self.content_result

    async def upload(self, *, content: bytes, remote_path: str, cwd: str | None = None) -> None:
        raise AssertionError("workspace upload should use the server control plane")

    async def download(self, *, remote_path: str, cwd: str | None = None) -> bytes:
        raise AssertionError("download is not used by workspace browsing")


@dataclass(slots=True)
class FakeCommands:
    output: str = ""
    run_calls: list[tuple[str, str | None, dict[str, str] | None]] = field(default_factory=list)

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
    ) -> ShellCommandResult:
        del timeout
        self.run_calls.append((script, cwd, env))
        return ShellCommandResult(
            job_id="job-1",
            status="exited",
            done=True,
            exit_code=0,
            output=self.output,
            offset=len(self.output),
            truncated=False,
            output_path=None,
        )

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
class _LocalShellctlJob:
    job_id: str
    status: str
    done: bool
    output: str
    offset: int
    truncated: bool
    exit_code: int | None
    output_path: str | None = None


def _kill_process_group(process: subprocess.Popen[str]) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


@dataclass(slots=True)
class _LocalShellctlClient:
    delete_calls: list[str] = field(default_factory=list)

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float = 30.0,
    ) -> _LocalShellctlJob:
        process_env = None
        if env is not None:
            process_env = os.environ.copy()
            process_env.update(env)
        process = subprocess.Popen(
            ["/bin/sh", "-c", script],
            cwd=cwd,
            env=process_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_process_group(process)
            _ = process.communicate()
            raise AssertionError(f"local shellctl command exceeded {timeout:g}s test timeout") from None
        except BaseException:
            _kill_process_group(process)
            _ = process.communicate()
            raise
        output = stdout + stderr
        return _LocalShellctlJob(
            job_id="local-job",
            status="exited",
            done=True,
            output=output,
            offset=len(output),
            truncated=False,
            exit_code=process.returncode,
        )

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> None:
        del force, grace_seconds
        self.delete_calls.append(job_id)


@dataclass(slots=True)
class FakeUploader:
    calls: list[tuple[DifyExecutionContextLayerConfig, str, str, bytes]] = field(default_factory=list)

    async def upload(
        self,
        *,
        execution_context: DifyExecutionContextLayerConfig,
        filename: str,
        mimetype: str,
        content: bytes,
    ) -> SandboxUploadedFile:
        self.calls.append((execution_context, filename, mimetype, content))
        return SandboxUploadedFile(
            reference="dify-file-ref:file-1",
            download_url="https://files.example/notes.txt",
        )


@dataclass(slots=True)
class FakeAgentStubFileHandler:
    upload_calls: list[tuple[AgentStubPrincipal, str, str]] = field(default_factory=list)
    download_calls: list[tuple[AgentStubPrincipal, str, bool]] = field(default_factory=list)

    async def create_upload_request(
        self,
        *,
        principal: AgentStubPrincipal,
        request: AgentStubFileUploadRequest,
    ) -> AgentStubFileUploadResponse:
        self.upload_calls.append((principal, request.filename, request.mimetype))
        return AgentStubFileUploadResponse(upload_url="https://files.example/upload")

    async def create_download_request(
        self,
        *,
        principal: AgentStubPrincipal,
        request: AgentStubFileDownloadRequest,
    ) -> AgentStubFileDownloadResponse:
        self.download_calls.append((principal, cast(str, request.file.reference), request.for_external))
        return AgentStubFileDownloadResponse(
            filename="report.pdf",
            mime_type="application/pdf",
            size=7,
            download_url="https://files.example/download",
        )


@dataclass(slots=True)
class FakeLease:
    handle: str
    commands: FakeCommands
    files: FakeFiles
    layout: SandboxLayout = SandboxLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")


@dataclass(slots=True)
class FakeSandboxDriver:
    lease: FakeLease
    resume_calls: list[str] = field(default_factory=list)
    suspend_calls: list[str] = field(default_factory=list)

    async def create(self, spec: SandboxCreateSpec) -> SandboxLease:
        raise AssertionError(spec)

    async def resume(self, handle: str) -> SandboxLease:
        self.resume_calls.append(handle)
        return cast(SandboxLease, self.lease)

    async def suspend(self, lease: SandboxLease) -> None:
        self.suspend_calls.append(lease.handle)

    async def delete(self, handle: str) -> None:
        raise AssertionError(handle)


def _locator():
    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="execution_context",
                    type="dify.execution_context",
                    config=DifyExecutionContextLayerConfig(
                        tenant_id="tenant-1",
                        user_id="user-1",
                        user_from="account",
                        agent_id="agent-1",
                        agent_config_version_id="config-1",
                        agent_mode="agent_app",
                        invoke_from="service-api",
                    ),
                ),
                RunLayerSpec(
                    name="home",
                    type="dify.home",
                    deps={"execution_context": "execution_context"},
                    config=DifyHomeLayerConfig(snapshot_ref="home-ref"),
                ),
                RunLayerSpec(
                    name="workspace",
                    type="dify.workspace",
                    deps={"execution_context": "execution_context"},
                    config=DifyWorkspaceLayerConfig(workspace_id="session-1"),
                ),
                RunLayerSpec(
                    name="sandbox",
                    type="dify.sandbox",
                    deps={"execution_context": "execution_context", "home": "home", "workspace": "workspace"},
                    config=DifySandboxLayerConfig(),
                ),
                RunLayerSpec(
                    name="shell",
                    type="dify.shell",
                    deps={"execution_context": "execution_context", "sandbox": "sandbox"},
                    config=DifyShellLayerConfig(agent_stub_drive_ref="agent-1"),
                ),
            ]
        ),
        session_snapshot=CompositorSessionSnapshot(
            layers=[
                LayerSessionSnapshot(
                    name="execution_context", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}
                ),
                LayerSessionSnapshot(name="home", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
                LayerSessionSnapshot(name="workspace", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
                LayerSessionSnapshot(
                    name="sandbox", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={"handle": "sandbox-1"}
                ),
                LayerSessionSnapshot(name="shell", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
            ]
        ),
    )
    return build_sandbox_locator_from_run_request(request)


def _service(*, with_uploader: bool = True):
    files = FakeFiles()
    commands = FakeCommands()
    uploader = FakeUploader()
    driver = FakeSandboxDriver(lease=FakeLease(handle="sandbox-1", commands=commands, files=files))
    profile = RuntimeBackendProfile(
        backend_id="test",
        home_snapshots=cast(HomeSnapshotDriver, object()),
        sandboxes=cast(SandboxDriver, driver),
    )
    service = SandboxFileService(
        layer_providers=create_default_layer_providers(
            runtime_backend_profile=profile,
            agent_stub_api_base_url="https://agent.example.com/agent-stub",
            agent_stub_token_factory=lambda execution_context, session_id: f"token:{session_id}",
        ),
        upload_max_bytes=50 * 1024 * 1024,
        file_uploader=cast(SandboxFileUploader, uploader) if with_uploader else None,
    )
    return service, driver, files, commands, uploader


def test_list_and_read_use_workspace_scoped_file_system_and_suspend() -> None:
    service, driver, files, _commands, _uploader = _service()

    listed = asyncio.run(service.list_files(SandboxListRequest(locator=_locator(), path=".")))
    read = asyncio.run(service.read_file(SandboxReadRequest(locator=_locator(), path="notes.txt")))

    assert listed.entries[0].name == "notes.txt"
    assert read.text == "hello"
    assert files.list_calls == [("/home/dify/workspace", ".", 1000)]
    assert files.read_calls == [("/home/dify/workspace", "notes.txt", 262_144)]
    assert driver.resume_calls == ["sandbox-1", "sandbox-1"]
    assert driver.suspend_calls == ["sandbox-1", "sandbox-1"]


@pytest.mark.parametrize("path", ["../secret", "/etc/passwd", "~/secret"])
def test_workspace_paths_reject_escape_before_resuming(path: str) -> None:
    service, driver, _files, _commands, _uploader = _service()

    with pytest.raises(SandboxFileError, match="workspace root"):
        asyncio.run(service.list_files(SandboxListRequest(locator=_locator(), path=path)))

    assert driver.resume_calls == []


def test_upload_reads_workspace_bytes_then_uses_control_plane_without_shell() -> None:
    service, driver, files, commands, uploader = _service()
    files.content_result = WorkspaceFileContent(path="reports/notes.txt", size=5, content=b"hello")

    response = asyncio.run(service.upload_file(SandboxUploadRequest(locator=_locator(), path="reports/notes.txt")))

    assert response.file.reference == "dify-file-ref:file-1"
    assert response.path == "reports/notes.txt"
    assert files.read_bytes_calls == [("/home/dify/workspace", "reports/notes.txt", 50 * 1024 * 1024)]
    assert commands.run_calls == []
    assert len(uploader.calls) == 1
    execution_context, filename, mimetype, content = uploader.calls[0]
    assert execution_context.tenant_id == "tenant-1"
    assert filename == "notes.txt"
    assert mimetype == "text/plain"
    assert content == b"hello"
    assert driver.suspend_calls == ["sandbox-1"]


def test_upload_file_too_large_has_stable_http_response() -> None:
    service, driver, files, commands, uploader = _service()
    files.read_bytes_error = WorkspaceFileTooLargeError(
        path="reports/large.bin",
        size=50 * 1024 * 1024 + 1,
        max_bytes=50 * 1024 * 1024,
    )
    app = FastAPI()
    app.include_router(create_sandbox_files_router(lambda: service))
    request = SandboxUploadRequest(locator=_locator(), path="reports/large.bin")

    with TestClient(app) as client:
        response = client.post("/sandbox/files/upload", json=request.model_dump(mode="json"))

    assert response.status_code == 413
    assert response.json() == {
        "detail": {
            "code": "file_too_large",
            "message": "Workspace file 'reports/large.bin' exceeds the 52428800-byte ToolFile upload limit",
        }
    }
    assert files.read_bytes_calls == [("/home/dify/workspace", "reports/large.bin", 50 * 1024 * 1024)]
    assert uploader.calls == []
    assert commands.run_calls == []
    assert driver.suspend_calls == ["sandbox-1"]


@pytest.mark.parametrize(
    ("endpoint", "path"),
    [
        ("/sandbox/files/read", "linked-directory/secret.txt"),
        ("/sandbox/files/read", "linked-file.txt"),
    ],
)
def test_existing_workspace_symlinks_map_to_stable_path_error_and_suspend(
    tmp_path: Path,
    endpoint: str,
    path: str,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside_directory = tmp_path / "outside"
    outside_directory.mkdir()
    (outside_directory / "secret.txt").write_text("secret")
    outside_file = tmp_path / "outside.txt"
    outside_file.write_text("secret")
    (workspace / "linked-directory").symlink_to(outside_directory, target_is_directory=True)
    (workspace / "linked-file.txt").symlink_to(outside_file)
    service, driver, _files, _commands, _uploader = _service()
    shellctl_client = _LocalShellctlClient()
    driver.lease.files = cast(
        FakeFiles,
        cast(
            object,
            ShellctlFileTransfer(cast(ShellctlClientProtocol, cast(object, shellctl_client))),
        ),
    )
    driver.lease.layout = SandboxLayout(home_dir=str(tmp_path / "home"), workspace_dir=str(workspace))
    app = FastAPI()
    app.include_router(create_sandbox_files_router(lambda: service))
    payload = {"locator": _locator().model_dump(mode="json"), "path": path}

    with TestClient(app) as client:
        response = client.post(endpoint, json=payload)

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_workspace_path"
    assert driver.resume_calls == ["sandbox-1"]
    assert driver.suspend_calls == ["sandbox-1"]
    assert shellctl_client.delete_calls == ["local-job"]


def test_upload_requires_control_plane_uploader_before_resuming() -> None:
    service, driver, _files, commands, _uploader = _service(with_uploader=False)

    with pytest.raises(SandboxFileError, match="not configured") as exc_info:
        asyncio.run(service.upload_file(SandboxUploadRequest(locator=_locator(), path="notes.txt")))

    assert exc_info.value.status_code == 503
    assert driver.resume_calls == []
    assert commands.run_calls == []


def test_agent_stub_uploader_posts_bytes_with_separate_filename_and_mimetype() -> None:
    reference = _file_reference("tool-file-1")

    def upload_handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://files.example/upload"
        assert request.headers["content-type"].startswith("multipart/form-data; boundary=")
        assert b'name="file"; filename="report.pdf"' in request.content
        assert b"Content-Type: application/pdf" in request.content
        assert b"payload" in request.content
        assert b"reports/report.pdf" not in request.content
        return httpx.Response(201, json={"reference": reference})

    handler = FakeAgentStubFileHandler()
    uploader = AgentStubSandboxFileUploader(
        file_request_handler=handler,
        transport=httpx.MockTransport(upload_handler),
    )
    execution_context = DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        agent_id="agent-1",
        agent_config_version_id="config-1",
        agent_mode="agent_app",
        invoke_from="service-api",
    )

    uploaded = asyncio.run(
        uploader.upload(
            execution_context=execution_context,
            filename="report.pdf",
            mimetype="application/pdf",
            content=b"payload",
        )
    )

    assert uploaded.reference == reference
    assert uploaded.download_url == "https://files.example/download"
    assert len(handler.upload_calls) == 1
    principal = handler.upload_calls[0][0]
    assert handler.upload_calls[0][1:] == ("report.pdf", "application/pdf")
    assert principal.execution_context is execution_context
    assert principal.session_id is None
    assert handler.download_calls == [(principal, reference, False)]
