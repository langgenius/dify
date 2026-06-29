from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import cast

import pytest

import dify_agent.layers.shell.layer as shell_layer_module
from dify_agent.layers.shell import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig
from dify_agent.layers.shell.layer import (
    CompleteRemoteCommandResult,
    DEFAULT_TERMINATE_GRACE_SECONDS,
    DifyShellLayer,
    DifyShellRuntimeState,
)
from dify_agent.adapters.shell.protocols import (
    ShellCommandResult,
    ShellCommandStatus,
    ShellFileTransferProtocol,
    ShellProviderProtocol,
    ShellResourceProtocol,
)


def _command_result(
    job_id: str,
    *,
    status: str = "running",
    done: bool = False,
    exit_code: int | None = None,
    output: str = "",
    offset: int = 0,
    truncated: bool = False,
    output_path: str | None = "/tmp/output.log",
) -> ShellCommandResult:
    return ShellCommandResult(
        job_id=job_id,
        status=status,
        done=done,
        exit_code=exit_code,
        output=output,
        offset=offset,
        truncated=truncated,
        output_path=output_path,
    )


def _command_status(
    job_id: str,
    *,
    status: str = "terminated",
    done: bool = True,
    exit_code: int | None = 130,
    offset: int = 0,
) -> ShellCommandStatus:
    return ShellCommandStatus(job_id=job_id, status=status, done=done, exit_code=exit_code, offset=offset)


def _parse_tagged_observation(result: object) -> tuple[dict[str, object], str]:
    assert isinstance(result, str)
    metadata_tag = "\n</metadata>\n\n<output>\n"
    assert result.startswith("<metadata>\n")
    assert result.endswith("\n</output>")
    metadata_block, output_block = result.split(metadata_tag, 1)
    metadata = json.loads(metadata_block.removeprefix("<metadata>\n"))
    assert isinstance(metadata, dict)
    output = output_block.removesuffix("\n</output>")
    return cast(dict[str, object], metadata), output


def _assert_error_observation(result: object, *, job_id: str | None = None, includes: str | None = None) -> None:
    assert isinstance(result, dict)
    assert isinstance(result.get("error"), str)
    if job_id is None:
        assert "job_id" not in result
    else:
        assert result["job_id"] == job_id
    if includes is not None:
        assert includes in result["error"]


@dataclass(slots=True)
class RunCall:
    script: str
    cwd: str | None
    env: Mapping[str, str] | None
    timeout: float


@dataclass(slots=True)
class WaitCall:
    job_id: str
    offset: int
    timeout: float


@dataclass(slots=True)
class InputCall:
    job_id: str
    text: str
    offset: int
    timeout: float


@dataclass(slots=True)
class TailCall:
    job_id: str


@dataclass(slots=True)
class InterruptCall:
    job_id: str
    grace_seconds: float


@dataclass(slots=True)
class DeleteCall:
    job_id: str
    force: bool
    grace_seconds: float | None


class FakeFiles(ShellFileTransferProtocol):
    async def upload(self, *, content: bytes, remote_path: str, cwd: str | None = None) -> None:
        raise AssertionError("resource.files should not be used by production shell layer logic")

    async def download(self, *, remote_path: str, cwd: str | None = None) -> bytes:
        raise AssertionError("resource.files should not be used by production shell layer logic")


