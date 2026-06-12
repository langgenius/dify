from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass

import pytest
from agenton.compositor import CompositorSessionSnapshot, LayerProvider
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.agent_stub.server.shell_agent_stub_env import AGENT_STUB_AUTH_JWE_ENV_VAR, AGENT_STUB_URL_ENV_VAR
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.shell import DifyShellLayerConfig
from dify_agent.layers.shell.layer import DifyShellLayer
from dify_agent.protocol import (
    CreateRunRequest,
    RunComposition,
    RunLayerSpec,
    SandboxLocator,
    SandboxListRequest,
    SandboxReadRequest,
    SandboxUploadRequest,
    build_sandbox_locator_from_run_request,
)
from dify_agent.server.routes.sandbox_files import create_sandbox_files_router
from dify_agent.server.sandbox_files import (
    SandboxFileError,
    SandboxFileService,
    _OUTPUT_BEGIN,
    _OUTPUT_END,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient
from shell_session_manager.shellctl.shared import DeleteJobResponse, JobResult, JobStatusName


@dataclass(slots=True)
class RunCall:
    script: str
    cwd: str | None
    env: Mapping[str, str] | None
    timeout: float


class FakeShellctlClient:
    def __init__(
        self,
        *,
        run_handler: Callable[[str, str | None, Mapping[str, str] | None, float], JobResult],
    ) -> None:
        self.run_handler = run_handler
        self.run_calls: list[RunCall] = []
        self.delete_calls: list[str] = []

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
        timeout: float = 10.0,
    ) -> JobResult:
        self.run_calls.append(RunCall(script=script, cwd=cwd, env=env, timeout=timeout))
        return self.run_handler(script, cwd, env, timeout)

    async def wait(self, job_id: str, *, offset: int, timeout: float = 10.0) -> JobResult:
        raise AssertionError(f"Unexpected wait() call for {job_id} offset={offset} timeout={timeout}")

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float = 10.0) -> JobResult:
        raise AssertionError(f"Unexpected input() call for {job_id} text={text!r}")

    async def terminate(self, job_id: str, grace_seconds: float = 2.0):
        raise AssertionError(f"Unexpected terminate() call for {job_id} grace={grace_seconds}")

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> DeleteJobResponse:
        del force, grace_seconds
        self.delete_calls.append(job_id)
        return DeleteJobResponse(job_id=job_id)

    async def close(self) -> None:
        return None


def _wrap(payload: dict[str, object], *, pty_wrap: int = 0, noise: bool = False) -> str:
    blob = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
    if pty_wrap:
        blob = "\n".join(blob[index : index + pty_wrap] for index in range(0, len(blob), pty_wrap))
    framed = f"{_OUTPUT_BEGIN}{blob}{_OUTPUT_END}\n"
    if noise:
        framed = f"user@host:~/workspace/abc12ff$ python3 - ...\r\n{framed}user@host:~/workspace/abc12ff$ \r\n"
    return framed


def _job_result(*, output: dict[str, object] | str, job_id: str = "sandbox-job") -> JobResult:
    return JobResult(
        job_id=job_id,
        status=JobStatusName.EXITED,
        done=True,
        exit_code=0,
        output=_wrap(output) if isinstance(output, dict) else output,
        offset=0,
        truncated=False,
        output_path="/tmp/sandbox-job.out",
    )


def _failed_job_result(*, output: str, exit_code: int, job_id: str = "sandbox-job") -> JobResult:
    return JobResult(
        job_id=job_id,
        status=JobStatusName.EXITED,
        done=True,
        exit_code=exit_code,
        output=output,
        offset=0,
        truncated=False,
        output_path="/tmp/sandbox-job.out",
    )


def _execution_context() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        app_id="app-1",
        conversation_id="conv-1",
        agent_id="agent-1",
        agent_config_version_id="snapshot-1",
        agent_mode="agent_app",
        invoke_from="service-api",
    )


def _locator() -> SandboxLocator:
    request = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(name="execution_context", type="dify.execution_context", config=_execution_context()),
                RunLayerSpec(
                    name="shell",
                    type="dify.shell",
                    deps={"execution_context": "execution_context"},
                    config=DifyShellLayerConfig(),
                ),
            ]
        ),
        session_snapshot=CompositorSessionSnapshot(
            layers=[
                LayerSessionSnapshot(
                    name="execution_context",
                    lifecycle_state=LifecycleState.SUSPENDED,
                    runtime_state={},
                ),
                LayerSessionSnapshot(
                    name="shell",
                    lifecycle_state=LifecycleState.SUSPENDED,
                    runtime_state={"session_id": "abc12ff", "workspace_cwd": "~/workspace/abc12ff"},
                ),
            ]
        ),
    )
    return build_sandbox_locator_from_run_request(request)


