import asyncio
from collections.abc import Callable, Mapping
import secrets
import time
from dataclasses import dataclass
from typing import cast

import pytest

from agenton.compositor import Compositor, LayerNode, LayerProvider
from agenton.layers import LifecycleState
from dify_agent.agent_stub.server.shell_agent_stub_env import (
    AGENT_STUB_AUTH_JWE_ENV_VAR,
    AGENT_STUB_DRIVE_BASE_ENV_VAR,
    AGENT_STUB_API_BASE_URL_ENV_VAR,
)
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.shell import (
    DIFY_SHELL_LAYER_TYPE_ID,
    DifyShellCliToolConfig,
    DifyShellEnvVarConfig,
    DifyShellLayerConfig,
    DifyShellSandboxConfig,
    DifyShellSecretRefConfig,
)
from dify_agent.adapters.shell.protocols import ShellEnvironmentDescriptor
from dify_agent.layers.shell.layer import DifyShellLayer, DifyShellRuntimeState, ShellctlClientFactory
from shell_session_manager.shellctl.shared import DeleteJobResponse, JobResult, JobStatusName, JobStatusView


def _job_result(
    job_id: str,
    *,
    status: JobStatusName = JobStatusName.RUNNING,
    done: bool = False,
    exit_code: int | None = None,
    output: str = "",
    offset: int = 0,
    truncated: bool = False,
    output_path: str = "/tmp/output.log",
) -> JobResult:
    return JobResult(
        job_id=job_id,
        status=status,
        done=done,
        exit_code=exit_code,
        output=output,
        offset=offset,
        truncated=truncated,
        output_path=output_path,
    )


def _job_status(
    job_id: str,
    *,
    status: JobStatusName = JobStatusName.RUNNING,
    done: bool = False,
    exit_code: int | None = None,
    offset: int = 0,
) -> JobStatusView:
    return JobStatusView(
        job_id=job_id,
        status=status,
        done=done,
        exit_code=exit_code,
        created_at="2026-05-28T12:00:00Z",
        started_at="2026-05-28T12:00:01Z",
        ended_at="2026-05-28T12:00:02Z" if done else None,
        offset=offset,
    )


def _assert_error_observation(result: object, *, job_id: str | None = None, includes: str | None = None) -> None:
    assert isinstance(result, dict)
    assert isinstance(result.get("error"), str)
    assert result["error"]
    if job_id is None:
        assert "job_id" not in result
    else:
        assert result.get("job_id") == job_id
    if includes is not None:
        assert includes in result["error"]


@dataclass(slots=True)
class RunCall:
    script: str
    cwd: str | None
    timeout: float
    env: Mapping[str, str] | None


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
class TerminateCall:
    job_id: str
    grace_seconds: float


@dataclass(slots=True)
class DeleteCall:
    job_id: str
    force: bool
    grace_seconds: float | None


class FakeShellctlClient:
    run_calls: list[RunCall]
    wait_calls: list[WaitCall]
    input_calls: list[InputCall]
    terminate_calls: list[TerminateCall]
    delete_calls: list[DeleteCall]
    events: list[tuple[str, str]]
    closed: bool

    def __init__(
        self,
        *,
        run_handler: Callable[[str, str | None, Mapping[str, str] | None, float], JobResult] | None = None,
        wait_handler: Callable[[str, int, float], JobResult] | None = None,
        input_handler: Callable[[str, str, int, float], JobResult] | None = None,
        terminate_handler: Callable[[str, float], JobStatusView] | None = None,
        delete_handler: Callable[[str, bool, float | None], DeleteJobResponse] | None = None,
    ) -> None:
        self._run_handler = run_handler
        self._wait_handler = wait_handler
        self._input_handler = input_handler
        self._terminate_handler = terminate_handler
        self._delete_handler = delete_handler
        self.run_calls = []
        self.wait_calls = []
        self.input_calls = []
        self.terminate_calls = []
        self.delete_calls = []
        self.events = []
        self.closed = False

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
        timeout: float = 10.0,
    ) -> JobResult:
        self.run_calls.append(RunCall(script=script, cwd=cwd, timeout=timeout, env=env))
        self.events.append(("run", script))
        if self._run_handler is None:
            raise AssertionError("Unexpected run() call")
        return self._run_handler(script, cwd, env, timeout)

    async def wait(self, job_id: str, *, offset: int, timeout: float = 10.0) -> JobResult:
        self.wait_calls.append(WaitCall(job_id=job_id, offset=offset, timeout=timeout))
        self.events.append(("wait", job_id))
        if self._wait_handler is None:
            raise AssertionError("Unexpected wait() call")
        return self._wait_handler(job_id, offset, timeout)

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float = 10.0) -> JobResult:
        self.input_calls.append(InputCall(job_id=job_id, text=text, offset=offset, timeout=timeout))
        self.events.append(("input", job_id))
        if self._input_handler is None:
            raise AssertionError("Unexpected input() call")
        return self._input_handler(job_id, text, offset, timeout)

    async def terminate(self, job_id: str, grace_seconds: float = 2.0) -> JobStatusView:
        self.terminate_calls.append(TerminateCall(job_id=job_id, grace_seconds=grace_seconds))
        self.events.append(("terminate", job_id))
        if self._terminate_handler is None:
            raise AssertionError("Unexpected terminate() call")
        return self._terminate_handler(job_id, grace_seconds)

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> DeleteJobResponse:
        self.delete_calls.append(DeleteCall(job_id=job_id, force=force, grace_seconds=grace_seconds))
        self.events.append(("delete", job_id))
        if self._delete_handler is None:
            return DeleteJobResponse(job_id=job_id)
        return self._delete_handler(job_id, force, grace_seconds)

    async def close(self) -> None:
        self.closed = True
        self.events.append(("close", "client"))


