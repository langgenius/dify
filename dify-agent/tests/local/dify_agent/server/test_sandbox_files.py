from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Literal

import pytest
from agenton.compositor import CompositorSessionSnapshot, LayerProvider
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.adapters.shell.shellctl import ShellctlProvider
from dify_agent.agent_stub.server.shell_agent_stub_env import (
    AGENT_STUB_API_BASE_URL_ENV_VAR,
    AGENT_STUB_AUTH_JWE_ENV_VAR,
    AGENT_STUB_DRIVE_BASE_ENV_VAR,
)
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.shell import DifyShellLayerConfig
from dify_agent.layers.shell.layer import CompleteRemoteCommandResult, DifyShellLayer
from dify_agent.protocol import (
    CreateRunRequest,
    RunComposition,
    RunLayerSpec,
    SandboxListRequest,
    SandboxLocator,
    SandboxReadRequest,
    SandboxUploadRequest,
    build_sandbox_locator_from_run_request,
)
from dify_agent.server.sandbox_files import (
    SandboxFileError,
    SandboxFileService,
    _OUTPUT_BEGIN,
    _OUTPUT_END,
    _decode_sandbox_payload,
    _shell_result_details,
)


@dataclass(slots=True)
class _Job:
    job_id: str
    status: str = "exited"
    done: bool = True
    exit_code: int | None = 0
    output: str = ""
    offset: int = 0
    truncated: bool = False
    output_path: str | None = "/tmp/sandbox-job.out"


@dataclass(slots=True)
class RunCall:
    script: str
    cwd: str | None
    env: Mapping[str, str] | None
    timeout: float


class FakeShellctlClient:
    def __init__(self, *, run_handler: Callable[[str, str | None, Mapping[str, str] | None, float], _Job]) -> None:
        self.run_handler = run_handler
        self.run_calls: list[RunCall] = []
        self.delete_calls: list[str] = []

    async def run(self, script: str, *, cwd: str | None = None, env: Mapping[str, str] | None = None, timeout: float = 10.0):
        self.run_calls.append(RunCall(script=script, cwd=cwd, env=env, timeout=timeout))
        return self.run_handler(script, cwd, env, timeout)

    async def wait(self, job_id: str, *, offset: int, timeout: float = 10.0):
        raise AssertionError(f"Unexpected wait() call for {job_id} offset={offset} timeout={timeout}")

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float = 10.0):
        raise AssertionError(f"Unexpected input() call for {job_id} text={text!r}")

    async def tail(self, job_id: str):
        raise AssertionError(f"Unexpected tail() call for {job_id}")

    async def terminate(self, job_id: str, grace_seconds: float = 10.0):
        raise AssertionError(f"Unexpected terminate() call for {job_id} grace={grace_seconds}")

    async def delete(self, job_id: str, *, force: bool = False, grace_seconds: float | None = None):
        del force, grace_seconds
        self.delete_calls.append(job_id)
        return None

    async def close(self) -> None:
        return None


def _wrap(payload: dict[str, object], *, pty_wrap: int = 0, noise: bool = False) -> str:
    blob = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
    if pty_wrap:
        blob = "\n".join(blob[index : index + pty_wrap] for index in range(0, len(blob), pty_wrap))
    framed = f"{_OUTPUT_BEGIN}{blob}{_OUTPUT_END}\n"
    if noise:
        framed = f"user@host$ python3 - ...\r\n{framed}user@host$ \r\n"
    return framed


