from __future__ import annotations

import contextlib
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from functools import partial

from core.virtual_environment.__base.command_future import CommandFuture
from core.virtual_environment.__base.entities import CommandResult, ConnectionHandle
from core.virtual_environment.__base.exec import CommandExecutionError
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


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
