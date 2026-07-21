from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import posixpath
import shlex
from typing import Literal, cast

import pytest

from dify_agent.adapters.shell.protocols import CompleteShellCommandResult, ShellCommandProtocol
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol
from dify_agent.runtime_backend import (
    CreateHomeSnapshotRequest,
    HomeSnapshotFile,
    HomeSnapshotSource,
    SandboxCreateError,
    SandboxCreateSpec,
    SandboxLayout,
    SandboxLostError,
)
from dify_agent.runtime_backend.local import LocalHomeSnapshotDriver, LocalSandboxDriver
from dify_agent.runtime_backend.shellctl import ShellctlSandboxLease


def _result(*, exit_code: int, output: str = "") -> CompleteShellCommandResult:
    return CompleteShellCommandResult(
        job_id="job-1",
        status="exited",
        done=True,
        exit_code=exit_code,
        output=output,
        output_complete=True,
        incomplete_reason=None,
        offset=len(output),
    )


@dataclass(slots=True)
class _FakeLease:
    layout: SandboxLayout = SandboxLayout(
        home_dir="/sessions/session-1/home",
        workspace_dir="/sessions/session-1/workspace",
    )
    handle: str = "session-1"
    commands: ShellCommandProtocol = cast(ShellCommandProtocol, object())
    files: _FakeFiles = field(default_factory=lambda: _FakeFiles())
    closed: bool = False

    async def close(self) -> None:
        self.closed = True


@dataclass(slots=True)
class _FakeFiles:
    uploads: list[tuple[bytes, str, str | None]] = field(default_factory=list)
    upload_error: BaseException | None = None

    async def upload(self, *, content: bytes, remote_path: str, cwd: str | None = None) -> None:
        self.uploads.append((content, remote_path, cwd))
        if self.upload_error is not None:
            raise self.upload_error


@dataclass(slots=True)
class _TrackingClient:
    close_calls: int = 0

    async def close(self) -> None:
        self.close_calls += 1


@dataclass(slots=True)
class _ControlStep:
    operation: _ControlOperation
    targets: tuple[str, ...]
    outcome: CompleteShellCommandResult | BaseException


type _ControlOperation = Literal[
    "home_snapshot_create",
    "home_snapshot_delete",
    "sandbox_create",
    "sandbox_resume",
    "sandbox_delete",
    "partial_sandbox_cleanup",
]


def _control_step(
    operation: _ControlOperation,
    *targets: str,
    outcome: CompleteShellCommandResult | BaseException,
) -> _ControlStep:
    return _ControlStep(operation=operation, targets=targets, outcome=outcome)


def _tokenize_control_script(script: str) -> list[list[str]]:
    lexer = shlex.shlex("\n;\n".join(script.splitlines()), posix=True, punctuation_chars=";&|")
    lexer.whitespace_split = True
    lexer.commenters = "#"
    commands: list[list[str]] = []
    current: list[str] = []
    for token in lexer:
        if token in {";", "&&", "||"}:
            if current:
                commands.append(current)
                current = []
        else:
            current.append(token)
    if current:
        commands.append(current)
    return commands


def _command_operands(command: list[str]) -> tuple[str, ...]:
    operands: list[str] = []
    parsing_options = True
    for token in command[1:]:
        if parsing_options and token == "--":
            parsing_options = False
            continue
        if parsing_options and token.startswith("-"):
            continue
        parsing_options = False
        operands.append(posixpath.normpath(token))
    return tuple(operands)


def _has_command(
    commands: list[list[str]],
    name: str,
    *targets: str,
    flags: frozenset[str] = frozenset(),
    ordered: bool = False,
    skip_operands: int = 0,
) -> bool:
    normalized_targets = tuple(posixpath.normpath(target) for target in targets)
    for command in commands:
        if not command or posixpath.basename(command[0]) != name or not flags.issubset(command):
            continue
        operands = _command_operands(command)[skip_operands:]
        matches = (
            operands == normalized_targets
            if ordered
            else len(operands) == len(normalized_targets) and set(operands) == set(normalized_targets)
        )
        if matches:
            return True
    return False


def _matches_control_step(step: _ControlStep, commands: list[list[str]]) -> bool:
    if step.operation == "home_snapshot_create":
        (snapshot,) = step.targets
        return _has_command(commands, "mkdir", snapshot) and _has_command(
            commands,
            "chmod",
            snapshot,
            skip_operands=1,
        )
    if step.operation in {"home_snapshot_delete", "sandbox_delete", "partial_sandbox_cleanup"}:
        (target,) = step.targets
        return _has_command(commands, "rm", target)
    if step.operation == "sandbox_resume":
        (workspace,) = step.targets
        return _has_command(commands, "test", workspace, flags=frozenset({"-d"}), ordered=True)
    snapshot, session, home, workspace = step.targets
    return (
        _has_command(commands, "test", snapshot, flags=frozenset({"-d"}))
        and _has_command(commands, "mkdir", home, workspace)
        and _has_command(commands, "cp", snapshot, home, ordered=True)
        and _has_command(commands, "chmod", session, home, skip_operands=1)
    )


