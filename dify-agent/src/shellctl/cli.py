"""Typer CLI for network-backed shellctl commands.

Job-management commands in this module intentionally stay on the SDK side of
the boundary: they parse CLI options, call `ShellctlClient`, and render compact
JSON. That keeps `shellctl --help` and `shellctl run --help` free of FastAPI,
SQLAlchemy, tmux, and local runtime bootstrap imports.

Only `serve` lazily imports server-side modules when that subcommand is
actually invoked.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import NoReturn

import anyio
import httpx2 as httpx
import typer
from pydantic import BaseModel, ValidationError

from shellctl.client import ShellctlClient, ShellctlClientError
from shellctl.shared.constants import (
    DEFAULT_AUTH_TOKEN_ENV,
    DEFAULT_BASE_URL,
    DEFAULT_BASE_URL_ENV,
    DEFAULT_GC_FINISHED_JOB_RETENTION_SECONDS,
    DEFAULT_GC_INTERVAL_SECONDS,
    DEFAULT_IDLE_FLUSH_SECONDS,
    DEFAULT_LIST_LIMIT,
    DEFAULT_OUTPUT_LIMIT_BYTES,
    DEFAULT_TERMINAL_COLS,
    DEFAULT_TERMINAL_ROWS,
    DEFAULT_TERMINATE_GRACE_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
    MAX_LIST_LIMIT,
    MAX_OUTPUT_LIMIT_BYTES,
)
from shellctl.shared.schemas import (
    DeleteJobResponse,
    HealthResponse,
    JobInfo,
    JobResult,
    JobStatusName,
    JobStatusView,
    RunJobRequest,
    TerminalSize,
)

cli = typer.Typer(
    no_args_is_help=True,
    pretty_exceptions_enable=False,
    rich_markup_mode=None,
)


@cli.command("health")
def health_command(
    base_url: str = typer.Option(
        DEFAULT_BASE_URL,
        "--base-url",
        envvar=DEFAULT_BASE_URL_ENV,
        help="shellctl server base URL. You can also set SHELLCTL_BASE_URL.",
    ),
    auth_token: str | None = typer.Option(
        None,
        "--auth-token",
        envvar=DEFAULT_AUTH_TOKEN_ENV,
        help="Accepted for CLI consistency but ignored because /healthz is public.",
    ),
) -> None:
    """Call the public health endpoint and report JSON."""

    del auth_token

    async def action(client: ShellctlClient) -> HealthResponse:
        return await client.health()

    _run_client_action(
        base_url=base_url,
        auth_token=None,
        action=action,
        emit=_emit_model,
    )


@cli.command("run")
def run_command(
    script: str = typer.Argument(...),
    base_url: str = typer.Option(
        DEFAULT_BASE_URL,
        "--base-url",
        envvar=DEFAULT_BASE_URL_ENV,
        help="shellctl server base URL. You can also set SHELLCTL_BASE_URL.",
    ),
    auth_token: str | None = typer.Option(
        None,
        "--auth-token",
        envvar=DEFAULT_AUTH_TOKEN_ENV,
        help=(
            "Bearer token value. You can also set SHELLCTL_AUTH_TOKEN. "
            "Leave it unset or empty when the server does not require auth."
        ),
    ),
    cwd: Path | None = typer.Option(None, "--cwd"),
    env: list[str] | None = typer.Option(None, "--env"),
    timeout: float = typer.Option(DEFAULT_TIMEOUT_SECONDS, "--timeout"),
    output_limit: int = typer.Option(DEFAULT_OUTPUT_LIMIT_BYTES, "--output-limit"),
    idle_flush_seconds: float = typer.Option(
        DEFAULT_IDLE_FLUSH_SECONDS,
        "--idle-flush-seconds",
    ),
    cols: int | None = typer.Option(None, "--cols"),
    rows: int | None = typer.Option(None, "--rows"),
) -> None:
    """Create a job through the running shellctl server."""

    request = _build_model(
        RunJobRequest,
        script=script,
        cwd=str(cwd) if cwd is not None else None,
        env=_parse_env(env),
        terminal=_terminal_size(cols=cols, rows=rows),
        timeout=timeout,
        output_limit=output_limit,
        idle_flush_seconds=idle_flush_seconds,
    )

    async def action(client: ShellctlClient) -> JobResult:
        return await client.run(
            request.script,
            cwd=request.cwd,
            env=request.env,
            timeout=request.timeout,
            terminal=request.terminal,
        )

    _run_client_action(
        base_url=base_url,
        auth_token=auth_token,
        output_limit=output_limit,
        idle_flush_seconds=idle_flush_seconds,
        action=action,
        emit=_emit_model,
    )


@cli.command("wait")
def wait_command(
    job_id: str = typer.Argument(...),
    base_url: str = typer.Option(
        DEFAULT_BASE_URL,
        "--base-url",
        envvar=DEFAULT_BASE_URL_ENV,
        help="shellctl server base URL. You can also set SHELLCTL_BASE_URL.",
    ),
    auth_token: str | None = typer.Option(
        None,
        "--auth-token",
        envvar=DEFAULT_AUTH_TOKEN_ENV,
        help=(
            "Bearer token value. You can also set SHELLCTL_AUTH_TOKEN. "
            "Leave it unset or empty when the server does not require auth."
        ),
    ),
    offset: int = typer.Option(..., "--offset"),
    timeout: float = typer.Option(DEFAULT_TIMEOUT_SECONDS, "--timeout"),
    output_limit: int = typer.Option(DEFAULT_OUTPUT_LIMIT_BYTES, "--output-limit"),
    idle_flush_seconds: float = typer.Option(
        DEFAULT_IDLE_FLUSH_SECONDS,
        "--idle-flush-seconds",
    ),
) -> None:
    """Wait for incremental output, completion, truncation, or timeout."""

    async def action(client: ShellctlClient) -> JobResult:
        return await client.wait(job_id, offset=offset, timeout=timeout)

    _run_client_action(
        base_url=base_url,
        auth_token=auth_token,
        output_limit=output_limit,
        idle_flush_seconds=idle_flush_seconds,
        action=action,
        emit=_emit_model,
    )


@cli.command("status")
def status_command(
    job_id: str = typer.Argument(...),
    base_url: str = typer.Option(
        DEFAULT_BASE_URL,
        "--base-url",
        envvar=DEFAULT_BASE_URL_ENV,
        help="shellctl server base URL. You can also set SHELLCTL_BASE_URL.",
    ),
    auth_token: str | None = typer.Option(
        None,
        "--auth-token",
        envvar=DEFAULT_AUTH_TOKEN_ENV,
        help=(
            "Bearer token value. You can also set SHELLCTL_AUTH_TOKEN. "
            "Leave it unset or empty when the server does not require auth."
        ),
    ),
) -> None:
    """Materialize the current status view for one job."""

    async def action(client: ShellctlClient) -> JobStatusView:
        return await client.status(job_id)

    _run_client_action(
        base_url=base_url,
        auth_token=auth_token,
        action=action,
        emit=_emit_model,
    )


@cli.command("list")
def list_command(
    base_url: str = typer.Option(
        DEFAULT_BASE_URL,
        "--base-url",
        envvar=DEFAULT_BASE_URL_ENV,
        help="shellctl server base URL. You can also set SHELLCTL_BASE_URL.",
    ),
    auth_token: str | None = typer.Option(
        None,
        "--auth-token",
        envvar=DEFAULT_AUTH_TOKEN_ENV,
        help=(
            "Bearer token value. You can also set SHELLCTL_AUTH_TOKEN. "
            "Leave it unset or empty when the server does not require auth."
        ),
    ),
    status: JobStatusName | None = typer.Option(None, "--status"),
    limit: int = typer.Option(DEFAULT_LIST_LIMIT, "--limit", min=1, max=MAX_LIST_LIMIT),
) -> None:
    """List recent jobs, optionally filtered by lifecycle status."""

    async def action(client: ShellctlClient) -> list[JobInfo]:
        return await client.list_jobs(status=status, limit=limit)

    _run_client_action(
        base_url=base_url,
        auth_token=auth_token,
        action=action,
        emit=_emit_job_list,
    )


@cli.command("input")
def input_command(
    job_id: str = typer.Argument(...),
    text: str = typer.Argument(...),
    base_url: str = typer.Option(
        DEFAULT_BASE_URL,
        "--base-url",
        envvar=DEFAULT_BASE_URL_ENV,
        help="shellctl server base URL. You can also set SHELLCTL_BASE_URL.",
    ),
    auth_token: str | None = typer.Option(
        None,
        "--auth-token",
        envvar=DEFAULT_AUTH_TOKEN_ENV,
        help=(
            "Bearer token value. You can also set SHELLCTL_AUTH_TOKEN. "
            "Leave it unset or empty when the server does not require auth."
        ),
    ),
    offset: int = typer.Option(..., "--offset"),
    timeout: float = typer.Option(DEFAULT_TIMEOUT_SECONDS, "--timeout"),
    output_limit: int = typer.Option(DEFAULT_OUTPUT_LIMIT_BYTES, "--output-limit"),
    idle_flush_seconds: float = typer.Option(
        DEFAULT_IDLE_FLUSH_SECONDS,
        "--idle-flush-seconds",
    ),
) -> None:
    """Send text input to a running job and wait for the next result window."""

    async def action(client: ShellctlClient) -> JobResult:
        return await client.input(job_id, text, offset=offset, timeout=timeout)

    _run_client_action(
        base_url=base_url,
        auth_token=auth_token,
        output_limit=output_limit,
        idle_flush_seconds=idle_flush_seconds,
        action=action,
        emit=_emit_model,
    )


@cli.command("tail")
def tail_command(
    job_id: str = typer.Argument(...),
    base_url: str = typer.Option(
        DEFAULT_BASE_URL,
        "--base-url",
        envvar=DEFAULT_BASE_URL_ENV,
        help="shellctl server base URL. You can also set SHELLCTL_BASE_URL.",
    ),
    auth_token: str | None = typer.Option(
        None,
        "--auth-token",
        envvar=DEFAULT_AUTH_TOKEN_ENV,
        help=(
            "Bearer token value. You can also set SHELLCTL_AUTH_TOKEN. "
            "Leave it unset or empty when the server does not require auth."
        ),
    ),
    output_limit: int = typer.Option(
        DEFAULT_OUTPUT_LIMIT_BYTES,
        "--output-limit",
        min=1,
        max=MAX_OUTPUT_LIMIT_BYTES,
    ),
) -> None:
    """Read a UTF-8-safe output tail for one job."""

    async def action(client: ShellctlClient) -> JobResult:
        return await client.tail(job_id)

    _run_client_action(
        base_url=base_url,
        auth_token=auth_token,
        output_limit=output_limit,
        action=action,
        emit=_emit_model,
    )


@cli.command("terminate")
def terminate_command(
    job_id: str = typer.Argument(...),
    base_url: str = typer.Option(
        DEFAULT_BASE_URL,
        "--base-url",
        envvar=DEFAULT_BASE_URL_ENV,
        help="shellctl server base URL. You can also set SHELLCTL_BASE_URL.",
    ),
    auth_token: str | None = typer.Option(
        None,
        "--auth-token",
        envvar=DEFAULT_AUTH_TOKEN_ENV,
        help=(
            "Bearer token value. You can also set SHELLCTL_AUTH_TOKEN. "
            "Leave it unset or empty when the server does not require auth."
        ),
    ),
    grace_seconds: float = typer.Option(
        DEFAULT_TERMINATE_GRACE_SECONDS,
        "--grace-seconds",
    ),
) -> None:
    """Terminate a job and return its materialized status."""

    async def action(client: ShellctlClient) -> JobStatusView:
        return await client.terminate(job_id, grace_seconds=grace_seconds)

    _run_client_action(
        base_url=base_url,
        auth_token=auth_token,
        action=action,
        emit=_emit_model,
    )


@cli.command("delete")
def delete_command(
    job_id: str = typer.Argument(...),
    base_url: str = typer.Option(
        DEFAULT_BASE_URL,
        "--base-url",
        envvar=DEFAULT_BASE_URL_ENV,
        help="shellctl server base URL. You can also set SHELLCTL_BASE_URL.",
    ),
    auth_token: str | None = typer.Option(
        None,
        "--auth-token",
        envvar=DEFAULT_AUTH_TOKEN_ENV,
        help=(
            "Bearer token value. You can also set SHELLCTL_AUTH_TOKEN. "
            "Leave it unset or empty when the server does not require auth."
        ),
    ),
    force: bool = typer.Option(False, "--force"),
    grace_seconds: float = typer.Option(
        DEFAULT_TERMINATE_GRACE_SECONDS,
        "--grace-seconds",
    ),
) -> None:
    """Delete a job row and artifacts, optionally terminating first."""

    async def action(client: ShellctlClient) -> DeleteJobResponse:
        return await client.delete(
            job_id,
            force=force,
            grace_seconds=grace_seconds,
        )

    _run_client_action(
        base_url=base_url,
        auth_token=auth_token,
        action=action,
        emit=_emit_model,
    )


@cli.command("serve")
def serve_command(
    listen: str = "127.0.0.1:8765",
    auth_token: str | None = typer.Option(
        None,
        "--auth-token",
        envvar=DEFAULT_AUTH_TOKEN_ENV,
        help=(
            "Bearer token value. You can also set SHELLCTL_AUTH_TOKEN. "
            "Leave it unset or empty to disable HTTP bearer auth."
        ),
    ),
    state_dir: Path | None = None,
    runtime_dir: Path | None = None,
    gc_interval_seconds: float = typer.Option(
        DEFAULT_GC_INTERVAL_SECONDS,
        "--gc-interval-seconds",
    ),
    gc_finished_job_retention_seconds: float = typer.Option(
        DEFAULT_GC_FINISHED_JOB_RETENTION_SECONDS,
        "--gc-finished-job-retention-seconds",
    ),
) -> None:
    """Run the local shellctl FastAPI server via uvicorn."""

    from shellctl.server.serve import (
        serve_command as server_serve_command,
    )

    server_serve_command(
        listen=listen,
        auth_token=auth_token,
        state_dir=state_dir,
        runtime_dir=runtime_dir,
        gc_interval_seconds=gc_interval_seconds,
        gc_finished_job_retention_seconds=gc_finished_job_retention_seconds,
    )


def main() -> None:
    """CLI entrypoint used by the console script and `python -m` invocations."""

    cli()


def _parse_env(values: list[str] | None) -> dict[str, str] | None:
    if not values:
        return None

    parsed: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise typer.BadParameter(
                "env entries must use NAME=VALUE format",
                param_hint="--env",
            )
        name, env_value = value.split("=", 1)
        if not name:
            raise typer.BadParameter(
                "env names must be non-empty",
                param_hint="--env",
            )
        parsed[name] = env_value
    return parsed


def _terminal_size(*, cols: int | None, rows: int | None) -> TerminalSize | None:
    if cols is None and rows is None:
        return None
    return _build_model(
        TerminalSize,
        cols=cols if cols is not None else DEFAULT_TERMINAL_COLS,
        rows=rows if rows is not None else DEFAULT_TERMINAL_ROWS,
    )


def _build_model[ModelT: BaseModel](
    model_type: type[ModelT], /, **data: object
) -> ModelT:
    try:
        return model_type(**data)
    except ValidationError as exc:
        raise typer.BadParameter(_validation_error_message(exc)) from exc


async def _with_client[ResponseT](
    base_url: str,
    auth_token: str | None,
    output_limit: int,
    idle_flush_seconds: float,
    action: Callable[[ShellctlClient], Awaitable[ResponseT]],
) -> ResponseT:
    async with ShellctlClient(
        base_url,
        output_limit=output_limit,
        idle_flush_seconds=idle_flush_seconds,
        token=auth_token,
    ) as client:
        return await action(client)


def _run_client_action[ResponseT](
    *,
    base_url: str,
    auth_token: str | None,
    action: Callable[[ShellctlClient], Awaitable[ResponseT]],
    emit: Callable[[ResponseT], None],
    output_limit: int = DEFAULT_OUTPUT_LIMIT_BYTES,
    idle_flush_seconds: float = DEFAULT_IDLE_FLUSH_SECONDS,
) -> None:
    try:
        payload = anyio.run(
            _with_client,
            base_url,
            auth_token,
            output_limit,
            idle_flush_seconds,
            action,
        )
    except ShellctlClientError as exc:
        _emit_error_and_exit(exc.code, exc.message)
    except httpx.TimeoutException:
        _emit_error_and_exit("request_timeout", "request timed out")
    except httpx.TransportError as exc:
        _emit_error_and_exit("connection_error", str(exc))

    emit(payload)


def _emit_model(model: BaseModel) -> None:
    typer.echo(model.model_dump_json(exclude_none=True), color=False)


def _emit_job_list(jobs: list[JobInfo]) -> None:
    typer.echo(
        json.dumps(
            [item.model_dump(mode="json", exclude_none=True) for item in jobs],
            separators=(",", ":"),
        ),
        color=False,
    )


def _emit_error_and_exit(code: str, message: str) -> NoReturn:
    typer.echo(
        json.dumps(
            {"error": {"code": code, "message": message}},
            separators=(",", ":"),
        ),
        err=True,
        color=False,
    )
    raise typer.Exit(code=1)


def _validation_error_message(exc: ValidationError) -> str:
    detail = exc.errors(include_url=False)[0]
    location = ".".join(str(part) for part in detail.get("loc", ()))
    message = detail["msg"]
    return f"{location}: {message}" if location else str(message)


__all__ = [
    "cli",
    "delete_command",
    "health_command",
    "input_command",
    "list_command",
    "main",
    "run_command",
    "serve_command",
    "status_command",
    "tail_command",
    "terminate_command",
    "wait_command",
]