def _complete_result(
    *,
    output: str,
    exit_code: int | None = 0,
    output_complete: bool = True,
    incomplete_reason: Literal["output_limit", "timeout"] | None = None,
    job_id: str = "sandbox-job",
) -> CompleteRemoteCommandResult:
    return CompleteRemoteCommandResult(
        job_id=job_id,
        status="exited",
        done=True,
        exit_code=exit_code,
        output=output,
        output_complete=output_complete,
        incomplete_reason=incomplete_reason,
        offset=len(output),
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
                    config=DifyShellLayerConfig(agent_stub_drive_ref="agent-1"),
                ),
            ]
        ),
        session_snapshot=CompositorSessionSnapshot(
            layers=[
                LayerSessionSnapshot(name="execution_context", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
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
    run_handler: Callable[[str, str | None, Mapping[str, str] | None, float], _Job],
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
            shell_provider=ShellctlProvider(
                entrypoint="http://shellctl",
                token="",
                client_factory=lambda: client,
            ),
            agent_stub_api_base_url="https://agent.example.com/agent-stub",
            agent_stub_token_factory=lambda execution_context, *, session_id: (
                f"token-for:{execution_context.tenant_id}:{session_id}"
            ),
        ),
    )
    return SandboxFileService(layer_providers=(execution_context_provider, shell_provider)), client


def test_list_files_runs_fixed_script_and_parses_response() -> None:
    service, client = _service(
        lambda script, cwd, env, timeout: _Job(
            job_id="sandbox-job",
            output=_wrap(
                {
                    "path": ".",
                    "entries": [{"name": "notes.txt", "type": "file", "size": 5, "mtime": 1}],
                    "truncated": False,
                }
            ),
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
    service, client = _service(lambda script, cwd, env, timeout: _Job(job_id="sandbox-job", output="unused"))

    with pytest.raises(SandboxFileError, match="path"):
        asyncio.run(service.list_files(SandboxListRequest(locator=_locator(), path=bad_path)))

    assert client.run_calls == []


def test_decode_payload_reports_incomplete_capture_when_frame_is_missing() -> None:
    with pytest.raises(SandboxFileError, match="incomplete before framed payload was captured"):
        _decode_sandbox_payload(
            _complete_result(output="partial", output_complete=False, incomplete_reason="output_limit")
        )


def test_decode_payload_reports_incomplete_capture_when_frame_is_corrupt() -> None:
    broken = f"{_OUTPUT_BEGIN}%%%%{_OUTPUT_END}"
    with pytest.raises(SandboxFileError, match="incomplete while decoding framed payload"):
        _decode_sandbox_payload(
            _complete_result(output=broken, output_complete=False, incomplete_reason="timeout")
        )


def test_upload_injects_agent_stub_env_and_returns_mapping() -> None:
    service, client = _service(
        lambda script, cwd, env, timeout: _Job(
            job_id="sandbox-job",
            output=_wrap(
                {
                    "path": "report.txt",
                    "file": {"transfer_method": "tool_file", "reference": "file-ref"},
                },
                noise=True,
            ),
        )
    )

    result = asyncio.run(service.upload_file(SandboxUploadRequest(locator=_locator(), path="report.txt")))

    assert result.file.transfer_method == "tool_file"
    assert result.file.reference == "file-ref"
    assert client.run_calls[0].cwd == "~/workspace/abc12ff"
    assert client.run_calls[0].env == {
        AGENT_STUB_API_BASE_URL_ENV_VAR: "https://agent.example.com/agent-stub",
        AGENT_STUB_AUTH_JWE_ENV_VAR: "token-for:tenant-1:abc12ff",
        AGENT_STUB_DRIVE_BASE_ENV_VAR: "/mnt/drive/agent-1",
    }


def test_shell_result_details_include_output_metadata_and_tail() -> None:
    details = _shell_result_details(
        _complete_result(output="hello", output_complete=False, incomplete_reason="output_limit")
    )
    assert "output_complete=False" in details
    assert "incomplete_reason=output_limit" in details
    assert "output_path=/tmp/sandbox-job.out" in details
    assert details.endswith("hello")


def test_read_file_uses_complete_mode_and_parses_response() -> None:
    service, client = _service(
        lambda script, cwd, env, timeout: _Job(
            job_id="sandbox-job",
            output=_wrap({"path": "notes.txt", "size": 5, "truncated": False, "binary": False, "text": "hello"}),
        )
    )

    result = asyncio.run(service.read_file(SandboxReadRequest(locator=_locator(), path="notes.txt", max_bytes=8)))

    assert result.text == "hello"
    assert "python3 - notes.txt 8 <<'PY'" in client.run_calls[0].script