@dataclass(slots=True)
class _ControlPlan:
    steps: list[_ControlStep]
    calls: int = 0

    async def run(
        self,
        _commands: ShellCommandProtocol,
        script: str,
        **_kwargs: object,
    ) -> CompleteShellCommandResult:
        self.calls += 1
        if not self.steps:
            raise AssertionError("unexpected Local control operation")
        step = self.steps.pop(0)
        commands = _tokenize_control_script(script)
        assert _matches_control_step(step, commands), (
            f"expected {step.operation} for resources {step.targets}, got commands {commands}"
        )
        if isinstance(step.outcome, BaseException):
            raise step.outcome
        return step.outcome


def test_control_matcher_rejects_reversed_snapshot_copy() -> None:
    step = _control_step(
        "sandbox_create",
        "/snapshots/home-1",
        "/sessions/session-1",
        "/sessions/session-1/home",
        "/sessions/session-1/workspace",
        outcome=_result(exit_code=0),
    )
    commands = [
        ["test", "-d", "/snapshots/home-1"],
        ["mkdir", "-p", "/sessions/session-1/home", "/sessions/session-1/workspace"],
        ["cp", "-a", "--", "/sessions/session-1/home", "/snapshots/home-1/."],
        ["chmod", "700", "/sessions/session-1", "/sessions/session-1/home"],
    ]

    assert not _matches_control_step(step, commands)


def test_control_matcher_rejects_overbroad_sandbox_cleanup() -> None:
    step = _control_step(
        "partial_sandbox_cleanup",
        "/sessions/session-1",
        outcome=_result(exit_code=0),
    )
    commands = [["rm", "-rf", "--", "/sessions/session-1", "/sessions/session-2"]]

    assert not _matches_control_step(step, commands)


def test_local_driver_defaults_stay_under_shellctl_writable_home() -> None:
    home_driver = LocalHomeSnapshotDriver(endpoint="http://shellctl", auth_token="secret")
    sandbox_driver = LocalSandboxDriver(endpoint="http://shellctl", auth_token="secret")

    assert home_driver.snapshot_root == "/home/dify/.dify-agent-home-snapshots"
    assert sandbox_driver.snapshot_root == home_driver.snapshot_root
    assert sandbox_driver.session_root == "/home/dify/.dify-agent-sessions"


@pytest.mark.anyio
async def test_suspend_closes_local_shellctl_lease_exactly_once() -> None:
    client = _TrackingClient()
    driver = LocalSandboxDriver(
        endpoint="http://shellctl",
        auth_token="secret",
        client_factory=lambda: cast(ShellctlClientProtocol, cast(object, client)),
    )
    lease = driver._lease("session-1")

    await driver.suspend(lease)
    await driver.suspend(lease)

    assert client.close_calls == 1


@pytest.mark.anyio
async def test_home_snapshot_create_upload_and_delete_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = LocalHomeSnapshotDriver(
        endpoint="http://shellctl",
        auth_token="secret",
        snapshot_root="/snapshots",
    )
    create_lease = _FakeLease(handle="home-digest-1")
    delete_lease = _FakeLease(handle="home-digest-1")
    leases = iter([create_lease, delete_lease])
    control = _ControlPlan(
        [
            _control_step(
                "home_snapshot_create",
                "/snapshots/home-digest-1",
                outcome=_result(exit_code=0),
            ),
            _control_step(
                "home_snapshot_delete",
                "/snapshots/home-digest-1",
                outcome=_result(exit_code=0),
            ),
        ]
    )

    monkeypatch.setattr(
        "dify_agent.runtime_backend.local.create_shellctl_lease",
        lambda **_kwargs: cast(ShellctlSandboxLease, cast(object, next(leases))),
    )
    monkeypatch.setattr("dify_agent.runtime_backend.local.run_shellctl_control_command", control.run)

    snapshot_ref = await driver.create(
        CreateHomeSnapshotRequest(
            tenant_id="tenant-1",
            agent_id="agent-1",
            agent_config_version_id="config-1",
            source_digest="digest-1",
            source=HomeSnapshotSource(files=(HomeSnapshotFile(path=".dify/config.txt", content=b"home"),)),
        )
    )
    await driver.delete(snapshot_ref)

    assert snapshot_ref == "home-digest-1"
    assert create_lease.files.uploads == [(b"home", "/snapshots/home-digest-1/.dify/config.txt", None)]
    assert create_lease.closed is True
    assert delete_lease.closed is True
    assert control.calls == 2
    assert control.steps == []