def _service(
    run_handler: Callable[[str, str | None, Mapping[str, str] | None, float], JobResult],
) -> tuple[SandboxFileService, FakeShellctlClient]:
    client = FakeShellctlClient(run_handler=run_handler)
    execution_context_provider = LayerProvider.from_factory(
        layer_type=DifyExecutionContextLayer,
        create=lambda config: DifyExecutionContextLayer.from_config_with_settings(
            DifyExecutionContextLayerConfig.model_validate(config),
            daemon_url="http://plugin-daemon",
            daemon_api_key="daemon-secret",
        ),
    )
    shell_provider = LayerProvider.from_factory(
        layer_type=DifyShellLayer,
        create=lambda config: DifyShellLayer.from_config_with_settings(
            DifyShellLayerConfig.model_validate(config),
            shellctl_entrypoint="http://shellctl",
            shellctl_client_factory=lambda _entrypoint: client,
            agent_stub_url="https://agent.example.com/agent-stub",
            agent_stub_token_factory=lambda execution_context, *, session_id: (
                f"token-for:{execution_context.tenant_id}:{session_id}"
            ),
        ),
    )
    return SandboxFileService(layer_providers=(execution_context_provider, shell_provider)), client


def test_list_files_runs_fixed_script_and_parses_response() -> None:
    service, client = _service(
        lambda script, cwd, env, timeout: _job_result(
            output={
                "path": ".",
                "entries": [{"name": "notes.txt", "type": "file", "size": 5, "mtime": 1}],
                "truncated": False,
            }
        )
    )

    result = asyncio.run(service.list_files(SandboxListRequest(locator=_locator(), path=".")))

    assert result.entries[0].name == "notes.txt"
    assert client.run_calls[0].cwd == "~/workspace/abc12ff"
    assert client.run_calls[0].env is None
    assert "python3 - . 1000 <<'PY'" in client.run_calls[0].script
    assert client.delete_calls == ["sandbox-job"]


@pytest.mark.parametrize("bad_path", ["/etc/passwd", "~/secret-dir", "bad\x00path"])
def test_list_files_rejects_invalid_paths_before_shell_execution(bad_path: str) -> None:
    service, client = _service(
        lambda script, cwd, env, timeout: _job_result(
            output={"path": ".", "entries": [], "truncated": False},
        )
    )

    with pytest.raises(SandboxFileError) as exc_info:
        asyncio.run(service.list_files(SandboxListRequest(locator=_locator(), path=bad_path)))

    assert exc_info.value.code == "invalid_sandbox_path"
    assert client.run_calls == []


def test_decode_tolerates_pty_wrapped_base64_and_shell_noise() -> None:
    service, _client = _service(
        lambda script, cwd, env, timeout: _job_result(
            output=_wrap(
                {
                    "path": "note.txt",
                    "size": 40,
                    "truncated": False,
                    "binary": False,
                    "text": "hello from sandbox\n" * 4,
                },
                pty_wrap=12,
                noise=True,
            )
        )
    )

    result = asyncio.run(service.read_file(SandboxReadRequest(locator=_locator(), path="note.txt")))

    assert result.text == "hello from sandbox\n" * 4


def test_read_file_maps_script_error_codes() -> None:
    service, _client = _service(
        lambda script, cwd, env, timeout: _job_result(
            output={"error": "sandbox_path_not_found", "message": "path not found in sandbox"}
        )
    )

    with pytest.raises(SandboxFileError) as exc_info:
        asyncio.run(service.read_file(SandboxReadRequest(locator=_locator(), path="missing.txt")))

    assert exc_info.value.code == "sandbox_path_not_found"
    assert exc_info.value.status_code == 404


@pytest.mark.parametrize("bad_path", ["", "/etc/passwd", "~/secret.txt", "bad\x00path"])
def test_read_file_rejects_invalid_paths_before_shell_execution(bad_path: str) -> None:
    service, client = _service(
        lambda script, cwd, env, timeout: _job_result(
            output={
                "path": "should-not-run",
                "size": 1,
                "truncated": False,
                "binary": False,
                "text": "x",
            }
        )
    )

    with pytest.raises(SandboxFileError) as exc_info:
        asyncio.run(service.read_file(SandboxReadRequest(locator=_locator(), path=bad_path)))

    assert exc_info.value.code == "invalid_sandbox_path"
    assert client.run_calls == []


def test_read_file_returns_binary_payload_without_text() -> None:
    service, _client = _service(
        lambda script, cwd, env, timeout: _job_result(
            output={
                "path": "blob.bin",
                "size": 64,
                "truncated": False,
                "binary": True,
                "text": None,
            }
        )
    )

    result = asyncio.run(service.read_file(SandboxReadRequest(locator=_locator(), path="blob.bin")))

    assert result.binary is True
    assert result.text is None
    assert result.truncated is False


