"""Local tests for the shellctl shell adapter and env-driven provider factory.

These exercise the provider-agnostic boundary contract (provision/execute/wait,
file transfer, optional input/interrupt) against a fake shellctl client, plus the
``DIFY_AGENT_SHELL_PROVIDER`` selection in the factory. They avoid the private
``shell-session-manager`` package by injecting a structural fake client.
"""

import asyncio
import base64
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field

import pytest

from dify_agent.adapters.shell import shellctl
from dify_agent.adapters.shell.config import ShellAdapterSettings
from dify_agent.adapters.shell.factory import create_shell_provisioner
from dify_agent.adapters.shell.protocols import (
    ShellEnvironmentDescriptor,
)
from dify_agent.adapters.shell.shellctl import (
    ShellctlProvisioner,
    ShellFileTransferError,
    ShellProvisionError,
)

_SESSION_HEX = "deadbeefdeadbeef"
_WORKSPACE_CWD = f"~/workspace/{_SESSION_HEX}"


@dataclass(slots=True)
class _Job:
    job_id: str
    done: bool = True
    output: str = ""
    offset: int = 0
    truncated: bool = False
    exit_code: int | None = 0


@dataclass(slots=True)
class _Status:
    job_id: str
    done: bool = True
    offset: int = 0
    exit_code: int | None = 0


@dataclass(slots=True)
class _RunCall:
    script: str
    cwd: str | None
    env: dict[str, str] | None


type _RunHandler = Callable[[str, str | None, dict[str, str] | None], _Job]
type _WaitHandler = Callable[[str, int], _Job]
type _InputHandler = Callable[[str, str, int], _Job]
type _TerminateHandler = Callable[[str], _Status]


@dataclass(slots=True)
class FakeShellctlClient:
    """Structural shellctl client double recording calls and replaying handlers."""

    run_handler: _RunHandler | None = None
    wait_handler: _WaitHandler | None = None
    input_handler: _InputHandler | None = None
    terminate_handler: _TerminateHandler | None = None
    run_calls: list[_RunCall] = field(default_factory=list)
    wait_calls: list[tuple[str, int]] = field(default_factory=list)
    input_calls: list[tuple[str, str, int]] = field(default_factory=list)
    terminate_calls: list[tuple[str, float]] = field(default_factory=list)
    delete_calls: list[str] = field(default_factory=list)
    closed: bool = False

    async def run(self, script, *, cwd=None, env=None, timeout=30.0):
        del timeout
        self.run_calls.append(_RunCall(script=script, cwd=cwd, env=env))
        if self.run_handler is not None:
            return self.run_handler(script, cwd, env)
        return _Job(job_id="job", done=True, exit_code=0)

    async def wait(self, job_id, *, offset, timeout=30.0):
        del timeout
        self.wait_calls.append((job_id, offset))
        if self.wait_handler is not None:
            return self.wait_handler(job_id, offset)
        return _Job(job_id=job_id, done=True, offset=offset, exit_code=0)

    async def input(self, job_id, text, *, offset, timeout=30.0):
        del timeout
        self.input_calls.append((job_id, text, offset))
        if self.input_handler is not None:
            return self.input_handler(job_id, text, offset)
        return _Job(job_id=job_id, done=True, offset=offset, exit_code=0)

    async def terminate(self, job_id, grace_seconds=10.0):
        self.terminate_calls.append((job_id, grace_seconds))
        if self.terminate_handler is not None:
            return self.terminate_handler(job_id)
        return _Status(job_id=job_id, done=True, exit_code=130)

    async def delete(self, job_id, *, force=False):
        del force
        self.delete_calls.append(job_id)
        return None

    async def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def _fixed_session_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(secrets, "token_hex", lambda _nbytes: _SESSION_HEX)


def _provisioner(client: FakeShellctlClient) -> ShellctlProvisioner:
    return ShellctlProvisioner(client_factory=lambda: client)