@pytest.mark.anyio
async def test_home_snapshot_materialization_cancellation_closes_shellctl_lease(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = LocalHomeSnapshotDriver(endpoint="http://shellctl", auth_token="secret", snapshot_root="/snapshots")
    lease = _FakeLease(handle="home-digest-1")
    lease.files.upload_error = asyncio.CancelledError()
    control = _ControlPlan(
        [
            _control_step(
                "home_snapshot_create",
                "/snapshots/home-digest-1",
                outcome=_result(exit_code=0),
            )
        ]
    )

    monkeypatch.setattr(
        "dify_agent.runtime_backend.local.create_shellctl_lease",
        lambda **_kwargs: cast(ShellctlSandboxLease, cast(object, lease)),
    )
    monkeypatch.setattr("dify_agent.runtime_backend.local.run_shellctl_control_command", control.run)

    with pytest.raises(asyncio.CancelledError):
        _ = await driver.create(
            CreateHomeSnapshotRequest(
                tenant_id="tenant-1",
                agent_id="agent-1",
                agent_config_version_id="config-1",
                source_digest="digest-1",
                source=HomeSnapshotSource(files=(HomeSnapshotFile(path="config.txt", content=b"home"),)),
            )
        )

    assert lease.closed is True
    assert control.calls == 1
    assert control.steps == []


@pytest.mark.anyio
async def test_sandbox_materialize_resume_lost_and_delete_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    driver = LocalSandboxDriver(
        endpoint="http://shellctl",
        auth_token="secret",
        session_root="/sessions",
        snapshot_root="/snapshots",
    )
    created = _FakeLease()
    resumed = _FakeLease()
    deleted = _FakeLease()
    lost = _FakeLease()
    leases = iter([created, resumed, deleted, lost])
    control = _ControlPlan(
        [
            _control_step(
                "sandbox_create",
                "/snapshots/home-1",
                "/sessions/session-1",
                "/sessions/session-1/home",
                "/sessions/session-1/workspace",
                outcome=_result(exit_code=0),
            ),
            _control_step(
                "sandbox_resume",
                "/sessions/session-1/workspace",
                outcome=_result(exit_code=0),
            ),
            _control_step(
                "sandbox_delete",
                "/sessions/session-1",
                outcome=_result(exit_code=0),
            ),
            _control_step(
                "sandbox_resume",
                "/sessions/session-1/workspace",
                outcome=_result(exit_code=1),
            ),
        ]
    )

    monkeypatch.setattr(
        LocalSandboxDriver,
        "_lease",
        lambda _driver, _handle: cast(ShellctlSandboxLease, cast(object, next(leases))),
    )
    monkeypatch.setattr("dify_agent.runtime_backend.local.run_shellctl_control_command", control.run)
    spec = SandboxCreateSpec(
        tenant_id="tenant-1",
        agent_id="agent-1",
        agent_config_version_id="config-1",
        runtime_session_id="session-1",
        home_snapshot_ref="home-1",
    )

    lease = await driver.create(spec)
    assert lease is created
    await created.close()
    lease = await driver.resume("session-1")
    assert lease is resumed
    await resumed.close()
    await driver.delete("session-1")
    with pytest.raises(SandboxLostError, match="no longer exists"):
        _ = await driver.resume("session-1")

    assert created.handle == "session-1"
    assert resumed.handle == "session-1"
    assert created.closed is True
    assert resumed.closed is True
    assert deleted.closed is True
    assert lost.closed is True
    assert control.calls == 4
    assert control.steps == []


@pytest.mark.anyio
async def test_create_removes_partial_session_scope_when_materialization_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver = LocalSandboxDriver(endpoint="http://shellctl", auth_token="secret", session_root="/sessions")
    lease = _FakeLease()
    control = _ControlPlan(
        [
            _control_step(
                "sandbox_create",
                "/home/dify/.dify-agent-home-snapshots/home-ref",
                "/sessions/session-1",
                "/sessions/session-1/home",
                "/sessions/session-1/workspace",
                outcome=_result(exit_code=1, output="copy failed"),
            ),
            _control_step(
                "partial_sandbox_cleanup",
                "/sessions/session-1",
                outcome=_result(exit_code=0),
            ),
        ]
    )

    def lease_for_handle(_driver: LocalSandboxDriver, _handle: str) -> ShellctlSandboxLease:
        return cast(ShellctlSandboxLease, cast(object, lease))

    monkeypatch.setattr(
        LocalSandboxDriver,
        "_lease",
        lease_for_handle,
    )
    monkeypatch.setattr("dify_agent.runtime_backend.local.run_shellctl_control_command", control.run)

    with pytest.raises(SandboxCreateError, match="copy failed"):
        _ = await driver.create(
            SandboxCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                agent_config_version_id="config-1",
                runtime_session_id="session-1",
                home_snapshot_ref="home-ref",
            )
        )

    assert lease.closed is True
    assert control.calls == 2
    assert control.steps == []