def _shell_layer(
    *, client_factory: ShellctlClientFactory, config: DifyShellLayerConfig | None = None
) -> DifyShellLayer:
    return DifyShellLayer.from_config_with_settings(
        config or DifyShellLayerConfig(),
        shellctl_entrypoint="http://shellctl",
        shellctl_client_factory=client_factory,
    )


def _execution_context_layer() -> DifyExecutionContextLayer:
    return DifyExecutionContextLayer.from_config_with_settings(
        DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="account",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_run_id="workflow-run-1",
            node_id="node-1",
            node_execution_id="node-execution-1",
            conversation_id="conversation-1",
            agent_id="agent-1",
            agent_config_version_id="agent-config-version-1",
            agent_mode="workflow_run",
            invoke_from="service-api",
            trace_id="trace-1",
        ),
        daemon_url="http://plugin-daemon",
        daemon_api_key="daemon-secret",
    )


def _shell_provider(*, client_factory: ShellctlClientFactory) -> LayerProvider[DifyShellLayer]:
    return LayerProvider.from_factory(
        layer_type=DifyShellLayer,
        create=lambda config: DifyShellLayer.from_config_with_settings(
            DifyShellLayerConfig.model_validate(config),
            shellctl_entrypoint="http://shellctl",
            shellctl_client_factory=client_factory,
        ),
    )


def test_shell_type_id_constant_matches_implementation_class() -> None:
    assert DIFY_SHELL_LAYER_TYPE_ID == DifyShellLayer.type_id


def test_environment_descriptor_returns_workspace_seed_from_runtime_state() -> None:
    layer = _shell_layer(client_factory=lambda _entrypoint: FakeShellctlClient())
    layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

    descriptor = layer.environment_descriptor()

    assert descriptor == ShellEnvironmentDescriptor(workspace_cwd="~/workspace/abc12ff", session_id="abc12ff")


def test_environment_descriptor_raises_without_session_identity() -> None:
    layer = _shell_layer(client_factory=lambda _entrypoint: FakeShellctlClient())

    with pytest.raises(ValueError, match="session_id or workspace_cwd"):
        _ = layer.environment_descriptor()