@dataclass(slots=True)
class FakeCommands:
    run_handler: Callable[[str, str | None, Mapping[str, str] | None, float], ShellCommandResult] | None = None
    wait_handler: Callable[[str, int, float], ShellCommandResult] | None = None
    input_handler: Callable[[str, str, int, float], ShellCommandResult] | None = None
    tail_handler: Callable[[str], ShellCommandResult] | None = None
    interrupt_handler: Callable[[str, float], ShellCommandStatus] | None = None
    delete_handler: Callable[[str, bool, float | None], None] | None = None
    run_calls: list[RunCall] = field(default_factory=list)
    wait_calls: list[WaitCall] = field(default_factory=list)
    input_calls: list[InputCall] = field(default_factory=list)
    tail_calls: list[TailCall] = field(default_factory=list)
    interrupt_calls: list[InterruptCall] = field(default_factory=list)
    delete_calls: list[DeleteCall] = field(default_factory=list)

    async def run(self, script: str, *, cwd: str | None = None, env: dict[str, str] | None = None, timeout: float):
        self.run_calls.append(RunCall(script=script, cwd=cwd, env=env, timeout=timeout))
        if self.run_handler is None:
            raise AssertionError("Unexpected run() call")
        return self.run_handler(script, cwd, env, timeout)

    async def wait(self, job_id: str, *, offset: int, timeout: float):
        self.wait_calls.append(WaitCall(job_id=job_id, offset=offset, timeout=timeout))
        if self.wait_handler is None:
            raise AssertionError("Unexpected wait() call")
        return self.wait_handler(job_id, offset, timeout)

    async def read_output(self, job_id: str, *, offset: int):
        self.wait_calls.append(WaitCall(job_id=job_id, offset=offset, timeout=0.0))
        if self.wait_handler is None:
            raise AssertionError("Unexpected read_output() call")
        return self.wait_handler(job_id, offset, 0.0)

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float):
        self.input_calls.append(InputCall(job_id=job_id, text=text, offset=offset, timeout=timeout))
        if self.input_handler is None:
            raise AssertionError("Unexpected input() call")
        return self.input_handler(job_id, text, offset, timeout)

    async def interrupt(self, job_id: str, *, grace_seconds: float):
        self.interrupt_calls.append(InterruptCall(job_id=job_id, grace_seconds=grace_seconds))
        if self.interrupt_handler is None:
            raise AssertionError("Unexpected interrupt() call")
        return self.interrupt_handler(job_id, grace_seconds)

    async def tail(self, job_id: str):
        self.tail_calls.append(TailCall(job_id=job_id))
        if self.tail_handler is None:
            raise AssertionError("Unexpected tail() call")
        return self.tail_handler(job_id)

    async def delete(self, job_id: str, *, force: bool = False, grace_seconds: float | None = None) -> None:
        self.delete_calls.append(DeleteCall(job_id=job_id, force=force, grace_seconds=grace_seconds))
        if self.delete_handler is not None:
            self.delete_handler(job_id, force, grace_seconds)


@dataclass(slots=True)
class FakeResource(ShellResourceProtocol):
    commands: FakeCommands
    files: FakeFiles = field(default_factory=FakeFiles)
    closed: bool = False

    async def close(self) -> None:
        self.closed = True


@dataclass(slots=True)
class FakeProvider(ShellProviderProtocol):
    resource: FakeResource
    create_calls: int = 0

    async def create(self) -> ShellResourceProtocol:
        self.create_calls += 1
        return self.resource


def _layer(
    *, commands: FakeCommands, config: DifyShellLayerConfig | None = None
) -> tuple[DifyShellLayer, FakeProvider]:
    provider = FakeProvider(resource=FakeResource(commands=commands))
    layer = DifyShellLayer.from_config_with_settings(config or DifyShellLayerConfig(), shell_provider=provider)
    return layer, provider


def test_shell_type_id_constant_matches_implementation_class() -> None:
    assert DIFY_SHELL_LAYER_TYPE_ID == DifyShellLayer.type_id


def test_resource_context_calls_provider_create_and_resource_close() -> None:
    layer, provider = _layer(commands=FakeCommands())

    async def scenario() -> None:
        async with layer.resource_context():
            assert provider.create_calls == 1
            assert provider.resource.closed is False
        assert provider.resource.closed is True

    asyncio.run(scenario())