def test_provision_allocates_workspace_and_execute_drains_merged_output() -> None:
    def run_handler(script: str, cwd: str | None, env: dict[str, str] | None) -> _Job:
        del env
        if script.startswith("mkdir"):
            assert cwd is None
            return _Job(job_id="mkdir-job", done=True, exit_code=0)
        assert cwd == _WORKSPACE_CWD
        return _Job(job_id="user-job", done=False, output="par", offset=3, truncated=False, exit_code=None)

    def wait_handler(job_id: str, offset: int) -> _Job:
        assert job_id == "user-job"
        assert offset == 3
        return _Job(job_id="user-job", done=True, output="tial", offset=7, exit_code=0)

    client = FakeShellctlClient(run_handler=run_handler, wait_handler=wait_handler)

    async def scenario() -> None:
        handle = await _provisioner(client).provision()
        assert handle.workspace_cwd == _WORKSPACE_CWD
        executor = await handle.get_executor()
        result = await executor.execute("pwd", env={"FOO": "bar"})
        assert result.stdout() == "partial"
        assert result.stderr() == ""
        assert result.exit_code() == 0
        assert result.truncated() is False

    asyncio.run(scenario())

    assert client.run_calls[0].cwd is None
    user_run = next(call for call in client.run_calls if call.script == "pwd")
    assert user_run.env == {"FOO": "bar"}
    # completed jobs (internal mkdir + user command) are self-cleaned.
    assert "mkdir-job" in client.delete_calls
    assert "user-job" in client.delete_calls


def test_execute_reports_truncated_when_output_window_cap_is_hit() -> None:
    def run_handler(script: str, cwd: str | None, env: dict[str, str] | None) -> _Job:
        del cwd, env
        if script.startswith("mkdir"):
            return _Job(job_id="mkdir-job", done=True, exit_code=0)
        return _Job(job_id="user-job", done=False, output="x", offset=1, truncated=True, exit_code=None)

    def wait_handler(job_id: str, offset: int) -> _Job:
        return _Job(job_id=job_id, done=False, output="x", offset=offset + 1, truncated=True, exit_code=None)

    client = FakeShellctlClient(run_handler=run_handler, wait_handler=wait_handler)

    async def scenario() -> bool:
        handle = await _provisioner(client).provision()
        executor = await handle.get_executor()
        result = await executor.execute("tail -f log")
        return result.truncated()

    assert asyncio.run(scenario()) is True
    # a job that never completed is left intact (not deleted/forgotten).
    assert "user-job" not in client.delete_calls


def test_provision_failure_closes_client_and_raises() -> None:
    client = FakeShellctlClient(
        run_handler=lambda _script, _cwd, _env: _Job(job_id="mkdir-job", done=True, exit_code=1)
    )

    async def scenario() -> None:
        with pytest.raises(ShellProvisionError):
            await _provisioner(client).provision()

    asyncio.run(scenario())
    assert client.closed is True


def test_destroy_runs_cleanup_in_default_cwd_then_closes_client() -> None:
    client = FakeShellctlClient(run_handler=lambda _script, _cwd, _env: _Job(job_id="job", done=True, exit_code=0))

    async def scenario() -> None:
        provisioner = _provisioner(client)
        handle = await provisioner.provision()
        await provisioner.destroy(handle)

    asyncio.run(scenario())

    cleanup_call = client.run_calls[-1]
    assert cleanup_call.cwd is None
    assert _SESSION_HEX in cleanup_call.script and cleanup_call.script.startswith("rm -rf")
    assert client.closed is True


def test_file_transfer_download_decodes_sentinel_framed_base64() -> None:
    content = b"hello \x00 world"
    encoded = base64.b64encode(content).decode("ascii")
    framed = f"noise{shellctl._TRANSFER_BEGIN}{encoded}{shellctl._TRANSFER_END}trailing"

    def run_handler(script: str, cwd: str | None, env: dict[str, str] | None) -> _Job:
        del env
        if script.startswith("mkdir"):
            return _Job(job_id="mkdir-job", done=True, exit_code=0)
        assert cwd == _WORKSPACE_CWD
        return _Job(job_id="dl-job", done=True, output=framed, exit_code=0)

    client = FakeShellctlClient(run_handler=run_handler)

    async def scenario() -> None:
        handle = await _provisioner(client).provision()
        transfer = await handle.get_file_transfer()
        downloaded = await transfer.download(remote_path="report.txt")
        assert downloaded == content

    asyncio.run(scenario())