def test_shell_layer_create_generates_5_plus_2_hex_session_id_and_retries_workspace_collision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    random_suffixes = iter(["aa", "bb"])
    monkeypatch.setattr(time, "time", lambda: 0x12345F)
    monkeypatch.setattr(secrets, "token_hex", lambda nbytes: next(random_suffixes))

    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> JobResult:
        assert cwd is None
        assert env is None
        assert timeout == 30.0
        if "2345faa" in script:
            return _job_result("mkdir-collision", status=JobStatusName.EXITED, done=True, exit_code=17)
        if "2345fbb" in script:
            return _job_result("mkdir-success", status=JobStatusName.RUNNING, done=False, offset=4)
        raise AssertionError(f"Unexpected script: {script}")

    def wait_handler(job_id: str, offset: int, timeout: float) -> JobResult:
        assert job_id == "mkdir-success"
        assert offset == 4
        assert timeout == 30.0
        return _job_result("mkdir-success", status=JobStatusName.EXITED, done=True, exit_code=0, offset=8)

    client = FakeShellctlClient(run_handler=run_handler, wait_handler=wait_handler)
    layer = _shell_layer(client_factory=lambda _entrypoint: client)

    async def scenario() -> None:
        async with layer.resource_context():
            await layer.on_context_create()
            assert client.closed is False

    asyncio.run(scenario())

    assert layer.runtime_state.session_id == "2345fbb"
    assert layer.runtime_state.workspace_cwd == "~/workspace/2345fbb"
    assert layer.runtime_state.job_ids == ["mkdir-collision", "mkdir-success"]
    assert layer.runtime_state.job_offsets == {"mkdir-collision": 0, "mkdir-success": 8}
    assert 'mkdir "$HOME/workspace/2345fbb"' in client.run_calls[1].script
    assert 'mkdir -p "$HOME/workspace/2345fbb"' not in client.run_calls[1].script
    assert client.closed is True


def test_shell_layer_suspend_leaves_client_open_until_resource_context_exits() -> None:
    client = FakeShellctlClient()
    layer = _shell_layer(client_factory=lambda _entrypoint: client)
    layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

    async def scenario() -> None:
        async with layer.resource_context():
            await layer.on_context_suspend()
            assert client.closed is False

    asyncio.run(scenario())

    assert client.closed is True


def test_shell_layer_suspend_and_resume_reuse_state_with_fresh_clients() -> None:
    first_client = FakeShellctlClient(
        run_handler=lambda _script, _cwd, _env, _timeout: _job_result(
            "mkdir-job",
            status=JobStatusName.EXITED,
            done=True,
            exit_code=0,
        )
    )
    second_client = FakeShellctlClient()
    created_entrypoints: list[str] = []
    clients = iter([first_client, second_client])

    def factory(entrypoint: str) -> FakeShellctlClient:
        created_entrypoints.append(entrypoint)
        return next(clients)

    compositor = Compositor([LayerNode("shell", _shell_provider(client_factory=factory))])

    async def scenario() -> None:
        async with compositor.enter(configs={"shell": DifyShellLayerConfig()}) as run:
            shell_layer = run.get_layer("shell", DifyShellLayer)
            initial_session_id = shell_layer.runtime_state.session_id
            assert initial_session_id is not None
            assert shell_layer.runtime_state.workspace_cwd == f"~/workspace/{initial_session_id}"
            shell_layer.runtime_state.job_ids = [*shell_layer.runtime_state.job_ids, "user-job"]
            shell_layer.runtime_state.job_offsets = {
                **shell_layer.runtime_state.job_offsets,
                "user-job": 42,
            }
            assert first_client.closed is False
            run.suspend_layer_on_exit("shell")

        assert run.session_snapshot is not None
        assert first_client.closed is True
        assert run.session_snapshot.layers[0].lifecycle_state is LifecycleState.SUSPENDED

        async with compositor.enter(
            configs={"shell": DifyShellLayerConfig()},
            session_snapshot=run.session_snapshot,
        ) as resumed_run:
            resumed_shell = resumed_run.get_layer("shell", DifyShellLayer)
            assert second_client.closed is False
            assert resumed_shell.runtime_state.session_id == initial_session_id
            assert resumed_shell.runtime_state.workspace_cwd == f"~/workspace/{initial_session_id}"
            assert set(resumed_shell.runtime_state.job_ids) == {"mkdir-job", "user-job"}
            assert resumed_shell.runtime_state.job_offsets == {"mkdir-job": 0, "user-job": 42}
            resumed_run.suspend_layer_on_exit("shell")

        assert second_client.closed is True

    asyncio.run(scenario())

    assert created_entrypoints == ["http://shellctl", "http://shellctl"]


