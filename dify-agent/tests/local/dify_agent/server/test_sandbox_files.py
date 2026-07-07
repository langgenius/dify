from __future__ import annotations

import asyncio
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import types
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Literal, cast

import pytest
from agenton.compositor import CompositorSessionSnapshot, LayerProvider
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol, ShellctlProvider
from dify_agent.agent_stub.shell_env import (
    AGENT_STUB_API_BASE_URL_ENV_VAR,
    AGENT_STUB_AUTH_JWE_ENV_VAR,
    AGENT_STUB_DRIVE_BASE_ENV_VAR,
)

if "graphon.model_runtime.entities.llm_entities" not in sys.modules:
    graphon_module = types.ModuleType("graphon")
    model_runtime_module = types.ModuleType("graphon.model_runtime")
    entities_module = types.ModuleType("graphon.model_runtime.entities")
    llm_entities_module = types.ModuleType("graphon.model_runtime.entities.llm_entities")
    message_entities_module = types.ModuleType("graphon.model_runtime.entities.message_entities")

    llm_entities_module.LLMResultChunk = type("LLMResultChunk", (), {})
    llm_entities_module.LLMUsage = type("LLMUsage", (), {})

    for name in (
        "AssistantPromptMessage",
        "AudioPromptMessageContent",
        "DocumentPromptMessageContent",
        "ImagePromptMessageContent",
        "PromptMessage",
        "PromptMessageContentUnionTypes",
        "PromptMessageTool",
        "SystemPromptMessage",
        "TextPromptMessageContent",
        "ToolPromptMessage",
        "UserPromptMessage",
        "VideoPromptMessageContent",
    ):
        setattr(message_entities_module, name, type(name, (), {}))

    sys.modules["graphon"] = graphon_module
    sys.modules["graphon.model_runtime"] = model_runtime_module
    sys.modules["graphon.model_runtime.entities"] = entities_module
    sys.modules["graphon.model_runtime.entities.llm_entities"] = llm_entities_module
    sys.modules["graphon.model_runtime.entities.message_entities"] = message_entities_module

    graphon_module.model_runtime = model_runtime_module
    model_runtime_module.entities = entities_module
    entities_module.llm_entities = llm_entities_module
    entities_module.message_entities = message_entities_module

if "jsonschema" not in sys.modules:
    jsonschema_module = types.ModuleType("jsonschema")
    jsonschema_exceptions_module = types.ModuleType("jsonschema.exceptions")
    jsonschema_protocols_module = types.ModuleType("jsonschema.protocols")
    jsonschema_validators_module = types.ModuleType("jsonschema.validators")

    class _SchemaError(Exception):
        pass

    class _ValidationError(Exception):
        path: tuple[object, ...] = ()

    class _Validator:
        @staticmethod
        def check_schema(schema):
            return None

        def __init__(self, schema):
            self.schema = schema

        def iter_errors(self, value):
            return iter(())

    def _validator_for(schema):
        return _Validator

    jsonschema_module.SchemaError = _SchemaError
    jsonschema_exceptions_module.ValidationError = _ValidationError
    jsonschema_protocols_module.Validator = _Validator
    jsonschema_validators_module.validator_for = _validator_for

    sys.modules["jsonschema"] = jsonschema_module
    sys.modules["jsonschema.exceptions"] = jsonschema_exceptions_module
    sys.modules["jsonschema.protocols"] = jsonschema_protocols_module
    sys.modules["jsonschema.validators"] = jsonschema_validators_module

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
    _LIST_SCRIPT,
    SandboxFileError,
    SandboxFileService,
    _OUTPUT_BEGIN,
    _OUTPUT_END,
    _READ_SCRIPT,
    _UPLOAD_SCRIPT,
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
    env: dict[str, str] | None
    timeout: float


class FakeShellctlClient:
    def __init__(self, *, run_handler: Callable[[str, str | None, dict[str, str] | None, float], _Job]) -> None:
        self.run_handler = run_handler
        self.run_calls: list[RunCall] = []
        self.delete_calls: list[str] = []

    async def run(
        self, script: str, *, cwd: str | None = None, env: dict[str, str] | None = None, timeout: float = 10.0
    ) -> _Job:
        self.run_calls.append(RunCall(script=script, cwd=cwd, env=env, timeout=timeout))
        return self.run_handler(script, cwd, env, timeout)

    async def wait(self, job_id: str, *, offset: int, timeout: float = 10.0) -> _Job:
        raise AssertionError(f"Unexpected wait() call for {job_id} offset={offset} timeout={timeout}")

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float = 10.0) -> _Job:
        raise AssertionError(f"Unexpected input() call for {job_id} text={text!r}")

    async def tail(self, job_id: str) -> _Job:
        raise AssertionError(f"Unexpected tail() call for {job_id}")

    async def terminate(self, job_id: str, grace_seconds: float = 10.0) -> _Job:
        raise AssertionError(f"Unexpected terminate() call for {job_id} grace={grace_seconds}")

    async def delete(self, job_id: str, *, force: bool = False, grace_seconds: float | None = None) -> None:
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


