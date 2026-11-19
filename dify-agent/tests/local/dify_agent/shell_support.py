"""Recording command transport and a Stub-enabled shell with owned client cleanup."""

from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from dify_agent.adapters.shell.protocols import ShellCommandResult, ShellCommandStatus, ShellExecutionMode
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.shell import DifyShellLayerConfig
from dify_agent.layers.shell.layer import ShellSession, State
from dify_agent.runtime_backend import RuntimeLayout
from tests.local.dify_agent.module_support import deps_for


@dataclass(slots=True)
class RunCall:
    script: str
    cwd: str | None
    env: Mapping[str, str] | None
    timeout: float
    mode: ShellExecutionMode = "pty"


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


@dataclass(slots=True)
class FakeCommands:
    """Replace command transport only; real ShellSession and command-runner code still execute."""

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

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
        mode: ShellExecutionMode = "pty",
    ) -> ShellCommandResult:
        self.run_calls.append(RunCall(script=script, cwd=cwd, env=env, timeout=timeout, mode=mode))
        if self.run_handler is None:
            raise AssertionError("Unexpected run() call")
        return self.run_handler(script, cwd, env, timeout)

    async def wait(self, job_id: str, *, offset: int, timeout: float) -> ShellCommandResult:
        self.wait_calls.append(WaitCall(job_id=job_id, offset=offset, timeout=timeout))
        if self.wait_handler is None:
            raise AssertionError("Unexpected wait() call")
        return self.wait_handler(job_id, offset, timeout)

    async def read_output(self, job_id: str, *, offset: int) -> ShellCommandResult:
        self.wait_calls.append(WaitCall(job_id=job_id, offset=offset, timeout=0.0))
        if self.wait_handler is None:
            raise AssertionError("Unexpected read_output() call")
        return self.wait_handler(job_id, offset, 0.0)

    async def input(self, job_id: str, text: str, *, offset: int, timeout: float) -> ShellCommandResult:
        self.input_calls.append(InputCall(job_id=job_id, text=text, offset=offset, timeout=timeout))
        if self.input_handler is None:
            raise AssertionError("Unexpected input() call")
        return self.input_handler(job_id, text, offset, timeout)

    async def interrupt(self, job_id: str, *, grace_seconds: float) -> ShellCommandStatus:
        self.interrupt_calls.append(InterruptCall(job_id=job_id, grace_seconds=grace_seconds))
        if self.interrupt_handler is None:
            raise AssertionError("Unexpected interrupt() call")
        return self.interrupt_handler(job_id, grace_seconds)

    async def tail(self, job_id: str) -> ShellCommandResult:
        self.tail_calls.append(TailCall(job_id=job_id))
        if self.tail_handler is None:
            raise AssertionError("Unexpected tail() call")
        return self.tail_handler(job_id)

    async def delete(self, job_id: str, *, force: bool = False, grace_seconds: float | None = None) -> None:
        self.delete_calls.append(DeleteCall(job_id=job_id, force=force, grace_seconds=grace_seconds))
        if self.delete_handler is not None:
            self.delete_handler(job_id, force, grace_seconds)


@dataclass(slots=True)
class _ShellLease:
    commands: FakeCommands
    layout: RuntimeLayout


def completed_shell_command(output: str, *, exit_code: int = 0) -> ShellCommandResult:
    """Build one completed transport response for sandbox upload tests."""
    return ShellCommandResult(
        job_id="upload",
        status="exited",
        done=True,
        exit_code=exit_code,
        output=output,
        offset=len(output),
        truncated=False,
    )


@asynccontextmanager
async def stub_enabled_shell(commands: FakeCommands) -> AsyncIterator[ShellSession]:
    """Yield a real shell with Stub identity; close both owned HTTP clients on every exit."""
    deps = deps_for(
        "shell", DifyShellLayerConfig(execution_context="execution_context"), State().model_dump(mode="json")
    )
    deps.layers["execution_context"] = {
        "config": DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="account",
            agent_id="agent-1",
            agent_mode="agent_app",
            invoke_from="service-api",
        ).model_dump(mode="json"),
        "state": {},
    }
    deps.resources.leases["runtime"] = _ShellLease(
        commands=commands, layout=RuntimeLayout(home_dir="/home/agent-1", workspace_dir="/workspace")
    )
    deps.services.agent_stub_api_base_url = "http://stub/agent-stub"
    deps.services.agent_stub_token_factory = lambda execution_context, session_id: "stub-token"
    async with deps.services.dify_api_http_client, deps.services.plugin_daemon_http_client:
        yield ShellSession("shell", deps)
