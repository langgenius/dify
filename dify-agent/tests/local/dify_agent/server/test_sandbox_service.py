import asyncio
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import pytest

from dify_agent.layers.shell.layer import DifyShellLayer
from dify_agent.protocol import SandboxListFilesRequest, SandboxLocator, SandboxReadFileRequest, SandboxUploadFileRequest
from dify_agent.runtime.compositor_factory import create_default_layer_providers
import dify_agent.server.sandbox_service as sandbox_service_module
from dify_agent.server.sandbox_service import SandboxService, SandboxServiceError


def _service() -> SandboxService:
    return SandboxService(
        layer_providers=create_default_layer_providers(),
        command_timeout_seconds=5.0,
        max_read_bytes=1024,
        max_upload_bytes=1024,
    )


def _locator(*, session_id: str, workspace_cwd: str) -> SandboxLocator:
    return SandboxLocator.model_validate(
        {
            "composition": {
                "layers": [
                    {
                        "name": "execution_context",
                        "type": "dify.execution_context",
                        "config": {"tenant_id": "tenant-1", "invoke_from": "workflow_run"},
                    },
                    {
                        "name": "shell",
                        "type": "dify.shell",
                        "deps": {"execution_context": "execution_context"},
                        "config": {},
                    },
                ]
            },
            "session_snapshot": {
                "layers": [
                    {"name": "execution_context", "lifecycle_state": "suspended", "runtime_state": {}},
                    {
                        "name": "shell",
                        "lifecycle_state": "suspended",
                        "runtime_state": {
                            "session_id": session_id,
                            "workspace_cwd": workspace_cwd,
                            "job_ids": [],
                            "job_offsets": {},
                        },
                    },
                ]
            },
            "shell_layer_name": "shell",
        }
    )


def _locator_with_transitive_dependency(*, session_id: str, workspace_cwd: str) -> SandboxLocator:
    return SandboxLocator.model_validate(
        {
            "composition": {
                "layers": [
                    {"name": "support", "type": "plain.prompt", "config": {"prefix": "support"}},
                    {
                        "name": "execution_context",
                        "type": "dify.execution_context",
                        "deps": {"support_dep": "support"},
                        "config": {"tenant_id": "tenant-1", "invoke_from": "workflow_run"},
                    },
                    {
                        "name": "shell",
                        "type": "dify.shell",
                        "deps": {"execution_context": "execution_context"},
                        "config": {},
                    },
                ]
            },
            "session_snapshot": {
                "layers": [
                    {"name": "support", "lifecycle_state": "suspended", "runtime_state": {}},
                    {"name": "execution_context", "lifecycle_state": "suspended", "runtime_state": {}},
                    {
                        "name": "shell",
                        "lifecycle_state": "suspended",
                        "runtime_state": {
                            "session_id": session_id,
                            "workspace_cwd": workspace_cwd,
                            "job_ids": [],
                            "job_offsets": {},
                        },
                    },
                ]
            },
            "shell_layer_name": "shell",
        }
    )


def _locator_with_custom_shell_and_execution_context_names(*, session_id: str, workspace_cwd: str) -> SandboxLocator:
    return SandboxLocator.model_validate(
        {
            "composition": {
                "layers": [
                    {
                        "name": "env_ctx",
                        "type": "dify.execution_context",
                        "config": {"tenant_id": "tenant-1", "invoke_from": "workflow_run"},
                    },
                    {
                        "name": "worker_shell",
                        "type": "dify.shell",
                        "deps": {"execution_context": "env_ctx"},
                        "config": {},
                    },
                ]
            },
            "session_snapshot": {
                "layers": [
                    {"name": "env_ctx", "lifecycle_state": "suspended", "runtime_state": {}},
                    {
                        "name": "worker_shell",
                        "lifecycle_state": "suspended",
                        "runtime_state": {
                            "session_id": session_id,
                            "workspace_cwd": workspace_cwd,
                            "job_ids": [],
                            "job_offsets": {},
                        },
                    },
                ]
            },
            "shell_layer_name": "worker_shell",
        }
    )


def test_sandbox_service_rejects_locator_with_unmanaged_workspace_path() -> None:
    request = SandboxListFilesRequest(locator=_locator(session_id="session-1", workspace_cwd="/etc"), path=".")

    async def scenario() -> None:
        with pytest.raises(SandboxServiceError, match="workspace path is invalid") as exc_info:
            await _service().list_files(request)
        assert exc_info.value.code == "sandbox_not_found"

    asyncio.run(scenario())


def test_sandbox_service_rejects_locator_when_workspace_directory_is_missing() -> None:
    workspace = DifyShellLayer.workspace_path_for_session_id("missing-session")
    shutil.rmtree(workspace, ignore_errors=True)
    request = SandboxListFilesRequest(locator=_locator(session_id="missing-session", workspace_cwd=str(workspace)), path=".")

    async def scenario() -> None:
        with pytest.raises(SandboxServiceError, match="no longer exists") as exc_info:
            await _service().list_files(request)
        assert exc_info.value.code == "sandbox_not_found"

    asyncio.run(scenario())