def test_read_file_preserves_truncated_flag_for_large_text() -> None:
    service, _client = _service(
        lambda script, cwd, env, timeout: _job_result(
            output={
                "path": "large.txt",
                "size": 1024,
                "truncated": True,
                "binary": False,
                "text": "partial preview",
            }
        )
    )

    result = asyncio.run(service.read_file(SandboxReadRequest(locator=_locator(), path="large.txt")))

    assert result.binary is False
    assert result.text == "partial preview"
    assert result.truncated is True


def test_upload_file_injects_agent_stub_env_and_returns_mapping() -> None:
    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> JobResult:
        assert cwd == "~/workspace/abc12ff"
        assert timeout == 30.0
        assert env == {
            AGENT_STUB_URL_ENV_VAR: "https://agent.example.com/agent-stub",
            AGENT_STUB_AUTH_JWE_ENV_VAR: "token-for:tenant-1:abc12ff",
        }
        assert 'dify-agent", "file", "upload"' in script
        return _job_result(
            output={
                "path": "report.txt",
                "file": {"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"},
            },
            job_id="upload-job",
        )

    service, client = _service(run_handler)

    result = asyncio.run(service.upload_file(SandboxUploadRequest(locator=_locator(), path="report.txt")))

    assert result.file.reference == "dify-file-ref:file-1"
    assert client.delete_calls == ["upload-job"]


def test_upload_file_maps_agent_stub_upload_failed_payload() -> None:
    service, _client = _service(
        lambda script, cwd, env, timeout: _job_result(
            output={
                "error": "agent_stub_upload_failed",
                "message": "upload returned invalid JSON",
            },
            job_id="upload-failed-job",
        )
    )

    with pytest.raises(SandboxFileError) as exc_info:
        asyncio.run(service.upload_file(SandboxUploadRequest(locator=_locator(), path="report.txt")))

    assert exc_info.value.code == "agent_stub_upload_failed"
    assert exc_info.value.status_code == 502


def test_read_file_maps_non_zero_command_exit_to_sandbox_command_failed() -> None:
    service, _client = _service(
        lambda script, cwd, env, timeout: _failed_job_result(
            output="python traceback or stderr tail",
            exit_code=17,
        )
    )

    with pytest.raises(SandboxFileError) as exc_info:
        asyncio.run(service.read_file(SandboxReadRequest(locator=_locator(), path="note.txt")))

    assert exc_info.value.code == "sandbox_command_failed"
    assert exc_info.value.status_code == 502


def test_upload_file_maps_missing_framed_payload_to_sandbox_command_failed() -> None:
    service, _client = _service(
        lambda script, cwd, env, timeout: _job_result(output="plain output without sentinel framing")
    )

    with pytest.raises(SandboxFileError) as exc_info:
        asyncio.run(service.upload_file(SandboxUploadRequest(locator=_locator(), path="report.txt")))

    assert exc_info.value.code == "sandbox_command_failed"
    assert exc_info.value.status_code == 502


@pytest.mark.parametrize("bad_path", ["", "/etc/passwd", "~/secret.txt", "bad\x00path"])
def test_upload_file_rejects_invalid_paths_before_shell_execution(bad_path: str) -> None:
    service, client = _service(
        lambda script, cwd, env, timeout: _job_result(
            output={
                "path": "should-not-run",
                "file": {"transfer_method": "tool_file", "reference": "dify-file-ref:file-1"},
            }
        )
    )

    with pytest.raises(SandboxFileError) as exc_info:
        asyncio.run(service.upload_file(SandboxUploadRequest(locator=_locator(), path=bad_path)))

    assert exc_info.value.code == "invalid_sandbox_path"
    assert client.run_calls == []


def _client(service: SandboxFileService | None) -> TestClient:
    app = FastAPI()
    app.include_router(create_sandbox_files_router(lambda: service))
    return TestClient(app)


def test_router_list_ok() -> None:
    service, _client_instance = _service(
        lambda script, cwd, env, timeout: _job_result(output={"path": ".", "entries": [], "truncated": False})
    )

    response = _client(service).post(
        "/sandbox/files/list", json={"locator": _locator().model_dump(mode="json"), "path": "."}
    )

    assert response.status_code == 200
    assert response.json()["path"] == "."


def test_router_returns_503_when_service_unconfigured() -> None:
    response = _client(None).post(
        "/sandbox/files/list", json={"locator": _locator().model_dump(mode="json"), "path": "."}
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "sandbox_backend_unavailable"
