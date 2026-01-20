from __future__ import annotations

import contextlib
import shlex
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from functools import partial

from core.virtual_environment.__base.command_future import CommandFuture
from core.virtual_environment.__base.entities import CommandResult, ConnectionHandle
from core.virtual_environment.__base.exec import CommandExecutionError, PipelineExecutionError
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

_PIPE_SENTINEL = "__DIFY_PIPE__"


@contextmanager
def with_connection(env: VirtualEnvironment) -> Generator[ConnectionHandle, None, None]:
    """Context manager for VirtualEnvironment connection lifecycle.

    Automatically establishes and releases connection handles.

    Usage:
        with with_connection(env) as conn:
            future = run_command(env, conn, ["echo", "hello"])
            result = future.result(timeout=10)
    """
    connection_handle = env.establish_connection()
    try:
        yield connection_handle
    finally:
        with contextlib.suppress(Exception):
            env.release_connection(connection_handle)


def submit_command(
    env: VirtualEnvironment,
    connection: ConnectionHandle,
    command: list[str],
    environments: Mapping[str, str] | None = None,
    *,
    cwd: str | None = None,
) -> CommandFuture:
    """Execute a command and return a Future for the result.

    High-level interface that handles IO draining internally.
    For streaming output, use env.execute_command() instead.

    Args:
        env: The virtual environment to execute the command in.
        connection: The connection handle.
        command: Command as list of strings.
        environments: Environment variables.
        cwd: Working directory for the command. If None, uses the provider's default.

    Returns:
        CommandFuture that can be used to get result with timeout or cancel.

    Example:
        with with_connection(env) as conn:
            result = run_command(env, conn, ["ls", "-la"]).result(timeout=30)
    """
    pid, stdin_transport, stdout_transport, stderr_transport = env.execute_command(
        connection, command, environments, cwd
    )

    return CommandFuture(
        pid=pid,
        stdin_transport=stdin_transport,
        stdout_transport=stdout_transport,
        stderr_transport=stderr_transport,
        poll_status=partial(env.get_command_status, connection, pid),
    )


def _execute_with_connection(
    env: VirtualEnvironment,
    conn: ConnectionHandle,
    command: list[str],
    timeout: float | None,
    cwd: str | None,
) -> CommandResult:
    """Internal helper to execute command with given connection."""
    future = submit_command(env, conn, command, cwd=cwd)
    return future.result(timeout=timeout)


def execute(
    env: VirtualEnvironment,
    command: list[str],
    *,
    timeout: float | None = 30,
    cwd: str | None = None,
    error_message: str = "Command failed",
    connection: ConnectionHandle | None = None,
) -> CommandResult:
    """Execute a command with automatic connection management.

    Raises CommandExecutionError if the command fails (non-zero exit code).

    Args:
        env: The virtual environment to execute the command in.
        command: The command to execute as a list of strings.
        timeout: Maximum time to wait for the command to complete (seconds).
        cwd: Working directory for the command.
        error_message: Custom error message prefix for failures.
        connection: Optional connection handle to reuse. If None, creates and releases a new connection.

    Returns:
        CommandResult on success.

    Raises:
        CommandExecutionError: If the command fails.
    """
    if connection is not None:
        result = _execute_with_connection(env, connection, command, timeout, cwd)
    else:
        with with_connection(env) as conn:
            result = _execute_with_connection(env, conn, command, timeout, cwd)

    if result.is_error:
        raise CommandExecutionError(f"{error_message}: {result.error_message}", result)
    return result


def try_execute(
    env: VirtualEnvironment,
    command: list[str],
    *,
    timeout: float | None = 30,
    cwd: str | None = None,
    connection: ConnectionHandle | None = None,
) -> CommandResult:
    """Execute a command with automatic connection management.

    Does not raise on failure - returns the result for caller to handle.

    Args:
        env: The virtual environment to execute the command in.
        command: The command to execute as a list of strings.
        timeout: Maximum time to wait for the command to complete (seconds).
        cwd: Working directory for the command.
        connection: Optional connection handle to reuse. If None, creates and releases a new connection.

    Returns:
        CommandResult containing stdout, stderr, and exit_code.
    """
    if connection is not None:
        return _execute_with_connection(env, connection, command, timeout, cwd)

    with with_connection(env) as conn:
        return _execute_with_connection(env, conn, command, timeout, cwd)