@pytest.mark.anyio
async def test_create_preserves_original_error_when_partial_scope_cleanup_fails(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    driver = LocalSandboxDriver(endpoint="http://shellctl", auth_token="secret", session_root="/sessions")
    lease = _FakeLease()
    control = _ControlPlan(
        [
            _control_step(
                "sandbox_create",
                "/home/dify/.dify-agent-home-snapshots/home-ref",
                "/sessions/session-1",
                "/sessions/session-1/home",
                "/sessions/session-1/workspace",
                outcome=_result(exit_code=1, output="copy failed"),
            ),
            _control_step(
                "partial_sandbox_cleanup",
                "/sessions/session-1",
                outcome=RuntimeError("cleanup transport failed"),
            ),
        ]
    )

    def lease_for_handle(_driver: LocalSandboxDriver, _handle: str) -> ShellctlSandboxLease:
        return cast(ShellctlSandboxLease, cast(object, lease))

    monkeypatch.setattr(
        LocalSandboxDriver,
        "_lease",
        lease_for_handle,
    )
    monkeypatch.setattr("dify_agent.runtime_backend.local.run_shellctl_control_command", control.run)

    with caplog.at_level("WARNING", logger="dify_agent.runtime_backend.local"):
        with pytest.raises(SandboxCreateError, match="copy failed"):
            _ = await driver.create(
                SandboxCreateSpec(
                    tenant_id="tenant-1",
                    agent_id="agent-1",
                    agent_config_version_id="config-1",
                    runtime_session_id="session-1",
                    home_snapshot_ref="home-ref",
                )
            )

    assert "cleanup transport failed" in caplog.text
    assert lease.closed is True
    assert control.calls == 2
    assert control.steps == []


@pytest.mark.anyio
async def test_create_cancellation_closes_lease_and_removes_partial_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _TrackingClient()
    driver = LocalSandboxDriver(
        endpoint="http://shellctl",
        auth_token="secret",
        session_root="/sessions",
        client_factory=lambda: cast(ShellctlClientProtocol, cast(object, client)),
    )
    lease = driver._lease("session-1")
    control = _ControlPlan(
        [
            _control_step(
                "sandbox_create",
                "/home/dify/.dify-agent-home-snapshots/home-ref",
                "/sessions/session-1",
                "/sessions/session-1/home",
                "/sessions/session-1/workspace",
                outcome=asyncio.CancelledError(),
            ),
            _control_step(
                "partial_sandbox_cleanup",
                "/sessions/session-1",
                outcome=_result(exit_code=0),
            ),
        ]
    )

    monkeypatch.setattr(
        LocalSandboxDriver,
        "_lease",
        lambda _driver, _handle: cast(ShellctlSandboxLease, cast(object, lease)),
    )
    monkeypatch.setattr("dify_agent.runtime_backend.local.run_shellctl_control_command", control.run)

    with pytest.raises(asyncio.CancelledError):
        _ = await driver.create(
            SandboxCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                agent_config_version_id="config-1",
                runtime_session_id="session-1",
                home_snapshot_ref="home-ref",
            )
        )

    assert client.close_calls == 1
    assert control.calls == 2
    assert control.steps == []


@pytest.mark.anyio
async def test_resume_cancellation_closes_acquired_lease(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _TrackingClient()
    driver = LocalSandboxDriver(
        endpoint="http://shellctl",
        auth_token="secret",
        client_factory=lambda: cast(ShellctlClientProtocol, cast(object, client)),
    )
    lease = driver._lease("session-1")
    control = _ControlPlan(
        [
            _control_step(
                "sandbox_resume",
                "/home/dify/.dify-agent-sessions/session-1/workspace",
                outcome=asyncio.CancelledError(),
            )
        ]
    )

    monkeypatch.setattr(
        LocalSandboxDriver,
        "_lease",
        lambda _driver, _handle: cast(ShellctlSandboxLease, cast(object, lease)),
    )
    monkeypatch.setattr("dify_agent.runtime_backend.local.run_shellctl_control_command", control.run)

    with pytest.raises(asyncio.CancelledError):
        _ = await driver.resume("session-1")

    assert client.close_calls == 1
    assert control.calls == 1
    assert control.steps == []