def test_sandbox_service_accepts_locator_with_transitive_shell_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = DifyShellLayer.workspace_path_for_session_id("session-extra")
    workspace.mkdir(parents=True, exist_ok=True)
    request = SandboxListFilesRequest(
        locator=_locator_with_transitive_dependency(session_id="session-extra", workspace_cwd=str(workspace)),
        path=".",
    )

    class _FakeShellLayer:
        async def run_ephemeral_command(self, script: str, *, timeout: float, extra_env: dict[str, str] | None = None):
            del script, timeout, extra_env
            return sandbox_service_module.ShellCommandResult(
                exit_code=0,
                stdout='{"ok": true, "result": {"path": ".", "entries": [], "truncated": false}}',
                stderr="",
            )

    class _FakeRun:
        def suspend_on_exit(self) -> None:
            return None

        def get_layer(self, name: str, layer_type: object):
            del layer_type
            assert name == "shell"
            return _FakeShellLayer()

    class _FakeCompositor:
        @asynccontextmanager
        async def enter(self, *, configs: dict[str, object], session_snapshot: object):
            del configs, session_snapshot
            yield _FakeRun()

    monkeypatch.setattr(sandbox_service_module, "build_pydantic_ai_compositor", lambda *args, **kwargs: _FakeCompositor())

    async def scenario() -> None:
        response = await _service().list_files(request)
        assert response.path == "."
        assert response.entries == []
        assert response.truncated is False

    try:
        asyncio.run(scenario())
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def test_sandbox_service_accepts_locator_with_custom_shell_and_execution_context_names() -> None:
    workspace = DifyShellLayer.workspace_path_for_session_id("session-custom")
    workspace.mkdir(parents=True, exist_ok=True)
    request = SandboxListFilesRequest(
        locator=_locator_with_custom_shell_and_execution_context_names(
            session_id="session-custom",
            workspace_cwd=str(workspace),
        ),
        path=".",
    )

    async def scenario() -> None:
        response = await _service().list_files(request)
        assert response.path == "."
        assert response.entries == []
        assert response.truncated is False

    try:
        asyncio.run(scenario())
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def test_sandbox_service_rejects_locator_with_unrelated_extra_layer() -> None:
    workspace = DifyShellLayer.workspace_path_for_session_id("session-unrelated")
    workspace.mkdir(parents=True, exist_ok=True)
    locator_payload = _locator(session_id="session-unrelated", workspace_cwd=str(workspace)).model_dump(mode="json")
    locator_payload["composition"]["layers"].append({"name": "rogue", "type": "plain.prompt", "config": {"prefix": "x"}})
    locator_payload["session_snapshot"]["layers"].append(
        {"name": "rogue", "lifecycle_state": "suspended", "runtime_state": {}}
    )
    request = SandboxListFilesRequest(locator=SandboxLocator.model_validate(locator_payload), path=".")

    async def scenario() -> None:
        with pytest.raises(SandboxServiceError, match="outside the shell dependency closure") as exc_info:
            await _service().list_files(request)
        assert exc_info.value.code == "sandbox_not_found"

    try:
        asyncio.run(scenario())
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def test_sandbox_service_malicious_path_does_not_trigger_shell_substitution() -> None:
    session_id = f"session-{uuid4()}"
    workspace = DifyShellLayer.workspace_path_for_session_id(session_id)
    workspace.mkdir(parents=True, exist_ok=True)
    marker = Path("/tmp/opencode") / f"sandbox-path-{uuid4()}"
    request = SandboxListFilesRequest(
        locator=_locator(session_id=session_id, workspace_cwd=str(workspace)),
        path=f"$(touch {marker})",
    )

    async def scenario() -> None:
        with pytest.raises(SandboxServiceError) as exc_info:
            await _service().list_files(request)
        assert exc_info.value.code in {"sandbox_file_not_found", "sandbox_path_invalid"}
        assert not marker.exists()

    try:
        asyncio.run(scenario())
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
def test_sandbox_service_read_file_truncates_without_loading_full_payload() -> None:
    session_id = f"session-{uuid4()}"
    workspace = DifyShellLayer.workspace_path_for_session_id(session_id)
    workspace.mkdir(parents=True, exist_ok=True)
    target = workspace / "large.bin"
    target.write_bytes(b"abcdef")
    request = SandboxReadFileRequest(
        locator=_locator(session_id=session_id, workspace_cwd=str(workspace)),
        path="large.bin",
        encoding="base64",
        max_bytes=3,
    )

    async def scenario() -> None:
        response = await _service().read_file(request)
        assert response.size == 6
        assert response.truncated is True

    try:
        asyncio.run(scenario())
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def test_sandbox_service_upload_rejects_files_over_limit() -> None:
    session_id = f"session-{uuid4()}"
    workspace = DifyShellLayer.workspace_path_for_session_id(session_id)
    workspace.mkdir(parents=True, exist_ok=True)
    target = workspace / "large.txt"
    target.write_bytes(b"abcdef")
    request = SandboxUploadFileRequest(
        locator=_locator(session_id=session_id, workspace_cwd=str(workspace)),
        path="large.txt",
    )
    service = SandboxService(
        layer_providers=create_default_layer_providers(),
        command_timeout_seconds=5.0,
        max_read_bytes=1024,
        max_upload_bytes=3,
    )

    async def scenario() -> None:
        with pytest.raises(SandboxServiceError, match="limited to 3 bytes") as exc_info:
            await service.upload_file(request)
        assert exc_info.value.code == "sandbox_file_too_large"
        assert exc_info.value.status_code == 413

    try:
        asyncio.run(scenario())
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def test_sandbox_service_list_files_truncates_large_directories() -> None:
    session_id = f"session-{uuid4()}"
    workspace = DifyShellLayer.workspace_path_for_session_id(session_id)
    workspace.mkdir(parents=True, exist_ok=True)
    for index in range(1001):
        (workspace / f"file-{index:04d}.txt").write_text("x")
    request = SandboxListFilesRequest(
        locator=_locator(session_id=session_id, workspace_cwd=str(workspace)),
        path=".",
    )

    async def scenario() -> None:
        response = await _service().list_files(request)
        assert len(response.entries) == 1000
        assert response.truncated is True

    try:
        asyncio.run(scenario())
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