def test_shell_layer_delete_removes_workspace_then_force_deletes_tracked_jobs_and_closes_client() -> None:
    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> JobResult:
        assert script == 'rm -rf -- "$HOME/workspace/abc12ff"'
        assert cwd is None
        assert env is None
        assert timeout == 30.0
        return _job_result("cleanup-job", status=JobStatusName.RUNNING, done=False, offset=3)

    def wait_handler(job_id: str, offset: int, timeout: float) -> JobResult:
        assert job_id == "cleanup-job"
        assert offset == 3
        assert timeout == 30.0
        return _job_result("cleanup-job", status=JobStatusName.EXITED, done=True, exit_code=0, offset=5)

    client = FakeShellctlClient(run_handler=run_handler, wait_handler=wait_handler)
    layer = _shell_layer(client_factory=lambda _entrypoint: client)

    async def scenario() -> None:
        async with layer.resource_context():
            layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")
            layer.runtime_state.job_ids = ["user-job", "mkdir-job"]
            layer.runtime_state.job_offsets = {"user-job": 9, "mkdir-job": 1}
            await layer.on_context_delete()
            assert client.closed is False

    asyncio.run(scenario())

    assert client.events[:2] == [("run", 'rm -rf -- "$HOME/workspace/abc12ff"'), ("wait", "cleanup-job")]
    assert {call.job_id for call in client.delete_calls} == {"user-job", "mkdir-job", "cleanup-job"}
    assert all(
        client.events.index(("delete", call.job_id)) > client.events.index(("wait", "cleanup-job"))
        for call in client.delete_calls
    )
    assert all(call.force is True for call in client.delete_calls)
    assert layer.runtime_state.job_ids == []
    assert layer.runtime_state.job_offsets == {}
    assert client.closed is True


def test_shell_layer_create_failure_force_deletes_internal_jobs_before_reraising() -> None:
    client = FakeShellctlClient(
        run_handler=lambda _script, _cwd, _env, _timeout: _job_result(
            "mkdir-failed",
            status=JobStatusName.EXITED,
            done=True,
            exit_code=1,
        )
    )
    layer = _shell_layer(client_factory=lambda _entrypoint: client)

    async def scenario() -> None:
        with pytest.raises(RuntimeError, match="Failed to create shell workspace"):
            async with layer.resource_context():
                await layer.on_context_create()

    asyncio.run(scenario())

    assert [call.job_id for call in client.delete_calls] == ["mkdir-failed"]
    assert all(call.force is True for call in client.delete_calls)
    assert layer.runtime_state.job_ids == []
    assert layer.runtime_state.job_offsets == {}
    assert client.closed is True


def test_shell_layer_create_bootstraps_agent_soul_shell_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(time, "time", lambda: 0xABC12)
    monkeypatch.setattr(secrets, "token_hex", lambda _nbytes: "ff")

    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> JobResult:
        assert env is None
        if cwd is None:
            assert timeout == 30.0
            return _job_result("mkdir-job", status=JobStatusName.EXITED, done=True, exit_code=0)
        assert cwd == "~/workspace/abc12ff"
        assert "export PROJECT_NAME='demo project'" in script
        assert "export QUOTED='it'\\''s ok'" in script
        assert 'export OPENAI_API_KEY="${OPENAI_API_KEY:-}"' in script
        assert "export RG_CONFIG_PATH='.ripgreprc'" in script
        assert 'export GITHUB_TOKEN="${GITHUB_TOKEN:-}"' in script
        assert "export DIFY_SANDBOX_PROVIDER='independent'" in script
        assert "export DIFY_SANDBOX_CONFIG_JSON='{\"cpu\": 2}'" in script
        assert "apt-get install -y ripgrep" in script
        return _job_result("bootstrap-job", status=JobStatusName.EXITED, done=True, exit_code=0)

    client = FakeShellctlClient(run_handler=run_handler)
    layer = _shell_layer(
        client_factory=lambda _entrypoint: client,
        config=DifyShellLayerConfig(
            cli_tools=[
                DifyShellCliToolConfig(
                    name="ripgrep",
                    install_commands=["apt-get install -y ripgrep"],
                    env=[DifyShellEnvVarConfig(name="RG_CONFIG_PATH", value=".ripgreprc")],
                    secret_refs=[DifyShellSecretRefConfig(name="GITHUB_TOKEN", ref="secret-2")],
                )
            ],
            env=[
                DifyShellEnvVarConfig(name="PROJECT_NAME", value="demo project"),
                DifyShellEnvVarConfig(name="QUOTED", value="it's ok"),
            ],
            secret_refs=[DifyShellSecretRefConfig(name="OPENAI_API_KEY", ref="secret-1")],
            sandbox=DifyShellSandboxConfig(provider="independent", config={"cpu": 2}),
        ),
    )

    async def scenario() -> None:
        async with layer.resource_context():
            await layer.on_context_create()

    asyncio.run(scenario())

    assert [call.cwd for call in client.run_calls] == [None, "~/workspace/abc12ff"]
    assert layer.runtime_state.job_ids == ["mkdir-job", "bootstrap-job"]