def _run_embedded_script(
    script_source: str,
    *,
    args: list[str],
    cwd: Path,
    env: Mapping[str, str] | None = None,
) -> dict[str, object]:
    merged_env = dict(os.environ)
    if env is not None:
        merged_env.update(env)
    completed = subprocess.run(
        [sys.executable, "-", *args],
        input=script_source,
        text=True,
        capture_output=True,
        cwd=cwd,
        env=merged_env,
        check=False,
    )
    return _decode_sandbox_payload(_complete_result(output=completed.stdout, exit_code=completed.returncode))


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
                LayerSessionSnapshot(
                    name="execution_context", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}
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
    run_handler: Callable[[str, str | None, dict[str, str] | None, float], _Job],
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
                client_factory=lambda: cast(ShellctlClientProtocol, cast(object, client)),
            ),
            agent_stub_api_base_url="https://agent.example.com/agent-stub",
            agent_stub_token_factory=lambda execution_context, *, session_id: (
                f"token-for:{execution_context.tenant_id}:{session_id}"
            ),
        ),
    )
    return SandboxFileService(layer_providers=(execution_context_provider, shell_provider)), client


def _sandbox_python_run_call(client: FakeShellctlClient) -> RunCall:
    for run_call in reversed(client.run_calls):
        if run_call.script.startswith("python3 - "):
            return run_call
    raise AssertionError("sandbox python script was not executed")


def _sandbox_list_entries(payload: dict[str, object]) -> list[object]:
    entries = payload.get("entries")
    assert isinstance(entries, list)
    return entries


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
    script_call = _sandbox_python_run_call(client)
    assert script_call.cwd == "/home/agent-1/workspace/abc12ff"
    assert script_call.env == {"HOME": "/home/agent-1"}
    assert "python3 - . 1000 <<'PY'" in script_call.script
    assert client.delete_calls[-1] == "sandbox-job"


def test_list_files_allows_parent_relative_paths() -> None:
    service, client = _service(
        lambda script, cwd, env, timeout: _Job(
            job_id="sandbox-job",
            output=_wrap({"path": "../shared", "entries": [], "truncated": False}),
        )
    )

    result = asyncio.run(service.list_files(SandboxListRequest(locator=_locator(), path="../shared")))

    assert result.path == "../shared"
    assert "python3 - ../shared 1000 <<'PY'" in _sandbox_python_run_call(client).script


@pytest.mark.parametrize(
    ("path", "expected_command"),
    [
        ("~", "python3 - '~' 1000 <<'PY'"),
        ("~/shared", "python3 - '~/shared' 1000 <<'PY'"),
    ],
)
def test_list_files_allows_home_relative_paths(path: str, expected_command: str) -> None:
    service, client = _service(
        lambda script, cwd, env, timeout: _Job(
            job_id="sandbox-job",
            output=_wrap({"path": path, "entries": [], "truncated": False}),
        )
    )

    result = asyncio.run(service.list_files(SandboxListRequest(locator=_locator(), path=path)))

    assert result.path == path
    assert expected_command in _sandbox_python_run_call(client).script