def test_file_transfer_download_missing_file_raises() -> None:
    def run_handler(script: str, cwd: str | None, env: dict[str, str] | None) -> _Job:
        del cwd, env
        if script.startswith("mkdir"):
            return _Job(job_id="mkdir-job", done=True, exit_code=0)
        return _Job(job_id="dl-job", done=True, output="", exit_code=shellctl._DOWNLOAD_MISSING_EXIT_CODE)

    client = FakeShellctlClient(run_handler=run_handler)

    async def scenario() -> None:
        handle = await _provisioner(client).provision()
        transfer = await handle.get_file_transfer()
        with pytest.raises(ShellFileTransferError, match="not found"):
            await transfer.download(remote_path="missing.txt")

    asyncio.run(scenario())


def test_file_transfer_upload_embeds_base64_and_succeeds() -> None:
    content = b"payload-bytes"
    encoded = base64.b64encode(content).decode("ascii")

    def run_handler(script: str, cwd: str | None, env: dict[str, str] | None) -> _Job:
        del env
        if script.startswith('mkdir -p "$HOME'):
            return _Job(job_id="mkdir-job", done=True, exit_code=0)
        assert cwd == _WORKSPACE_CWD
        assert encoded in script
        return _Job(job_id="ul-job", done=True, exit_code=0)

    client = FakeShellctlClient(run_handler=run_handler)

    async def scenario() -> None:
        handle = await _provisioner(client).provision()
        transfer = await handle.get_file_transfer()
        await transfer.upload(content=content, remote_path="out.bin")

    asyncio.run(scenario())


def test_provision_exposes_descriptor_seed() -> None:
    client = FakeShellctlClient(
        run_handler=lambda _script, _cwd, _env: _Job(job_id="mkdir-job", done=True, exit_code=0)
    )

    async def scenario() -> ShellEnvironmentDescriptor:
        handle = await _provisioner(client).provision()
        return handle.descriptor()

    descriptor = asyncio.run(scenario())
    assert descriptor.workspace_cwd == _WORKSPACE_CWD
    assert descriptor.session_id == _SESSION_HEX


def test_reattach_rebuilds_handle_without_mkdir_and_executes_in_same_workspace() -> None:
    descriptor = ShellEnvironmentDescriptor(workspace_cwd=_WORKSPACE_CWD, session_id=_SESSION_HEX)

    def run_handler(script: str, cwd: str | None, env: dict[str, str] | None) -> _Job:
        del env
        assert not script.startswith("mkdir")
        assert cwd == _WORKSPACE_CWD
        return _Job(job_id="user-job", done=True, output="ok", offset=2, exit_code=0)

    client = FakeShellctlClient(run_handler=run_handler)

    async def scenario() -> str:
        handle = await _provisioner(client).reattach(descriptor)
        executor = await handle.get_executor()
        result = await executor.execute("pwd")
        return result.stdout()

    assert asyncio.run(scenario()) == "ok"
    # reattach must not allocate a new workspace.
    assert all(not call.script.startswith("mkdir") for call in client.run_calls)


def test_factory_unknown_provider_raises() -> None:
    settings = ShellAdapterSettings(shell_provider="nope")
    with pytest.raises(ValueError, match="Unknown shell provider"):
        create_shell_provisioner(settings)


def test_factory_shellctl_requires_entrypoint() -> None:
    settings = ShellAdapterSettings(shell_provider="shellctl", shellctl_entrypoint=None)
    with pytest.raises(ValueError, match="DIFY_AGENT_SHELLCTL_ENTRYPOINT"):
        create_shell_provisioner(settings)


def test_factory_builds_shellctl_provisioner_from_settings() -> None:
    settings = ShellAdapterSettings(
        shell_provider="shellctl",
        shellctl_entrypoint="http://shellctl.example",
    )
    provisioner = create_shell_provisioner(settings)
    assert isinstance(provisioner, ShellctlProvisioner)