def test_shell_layer_injects_agent_soul_env_without_workspace_env_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(time, "time", lambda: 0xABC12)

    def token_hex(_nbytes: int) -> str:
        return "ff"

    monkeypatch.setattr(secrets, "token_hex", token_hex)

    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> JobResult:
        del timeout
        assert env is None
        if cwd is None:
            return _job_result("mkdir-job", status=JobStatusName.EXITED, done=True, exit_code=0)

        assert cwd == "~/workspace/abc12ff"
        assert "export PROJECT_NAME='demo project'" in script
        assert 'export OPENAI_API_KEY="${OPENAI_API_KEY:-}"' in script
        assert "export DIFY_SANDBOX_PROVIDER='independent'" in script
        assert "export DIFY_SANDBOX_CONFIG_JSON='{\"cpu\": 2}'" in script
        assert script.endswith("\npwd")
        return _job_result("user-job", status=JobStatusName.EXITED, done=True, exit_code=0)

    client = FakeShellctlClient(run_handler=run_handler)
    layer = _shell_layer(
        client_factory=lambda _entrypoint: client,
        config=DifyShellLayerConfig(
            env=[DifyShellEnvVarConfig(name="PROJECT_NAME", value="demo project")],
            secret_refs=[DifyShellSecretRefConfig(name="OPENAI_API_KEY", ref="secret-1")],
            sandbox=DifyShellSandboxConfig(provider="independent", config={"cpu": 2}),
        ),
    )
    tools = {tool.name: tool for tool in layer.tools}

    async def scenario() -> None:
        async with layer.resource_context():
            await layer.on_context_create()
            run_result = cast(
                Mapping[str, object],
                await tools["shell_run"].function_schema.call(
                    {"script": "pwd"},
                    None,  # pyright: ignore[reportArgumentType]
                ),
            )
            assert run_result["job_id"] == "user-job"

    asyncio.run(scenario())

    assert [call.cwd for call in client.run_calls] == [None, "~/workspace/abc12ff"]
    assert layer.runtime_state.job_ids == ["mkdir-job", "user-job"]


def test_shell_layer_tools_map_inputs_to_shellctl_calls_and_maintain_offsets() -> None:
    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> JobResult:
        assert script == "pwd"
        assert cwd == "~/workspace/abc12ff"
        assert env is None
        assert timeout == 2.5
        return _job_result(
            "user-job",
            status=JobStatusName.RUNNING,
            done=False,
            offset=10,
            output="/home/test\n",
        )

    def wait_handler(job_id: str, offset: int, timeout: float) -> JobResult:
        assert job_id == "user-job"
        assert offset == 10
        assert timeout == 4.0
        return _job_result(
            "user-job",
            status=JobStatusName.RUNNING,
            done=False,
            offset=18,
            output="more\n",
        )

    def input_handler(job_id: str, text: str, offset: int, timeout: float) -> JobResult:
        assert job_id == "user-job"
        assert text == "ls\n"
        assert offset == 18
        assert timeout == 5.0
        return _job_result(
            "user-job",
            status=JobStatusName.EXITED,
            done=True,
            exit_code=0,
            offset=22,
            output="file.txt\n",
        )

    def terminate_handler(job_id: str, grace_seconds: float) -> JobStatusView:
        assert job_id == "user-job"
        assert grace_seconds == 1.5
        return _job_status(
            "user-job",
            status=JobStatusName.TERMINATED,
            done=True,
            exit_code=130,
            offset=22,
        )

    client = FakeShellctlClient(
        run_handler=run_handler,
        wait_handler=wait_handler,
        input_handler=input_handler,
        terminate_handler=terminate_handler,
    )
    layer = _shell_layer(client_factory=lambda _entrypoint: client)
    tools = {tool.name: tool for tool in layer.tools}

    async def scenario() -> None:
        async with layer.resource_context():
            layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

            run_tool_def = await tools["shell_run"].prepare_tool_def(None)  # pyright: ignore[reportArgumentType]
            wait_tool_def = await tools["shell_wait"].prepare_tool_def(None)  # pyright: ignore[reportArgumentType]
            input_tool_def = await tools["shell_input"].prepare_tool_def(None)  # pyright: ignore[reportArgumentType]
            interrupt_tool_def = await tools["shell_interrupt"].prepare_tool_def(None)  # pyright: ignore[reportArgumentType]

            run_result = await tools["shell_run"].function_schema.call(
                {"script": "pwd", "timeout": 2.5},
                None,  # pyright: ignore[reportArgumentType]
            )
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

            assert run_tool_def is not None
            assert wait_tool_def is not None
            assert input_tool_def is not None
            assert interrupt_tool_def is not None
            assert "offset" not in run_tool_def.parameters_json_schema.get("properties", {})
            assert "offset" not in wait_tool_def.parameters_json_schema.get("properties", {})
            assert "offset" not in input_tool_def.parameters_json_schema.get("properties", {})
            assert "offset" not in interrupt_tool_def.parameters_json_schema.get("properties", {})
            assert set(tools) == {"shell_run", "shell_wait", "shell_input", "shell_interrupt"}
            assert run_result["job_id"] == "user-job"
            assert run_result["offset"] == 10
            assert wait_result["offset"] == 18
            assert input_result["offset"] == 22
            assert interrupt_result == {
                "job_id": "user-job",
                "status": "terminated",
                "done": True,
                "exit_code": 130,
                "offset": 22,
            }
            assert client.closed is False

    asyncio.run(scenario())

    assert layer.runtime_state.job_ids == ["user-job"]
    assert layer.runtime_state.job_offsets == {"user-job": 22}
    assert client.closed is True