def test_embedded_scripts_allow_parent_relative_paths(tmp_path: Path) -> None:
    workspace_dir = tmp_path / "workspace"
    cwd = workspace_dir / "run"
    shared_dir = workspace_dir / "shared"
    cwd.mkdir(parents=True)
    shared_dir.mkdir()
    notes_path = shared_dir / "notes.txt"
    notes_path.write_text("hello", encoding="utf-8")

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake_dify_agent = bin_dir / "dify-agent"
    fake_dify_agent.write_text(
        "\n".join(
            [
                "#!/usr/bin/env python3",
                "import json",
                "import sys",
                'if sys.argv[1:] != ["file", "upload", "../shared/notes.txt"]:',
                '    raise SystemExit(f"unexpected args: {sys.argv[1:]!r}")',
                'print(json.dumps({"transfer_method": "tool_file", "reference": "file-ref"}))',
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    fake_dify_agent.chmod(0o755)

    list_payload = _run_embedded_script(_LIST_SCRIPT, args=["../shared", "1000"], cwd=cwd)
    read_payload = _run_embedded_script(_READ_SCRIPT, args=["../shared/notes.txt", "8"], cwd=cwd)
    upload_payload = _run_embedded_script(
        _UPLOAD_SCRIPT,
        args=["../shared/notes.txt"],
        cwd=cwd,
        env={"PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', os.defpath)}"},
    )

    assert list_payload["path"] == "../shared"
    assert any(
        isinstance(entry, dict) and entry.get("name") == "notes.txt" for entry in _sandbox_list_entries(list_payload)
    )
    assert read_payload == {
        "path": "../shared/notes.txt",
        "size": 5,
        "truncated": False,
        "binary": False,
        "text": "hello",
    }
    assert upload_payload == {
        "path": "../shared/notes.txt",
        "file": {"transfer_method": "tool_file", "reference": "file-ref"},
    }


def test_embedded_scripts_expand_home_relative_paths(tmp_path: Path) -> None:
    cwd = tmp_path / "workspace" / "run"
    cwd.mkdir(parents=True)
    home_dir = tmp_path / "home" / "agent-1"
    shared_dir = home_dir / "shared"
    shared_dir.mkdir(parents=True)
    notes_path = shared_dir / "notes.txt"
    notes_path.write_text("hello", encoding="utf-8")

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake_dify_agent = bin_dir / "dify-agent"
    fake_dify_agent.write_text(
        "\n".join(
            [
                "#!/usr/bin/env python3",
                "import json",
                "import sys",
                'if sys.argv[1:] != ["file", "upload", "~/shared/notes.txt"]:',
                '    raise SystemExit(f"unexpected args: {sys.argv[1:]!r}")',
                'print(json.dumps({"transfer_method": "tool_file", "reference": "file-ref"}))',
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    fake_dify_agent.chmod(0o755)

    script_env = {"HOME": str(home_dir), "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', os.defpath)}"}
    list_payload = _run_embedded_script(_LIST_SCRIPT, args=["~/shared", "1000"], cwd=cwd, env=script_env)
    read_payload = _run_embedded_script(_READ_SCRIPT, args=["~/shared/notes.txt", "8"], cwd=cwd, env=script_env)
    upload_payload = _run_embedded_script(_UPLOAD_SCRIPT, args=["~/shared/notes.txt"], cwd=cwd, env=script_env)

    assert list_payload["path"] == "~/shared"
    assert any(
        isinstance(entry, dict) and entry.get("name") == "notes.txt" for entry in _sandbox_list_entries(list_payload)
    )
    assert read_payload == {
        "path": "~/shared/notes.txt",
        "size": 5,
        "truncated": False,
        "binary": False,
        "text": "hello",
    }
    assert upload_payload == {
        "path": "~/shared/notes.txt",
        "file": {"transfer_method": "tool_file", "reference": "file-ref"},
    }


@pytest.mark.parametrize("bad_path", ["/etc/passwd", "~other/secret-dir", "bad\x00path"])
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
        _decode_sandbox_payload(_complete_result(output=broken, output_complete=False, incomplete_reason="timeout"))


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
    script_call = _sandbox_python_run_call(client)
    assert script_call.cwd == "/home/agent-1/workspace/abc12ff"
    assert script_call.env == {
        "HOME": "/home/agent-1",
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
    assert "python3 - notes.txt 8 <<'PY'" in _sandbox_python_run_call(client).script


@pytest.mark.parametrize(
    ("sandbox_request", "expected_command"),
    [
        (SandboxReadRequest(locator=_locator(), path="../notes.txt", max_bytes=8), "python3 - ../notes.txt 8 <<'PY'"),
        (SandboxUploadRequest(locator=_locator(), path="../report.txt"), "python3 - ../report.txt <<'PY'"),
        (SandboxReadRequest(locator=_locator(), path="~/notes.txt", max_bytes=8), "python3 - '~/notes.txt' 8 <<'PY'"),
        (SandboxUploadRequest(locator=_locator(), path="~/report.txt"), "python3 - '~/report.txt' <<'PY'"),
    ],
)
def test_read_and_upload_allow_relative_paths(
    sandbox_request: SandboxReadRequest | SandboxUploadRequest, expected_command: str
) -> None:
    expected_path = sandbox_request.path
    service, client = _service(
        lambda script, cwd, env, timeout: _Job(
            job_id="sandbox-job",
            output=_wrap(
                {"path": expected_path, "size": 5, "truncated": False, "binary": False, "text": "hello"}
                if isinstance(sandbox_request, SandboxReadRequest)
                else {"path": expected_path, "file": {"transfer_method": "tool_file", "reference": "file-ref"}}
            ),
        )
    )

    if isinstance(sandbox_request, SandboxReadRequest):
        result = asyncio.run(service.read_file(sandbox_request))
        assert result.path == expected_path
    else:
        result = asyncio.run(service.upload_file(sandbox_request))
        assert result.path == expected_path

    assert expected_command in _sandbox_python_run_call(client).script