def test_shell_layer_create_allocates_workspace_and_bootstraps(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(shell_layer_module.time, "time", lambda: int("abc12", 16))
    monkeypatch.setattr(shell_layer_module.secrets, "token_hex", lambda _nbytes: "ff")

    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> ShellCommandResult:
        assert env is None
        if cwd is None:
            assert 'mkdir -p "$HOME/workspace"' in script
            return _command_result("mkdir-job", status="exited", done=True, exit_code=0)
        assert cwd == "~/workspace/abc12ff"
        assert "apt-get install -y ripgrep" in script
        return _command_result("bootstrap-job", status="exited", done=True, exit_code=0)

    layer, provider = _layer(
        commands=FakeCommands(run_handler=run_handler),
        config=DifyShellLayerConfig(
            cli_tools=[{"name": "ripgrep", "install_commands": ["apt-get install -y ripgrep"]}],
        ),
    )

    async def scenario() -> None:
        async with layer.resource_context():
            await layer.on_context_create()
            assert provider.resource.closed is False

    asyncio.run(scenario())

    assert layer.runtime_state == DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")
    assert [call.job_id for call in provider.resource.commands.delete_calls] == ["mkdir-job", "bootstrap-job"]


def test_shell_layer_suspend_does_not_close_before_resource_context_exits() -> None:
    layer, provider = _layer(commands=FakeCommands())
    layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

    async def scenario() -> None:
        async with layer.resource_context():
            await layer.on_context_suspend()
            assert provider.resource.closed is False
        assert provider.resource.closed is True

    asyncio.run(scenario())


def test_shell_layer_delete_cleans_workspace_and_tracked_jobs() -> None:
    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> ShellCommandResult:
        del env, timeout
        assert cwd is None
        assert script == 'rm -rf -- "$HOME/workspace/abc12ff"'
        return _command_result("cleanup-job", status="exited", done=True, exit_code=0)

    commands = FakeCommands(run_handler=run_handler)
    layer, provider = _layer(commands=commands)
    layer.runtime_state = DifyShellRuntimeState(
        session_id="abc12ff",
        workspace_cwd="~/workspace/abc12ff",
        job_ids=["user-job"],
        job_offsets={"user-job": 9},
    )

    async def scenario() -> None:
        async with layer.resource_context():
            await layer.on_context_delete()

    asyncio.run(scenario())

    assert [call.job_id for call in commands.delete_calls] == ["cleanup-job", "user-job"]
    assert layer.runtime_state.job_ids == []
    assert layer.runtime_state.job_offsets == {}
    assert provider.resource.closed is True


def test_shell_layer_tools_map_inputs_and_maintain_offsets_with_tail_end() -> None:
    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> ShellCommandResult:
        assert script == "pwd"
        assert cwd == "~/workspace/abc12ff"
        assert env is None
        return _command_result(
            "user-job",
            status="running",
            done=False,
            output="head-output\n",
            offset=10,
            truncated=True,
            output_path="/tmp/initial.log",
        )

    def wait_handler(job_id: str, offset: int, timeout: float) -> ShellCommandResult:
        assert job_id == "user-job"
        if timeout == 4.0:
            assert offset == 22
            return _command_result("user-job", status="running", done=False, output="more\n", offset=30)
        raise AssertionError(f"Unexpected wait/read_output: offset={offset} timeout={timeout}")

    def input_handler(job_id: str, text: str, offset: int, timeout: float) -> ShellCommandResult:
        assert (job_id, text, offset, timeout) == ("user-job", "ls\n", 30, 5.0)
        return _command_result("user-job", status="exited", done=True, exit_code=0, output="file.txt\n", offset=34)

    def tail_handler(job_id: str) -> ShellCommandResult:
        assert job_id == "user-job"
        return _command_result(
            job_id,
            status="exited",
            done=True,
            exit_code=0,
            output="tail-output\n",
            offset=22,
            output_path="/tmp/resolved.log",
        )

    def interrupt_handler(job_id: str, grace_seconds: float) -> ShellCommandStatus:
        assert (job_id, grace_seconds) == ("user-job", 1.5)
        return _command_status("user-job", status="terminated", done=True, exit_code=130, offset=34)

    commands = FakeCommands(
        run_handler=run_handler,
        wait_handler=wait_handler,
        input_handler=input_handler,
        tail_handler=tail_handler,
        interrupt_handler=interrupt_handler,
    )
    layer, provider = _layer(commands=commands)
    tools = {tool.name: tool for tool in layer.tools}
    layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

    async def scenario() -> None:
        async with layer.resource_context():
            run_result = await tools["shell_run"].function_schema.call({"script": "pwd"}, None)  # pyright: ignore[reportArgumentType]
            wait_result = await tools["shell_wait"].function_schema.call(
                {"job_id": "user-job", "timeout": 4.0},
                None,  # pyright: ignore[reportArgumentType]
            )
            input_result = await tools["shell_input"].function_schema.call(
                {"job_id": "user-job", "text": "ls\n", "timeout": 5.0},
                None,  # pyright: ignore[reportArgumentType]
            )
            interrupt_result = await tools["shell_interrupt"].function_schema.call(
                {"job_id": "user-job", "grace_seconds": 1.5},
                None,  # pyright: ignore[reportArgumentType]
            )

            run_metadata, run_output = _parse_tagged_observation(run_result)
            wait_metadata, wait_output = _parse_tagged_observation(wait_result)
            input_metadata, input_output = _parse_tagged_observation(input_result)
            interrupt_metadata, interrupt_output = _parse_tagged_observation(interrupt_result)

            assert run_metadata == {
                "job_id": "user-job",
                "status": "running",
                "done": False,
                "exit_code": None,
                "output_path": "/tmp/resolved.log",
            }
            assert "head-output" in run_output
            assert "tail-output" in run_output
            assert wait_metadata["job_id"] == "user-job"
            assert wait_output == "more\n"
            assert input_metadata["exit_code"] == 0
            assert input_output == "file.txt\n"
            assert interrupt_metadata == {
                "job_id": "user-job",
                "status": "terminated",
                "done": True,
                "exit_code": 130,
                "output_path": "/tmp/resolved.log",
            }
            assert interrupt_output == "Job was interrupted."

    asyncio.run(scenario())

    assert layer.runtime_state.job_offsets == {"user-job": 34}
    assert commands.tail_calls == [TailCall(job_id="user-job"), TailCall(job_id="user-job")]
    assert provider.resource.closed is True


def test_shell_run_keeps_original_offset_when_tail_lookup_fails_for_truncated_output() -> None:
    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> ShellCommandResult:
        assert script == "pwd"
        assert cwd == "~/workspace/abc12ff"
        assert env is None
        return _command_result(
            "user-job",
            status="running",
            done=False,
            output="head-output\n",
            offset=10,
            truncated=True,
            output_path="/tmp/current.log",
        )

    def tail_handler(job_id: str) -> ShellCommandResult:
        raise RuntimeError(f"tail unavailable for {job_id}")

    commands = FakeCommands(run_handler=run_handler, tail_handler=tail_handler)
    layer, provider = _layer(commands=commands)
    tools = {tool.name: tool for tool in layer.tools}
    layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

    async def scenario() -> None:
        async with layer.resource_context():
            run_result = await tools["shell_run"].function_schema.call({"script": "pwd"}, None)  # pyright: ignore[reportArgumentType]
            metadata, output = _parse_tagged_observation(run_result)
            assert metadata == {
                "job_id": "user-job",
                "status": "running",
                "done": False,
                "exit_code": None,
                "output_path": "/tmp/current.log",
            }
            assert "head-output" in output
            assert set(metadata) == {"job_id", "status", "done", "exit_code", "output_path"}

    asyncio.run(scenario())

    assert layer.runtime_state.job_offsets == {"user-job": 10}
    assert commands.tail_calls == [TailCall(job_id="user-job")]
    assert provider.resource.closed is True


def test_shell_run_formats_large_non_truncated_output_without_tail_lookup() -> None:
    large_output = ("head-" + ("x" * 9000) + "-tail").replace("head-x", "head-y", 1)
    commands = FakeCommands(
        run_handler=lambda script, cwd, env, timeout: _command_result(
            "user-job",
            status="exited",
            done=True,
            exit_code=0,
            output=large_output,
            offset=len(large_output),
            output_path="/tmp/large.log",
        )
    )
    layer, _provider = _layer(commands=commands)
    tools = {tool.name: tool for tool in layer.tools}
    layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

    async def scenario() -> None:
        async with layer.resource_context():
            result = await tools["shell_run"].function_schema.call({"script": "cat large.log"}, None)  # pyright: ignore[reportArgumentType]
            metadata, output = _parse_tagged_observation(result)
            assert metadata["output_path"] == "/tmp/large.log"
            assert output.startswith("head-y")
            assert output.endswith("(check the /tmp/large.log for full output)")
            assert "-tail" in output

    asyncio.run(scenario())
    assert commands.tail_calls == []


def test_shell_interrupt_succeeds_when_tail_lookup_fails() -> None:
    commands = FakeCommands(
        interrupt_handler=lambda job_id, grace_seconds: _command_status(job_id, offset=22),
        tail_handler=lambda job_id: (_ for _ in ()).throw(RuntimeError("tail unavailable")),
    )
    layer, _provider = _layer(commands=commands)
    tools = {tool.name: tool for tool in layer.tools}
    layer.runtime_state = DifyShellRuntimeState(
        session_id="abc12ff",
        workspace_cwd="~/workspace/abc12ff",
        job_ids=["user-job"],
        job_offsets={"user-job": 22},
    )

    async def scenario() -> None:
        async with layer.resource_context():
            result = await tools["shell_interrupt"].function_schema.call({"job_id": "user-job"}, None)  # pyright: ignore[reportArgumentType]
            metadata, output = _parse_tagged_observation(result)
            assert metadata == {
                "job_id": "user-job",
                "status": "terminated",
                "done": True,
                "exit_code": 130,
            }
            assert output == "Job was interrupted."

    asyncio.run(scenario())


def test_run_remote_script_complete_uses_read_output_before_wait_and_deletes_job() -> None:
    events: list[str] = []

    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> ShellCommandResult:
        events.append("run")
        assert script == "printf 'abcdefghi'"
        assert cwd == "~/workspace/abc12ff"
        assert env is None
        return _command_result("remote-job", status="running", done=False, output="abc", offset=3, truncated=True)

    def wait_handler(job_id: str, offset: int, timeout: float) -> ShellCommandResult:
        if timeout == 0.0:
            events.append("read_output")
            assert offset == 3
            return _command_result(job_id, status="running", done=False, output="def", offset=6)
        events.append("wait")
        assert offset == 6
        return _command_result(job_id, status="exited", done=True, exit_code=0, output="ghi", offset=9)

    commands = FakeCommands(run_handler=run_handler, wait_handler=wait_handler)
    layer, _provider = _layer(commands=commands)
    layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

    async def scenario() -> None:
        async with layer.resource_context():
            result = await layer.run_remote_script_complete("printf 'abcdefghi'")
            assert isinstance(result, CompleteRemoteCommandResult)
            assert result.output == "abcdefghi"
            assert result.output_complete is True
            assert result.incomplete_reason is None

    asyncio.run(scenario())
    assert events == ["run", "read_output", "wait"]
    assert [call.job_id for call in commands.delete_calls] == ["remote-job"]


def test_run_remote_script_complete_returns_incomplete_reason_for_output_limit() -> None:
    commands = FakeCommands(
        run_handler=lambda script, cwd, env, timeout: _command_result(
            "remote-job",
            status="running",
            done=False,
            output="hello world",
            offset=11,
            truncated=True,
        ),
        interrupt_handler=lambda job_id, grace_seconds: _command_status(job_id, status="terminated", offset=11),
    )
    layer, _provider = _layer(commands=commands)
    layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

    async def scenario() -> None:
        async with layer.resource_context():
            result = await layer.run_remote_script_complete("printf 'hello world'", max_output_bytes=5)
            assert result.output == "hello"
            assert result.output_complete is False
            assert result.incomplete_reason == "output_limit"
            assert result.status == "terminated"

    asyncio.run(scenario())
    assert commands.wait_calls == []
    assert commands.interrupt_calls == [
        InterruptCall(job_id="remote-job", grace_seconds=DEFAULT_TERMINATE_GRACE_SECONDS)
    ]


def test_run_remote_script_complete_returns_incomplete_reason_for_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = 100.0

    def fake_monotonic() -> float:
        return now

    monkeypatch.setattr(shell_layer_module.time, "monotonic", fake_monotonic)

    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> ShellCommandResult:
        nonlocal now
        assert script == "sleep 10"
        assert cwd == "~/workspace/abc12ff"
        assert env is None
        assert timeout == pytest.approx(60.0, rel=0, abs=0.01)
        now = 161.0
        return _command_result("remote-job", status="running", done=False, output="hello", offset=5)

    commands = FakeCommands(
        run_handler=run_handler,
        interrupt_handler=lambda job_id, grace_seconds: _command_status(
            job_id,
            status="terminated",
            done=True,
            exit_code=130,
            offset=5,
        ),
    )
    layer, _provider = _layer(commands=commands)
    layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

    async def scenario() -> None:
        async with layer.resource_context():
            result = await layer.run_remote_script_complete("sleep 10", timeout=60.0)
            assert result.output == "hello"
            assert result.output_complete is False
            assert result.incomplete_reason == "timeout"
            assert result.status == "terminated"
            assert result.exit_code == 130

    asyncio.run(scenario())
    assert commands.wait_calls == []
    assert commands.interrupt_calls == [
        InterruptCall(job_id="remote-job", grace_seconds=DEFAULT_TERMINATE_GRACE_SECONDS)
    ]
    assert [call.job_id for call in commands.delete_calls] == ["remote-job"]


def test_shell_layer_rejects_untracked_job_ids_without_provider_calls() -> None:
    commands = FakeCommands()
    layer, _provider = _layer(commands=commands)
    tools = {tool.name: tool for tool in layer.tools}
    layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

    async def scenario() -> None:
        async with layer.resource_context():
            wait_result = await tools["shell_wait"].function_schema.call({"job_id": "missing"}, None)  # pyright: ignore[reportArgumentType]
            input_result = await tools["shell_input"].function_schema.call(
                {"job_id": "missing", "text": "hello"},
                None,  # pyright: ignore[reportArgumentType]
            )
            interrupt_result = await tools["shell_interrupt"].function_schema.call({"job_id": "missing"}, None)  # pyright: ignore[reportArgumentType]
            _assert_error_observation(wait_result, job_id="missing")
            _assert_error_observation(input_result, job_id="missing")
            _assert_error_observation(interrupt_result, job_id="missing")

    asyncio.run(scenario())
    assert commands.wait_calls == []
    assert commands.input_calls == []
    assert commands.interrupt_calls == []


def test_shell_layer_hooks_and_tools_fail_clearly_outside_active_resource_context() -> None:
    layer, _provider = _layer(commands=FakeCommands())
    tools = {tool.name: tool for tool in layer.tools}
    layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

    async def scenario() -> None:
        result = await tools["shell_run"].function_schema.call({"script": "pwd"}, None)  # pyright: ignore[reportArgumentType]
        _assert_error_observation(result, includes="shell resource")

    asyncio.run(scenario())


def test_shell_runtime_state_validates_workspace_identity_and_offset_keys() -> None:
    with pytest.raises(ValueError, match="5\\+2 lowercase hex format"):
        _ = DifyShellRuntimeState.model_validate(
            {
                "session_id": "../../tmp",
                "workspace_cwd": "~/workspace/../../tmp",
                "job_ids": [],
                "job_offsets": {},
            }
        )

    with pytest.raises(ValueError, match="workspace_cwd must equal"):
        _ = DifyShellRuntimeState.model_validate(
            {
                "session_id": "abc12ff",
                "workspace_cwd": "~/workspace/def34aa",
                "job_ids": [],
                "job_offsets": {},
            }
        )

    state = DifyShellRuntimeState.model_validate(
        {
            "session_id": "abc12ff",
            "workspace_cwd": "~/workspace/abc12ff",
            "job_ids": ['job"bad with spaces'],
            "job_offsets": {'job"bad with spaces': 0},
        }
    )
    assert state.job_ids == ['job"bad with spaces']
    with pytest.raises(ValueError, match="unknown job ids"):
        _ = DifyShellRuntimeState.model_validate(
            {
                "session_id": "abc12ff",
                "workspace_cwd": "~/workspace/abc12ff",
                "job_ids": ["job-1"],
                "job_offsets": {"job-2": 3},
            }
        )