def test_shell_layer_injects_agent_stub_env_only_for_user_visible_shell_run() -> None:
    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> JobResult:
        del cwd, timeout
        if script == "pwd":
            assert env is not None
            return _job_result("user-job", status=JobStatusName.EXITED, done=True, exit_code=0)
        assert env is None
        return _job_result("mkdir-job", status=JobStatusName.EXITED, done=True, exit_code=0)

    client = FakeShellctlClient(run_handler=run_handler)
    layer = DifyShellLayer.from_config_with_settings(
        DifyShellLayerConfig(agent_stub_drive_ref="agent-1"),
        shellctl_entrypoint="http://shellctl",
        shellctl_client_factory=lambda _entrypoint: client,
        agent_stub_api_base_url="https://agent.example.com/agent-stub",
        agent_stub_token_factory=lambda execution_context, *, session_id: (
            f"token-for:{execution_context.tenant_id}:{session_id}"
        ),
    )
    layer.deps = layer.deps_type(execution_context=_execution_context_layer())
    tools = {tool.name: tool for tool in layer.tools}

    async def scenario() -> None:
        async with layer.resource_context():
            await layer.on_context_create()
            run_result = await tools["shell_run"].function_schema.call(
                {"script": "pwd"},
                None,  # pyright: ignore[reportArgumentType]
            )
            assert run_result["job_id"] == "user-job"

    asyncio.run(scenario())

    user_run_call = next(call for call in client.run_calls if call.script == "pwd")
    internal_run_calls = [call for call in client.run_calls if call.script != "pwd"]

    assert user_run_call.env == {
        AGENT_STUB_API_BASE_URL_ENV_VAR: "https://agent.example.com/agent-stub",
        AGENT_STUB_AUTH_JWE_ENV_VAR: f"token-for:tenant-1:{layer.runtime_state.session_id}",
        AGENT_STUB_DRIVE_BASE_ENV_VAR: "/mnt/drive/agent-1",
    }
    assert internal_run_calls
    assert all(call.env is None for call in internal_run_calls)