@dataclass(frozen=True)
class _PipelineStep:
    argv: list[str]
    error_message: str = "Command failed"


@dataclass
class CommandPipeline:
    """Batch multiple commands into a single shell execution (Redis pipeline style).

    Example:
        results = pipeline(env).add(["echo", "hi"]).add(["ls"]).execute()
        # Strict mode: raise on first failure
        pipeline(env).add(["mkdir", "/x"], error_message="mkdir failed").execute(raise_on_error=True)
    """

    env: VirtualEnvironment
    connection: ConnectionHandle | None = None
    cwd: str | None = None
    environments: Mapping[str, str] | None = None

    _steps: list[_PipelineStep] = field(default_factory=list)  # pyright: ignore[reportUnknownVariableType]

    def add(self, command: list[str], *, error_message: str = "Command failed") -> CommandPipeline:
        self._steps.append(_PipelineStep(argv=command, error_message=error_message))
        return self

    def execute(self, *, timeout: float | None = 30, raise_on_error: bool = False) -> list[CommandResult]:
        if not self._steps:
            return []

        script = self._build_script(fail_fast=raise_on_error)
        batch_cmd = ["sh", "-lc", script]

        if self.connection is not None:
            batch_result = try_execute(self.env, batch_cmd, timeout=timeout, cwd=self.cwd, connection=self.connection)
        else:
            with with_connection(self.env) as conn:
                batch_result = try_execute(self.env, batch_cmd, timeout=timeout, cwd=self.cwd, connection=conn)

        results = self._parse_results(batch_result.stdout, batch_result.pid)

        if raise_on_error:
            for i, r in enumerate(iterable=results):
                if r.is_error:
                    step = self._steps[i]
                    raise PipelineExecutionError(
                        f"{step.error_message}: {r.error_message}",
                        r,
                        index=i,
                        command=step.argv,
                        results=results,
                    )

        return results

    def _build_script(self, *, fail_fast: bool = False) -> str:
        lines = [
            "run() {",
            '  i="$1"; shift',
            '  out="$(mktemp)"; err="$(mktemp)"',
            '  ("$@") >"$out" 2>"$err"; ec="$?"',
            '  os="$(wc -c <"$out" | tr -d \' \')"',
            '  es="$(wc -c <"$err" | tr -d \' \')"',
            f'  printf \'{_PIPE_SENTINEL} %s %s %s %s\\n\' "$i" "$ec" "$os" "$es"',
            '  cat "$out"',
            '  cat "$err"',
            '  rm -f "$out" "$err"',
            '  return "$ec"',
            "}",
        ]
        suffix = " || exit $?" if fail_fast else ""
        for i, step in enumerate(self._steps):
            quoted = " ".join(shlex.quote(arg) for arg in step.argv)
            lines.append(f"run {i} {quoted}{suffix}")
        return "\n".join(lines)

    @staticmethod
    def _parse_results(stdout: bytes, pid: str) -> list[CommandResult]:
        results: list[CommandResult] = []
        pos = 0
        sentinel = _PIPE_SENTINEL.encode() + b" "

        while pos < len(stdout):
            nl = stdout.find(b"\n", pos)
            if nl == -1:
                break
            header = stdout[pos : nl + 1]
            pos = nl + 1

            if not header.startswith(sentinel):
                raise ValueError("Malformed pipeline output: missing sentinel")

            parts = header.decode().strip().split(" ")
            _, idx, ec, os_len, es_len = parts
            out_len, err_len = int(os_len), int(es_len)

            out_bytes = stdout[pos : pos + out_len]
            pos += out_len
            err_bytes = stdout[pos : pos + err_len]
            pos += err_len

            results.append(
                CommandResult(
                    stdout=out_bytes,
                    stderr=err_bytes,
                    exit_code=int(ec),
                    pid=f"{pid}:{idx}",
                )
            )

        return results


def pipeline(
    env: VirtualEnvironment,
    connection: ConnectionHandle | None = None,
    *,
    cwd: str | None = None,
    environments: Mapping[str, str] | None = None,
) -> CommandPipeline:
    return CommandPipeline(env=env, connection=connection, cwd=cwd, environments=environments)