def test_run_remote_script_uses_workspace_cwd_accumulates_output_and_deletes_job() -> None:
    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> JobResult:
        assert '. ".dify/env.sh"' not in script
        assert script == "printf 'hello world'"
        assert cwd == "~/workspace/abc12ff"
        assert env is None
        assert timeout == 7.5
        return _job_result(
            "remote-job",
            status=JobStatusName.RUNNING,
            done=False,
            output="hello ",
            offset=6,
            truncated=True,
        )

    def wait_handler(job_id: str, offset: int, timeout: float) -> JobResult:
        assert job_id == "remote-job"
        assert offset == 6
        assert timeout == 7.5
        return _job_result(
            "remote-job",
            status=JobStatusName.EXITED,
            done=True,
            exit_code=0,
            output="world",
            offset=11,
        )

    client = FakeShellctlClient(run_handler=run_handler, wait_handler=wait_handler)
    layer = _shell_layer(client_factory=lambda _entrypoint: client)

    async def scenario() -> None:
        async with layer.resource_context():
            layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")
            result = await layer.run_remote_script("printf 'hello world'", timeout=7.5)
            assert result.output == "hello world"
            assert result.exit_code == 0
            assert result.truncated is False

    asyncio.run(scenario())

    assert [call.job_id for call in client.delete_calls] == ["remote-job"]
    assert layer.runtime_state.job_ids == []
    assert layer.runtime_state.job_offsets == {}


def test_run_remote_script_deletes_job_even_when_command_exits_non_zero() -> None:
    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> JobResult:
        assert script == "exit 17"
        assert cwd == "~/workspace/abc12ff"
        assert env is None
        assert timeout == 3.0
        return _job_result(
            "remote-failed-job",
            status=JobStatusName.EXITED,
            done=True,
            exit_code=17,
            output="failed\n",
            offset=7,
        )

    client = FakeShellctlClient(run_handler=run_handler)
    layer = _shell_layer(client_factory=lambda _entrypoint: client)

    async def scenario() -> None:
        async with layer.resource_context():
            layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")
            result = await layer.run_remote_script("exit 17", timeout=3.0)
            assert result.exit_code == 17
            assert result.output == "failed\n"

    asyncio.run(scenario())

    assert [call.job_id for call in client.delete_calls] == ["remote-failed-job"]
    assert layer.runtime_state.job_ids == []
    assert layer.runtime_state.job_offsets == {}


def test_run_remote_script_can_inject_agent_stub_env_for_server_owned_uploads() -> None:
    def run_handler(script: str, cwd: str | None, env: Mapping[str, str] | None, timeout: float) -> JobResult:
        assert script == "dify-agent file upload report.txt"
        assert '. ".dify/env.sh"' not in script
        del timeout
        assert cwd == "~/workspace/abc12ff"
        assert env == {
            AGENT_STUB_API_BASE_URL_ENV_VAR: "https://agent.example.com/agent-stub",
            AGENT_STUB_AUTH_JWE_ENV_VAR: "token-for:tenant-1:abc12ff",
            AGENT_STUB_DRIVE_BASE_ENV_VAR: "/mnt/drive/agent-1",
        }
        return _job_result("remote-upload", status=JobStatusName.EXITED, done=True, exit_code=0, output="{}")

    client = FakeShellctlClient(run_handler=run_handler)
    layer = DifyShellLayer.from_config_with_settings(
        DifyShellLayerConfig(agent_stub_drive_ref="agent-1"),
        shellctl_entrypoint="http://shellctl",
        shellctl_client_factory=lambda _entrypoint: client,
        agent_stub_api_base_url="https://agent.example.com/agent-stub",
        agent_stub_token_factory=lambda execution_context, *, session_id: (
            f"token-for:{execution_context.tenant_id}:{session_id}"
        ),
    )
    layer.deps = layer.deps_type(execution_context=_execution_context_layer())

    async def scenario() -> None:
        async with layer.resource_context():
            layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")
            _ = await layer.run_remote_script("dify-agent file upload report.txt", inject_agent_stub_env=True)

    asyncio.run(scenario())

    assert [call.job_id for call in client.delete_calls] == ["remote-upload"]


def test_run_remote_script_raises_when_agent_stub_env_is_unavailable() -> None:
    client = FakeShellctlClient(
        run_handler=lambda _script, _cwd, _env, _timeout: _job_result(
            "unexpected-run",
            status=JobStatusName.EXITED,
            done=True,
            exit_code=0,
        )
    )
    layer = DifyShellLayer.from_config_with_settings(
        DifyShellLayerConfig(),
        shellctl_entrypoint="http://shellctl",
        shellctl_client_factory=lambda _entrypoint: client,
        agent_stub_api_base_url="https://agent.example.com/agent-stub",
        agent_stub_token_factory=lambda execution_context, *, session_id: (
            f"token-for:{execution_context.tenant_id}:{session_id}"
        ),
    )

    async def scenario() -> None:
        async with layer.resource_context():
            layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")
            with pytest.raises(RuntimeError, match="Agent Stub environment injection is not available"):
                await layer.run_remote_script("dify-agent file upload report.txt", inject_agent_stub_env=True)

    asyncio.run(scenario())

    assert client.run_calls == []


def test_shell_layer_skips_agent_stub_env_without_execution_context_dependency() -> None:
    client = FakeShellctlClient(
        run_handler=lambda _script, _cwd, _env, _timeout: _job_result(
            "user-job",
            status=JobStatusName.EXITED,
            done=True,
            exit_code=0,
        )
    )
    layer = DifyShellLayer.from_config_with_settings(
        DifyShellLayerConfig(),
        shellctl_entrypoint="http://shellctl",
        shellctl_client_factory=lambda _entrypoint: client,
        agent_stub_api_base_url="https://agent.example.com/agent-stub",
        agent_stub_token_factory=lambda execution_context, *, session_id: (
            f"token-for:{execution_context.tenant_id}:{session_id}"
        ),
    )
    tools = {tool.name: tool for tool in layer.tools}

    async def scenario() -> None:
        async with layer.resource_context():
            layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")
            _ = await tools["shell_run"].function_schema.call(
                {"script": "pwd"},
                None,  # pyright: ignore[reportArgumentType]
            )

    asyncio.run(scenario())

    assert client.run_calls[0].env is None


def test_shell_layer_tools_reject_untracked_job_ids_without_shellctl_calls() -> None:
    client = FakeShellctlClient()
    layer = _shell_layer(client_factory=lambda _entrypoint: client)
    tools = {tool.name: tool for tool in layer.tools}

    async def scenario() -> None:
        async with layer.resource_context():
            layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")

            wait_result = await tools["shell_wait"].function_schema.call(
                {"job_id": "missing-job"},
                None,  # pyright: ignore[reportArgumentType]
            )
            input_result = await tools["shell_input"].function_schema.call(
                {"job_id": "missing-job", "text": "hello"},
                None,  # pyright: ignore[reportArgumentType]
            )
            interrupt_result = await tools["shell_interrupt"].function_schema.call(
                {"job_id": "missing-job"},
                None,  # pyright: ignore[reportArgumentType]
            )

            _assert_error_observation(wait_result, job_id="missing-job")
            _assert_error_observation(input_result, job_id="missing-job")
            _assert_error_observation(interrupt_result, job_id="missing-job")

    asyncio.run(scenario())

    assert client.wait_calls == []
    assert client.input_calls == []
    assert client.terminate_calls == []


def test_shell_layer_hooks_and_tools_fail_clearly_outside_active_resource_context() -> None:
    client = FakeShellctlClient()
    layer = _shell_layer(client_factory=lambda _entrypoint: client)
    layer.runtime_state = DifyShellRuntimeState(session_id="abc12ff", workspace_cwd="~/workspace/abc12ff")
    tools = {tool.name: tool for tool in layer.tools}

    async def scenario() -> None:
        with pytest.raises(RuntimeError, match="resource_context"):
            await layer.on_context_suspend()

        run_result = await tools["shell_run"].function_schema.call(
            {"script": "pwd"},
            None,  # pyright: ignore[reportArgumentType]
        )
        _assert_error_observation(run_result, includes="resource_context")

    asyncio.run(scenario())

    assert client.run_calls == []


def test_shell_runtime_state_rejects_unsafe_resumed_workspace_identity() -> None:
    with pytest.raises(ValueError, match="session_id must match"):
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


def test_shell_runtime_state_treats_job_ids_as_opaque_strings_and_rejects_unknown_offset_keys() -> None:
    state = DifyShellRuntimeState.model_validate(
        {
            "session_id": "abc12ff",
            "workspace_cwd": "~/workspace/abc12ff",
            "job_ids": ['job"bad with spaces'],
            "job_offsets": {'job"bad with spaces': 0},
        }
    )

    assert state.job_ids == ['job"bad with spaces']
    assert state.job_offsets == {'job"bad with spaces': 0}

    with pytest.raises(ValueError, match="unknown job ids"):
        _ = DifyShellRuntimeState.model_validate(
            {
                "session_id": "abc12ff",
                "workspace_cwd": "~/workspace/abc12ff",
                "job_ids": ["job-1"],
                "job_offsets": {"job-2": 3},
            }
        )
