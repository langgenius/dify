"""Server-side `shellctl serve` implementation.

This module stays separate from the top-level CLI so ordinary client commands
do not import the FastAPI or uvicorn stack. `serve_command()` performs those
imports lazily because only the long-running server path needs them.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

import typer

from shellctl.shared.constants import (
    DEFAULT_AUTH_TOKEN_ENV,
    DEFAULT_GC_FINISHED_JOB_RETENTION_SECONDS,
    DEFAULT_GC_INTERVAL_SECONDS,
)
from shellctl.shared.runtime import (
    default_state_dir,
)

if TYPE_CHECKING:
    from shellctl.server.config import ShellctlConfig


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
    gc_interval_seconds: float = DEFAULT_GC_INTERVAL_SECONDS,
    gc_finished_job_retention_seconds: float = DEFAULT_GC_FINISHED_JOB_RETENTION_SECONDS,
) -> None:
    """Build `ShellctlConfig` from CLI inputs and run the local HTTP server.

    Args:
        listen: Host/port pair for the uvicorn listener in `host:port` form.
        auth_token: Optional bearer token value. An explicit empty string
            disables HTTP auth, an explicit non-empty token enables it, and an
            omitted/`None` value may still resolve from `SHELLCTL_AUTH_TOKEN`
            through the Typer env var binding or `ShellctlConfig` fallback.
        state_dir: Persistent shellctl state directory; defaults to the shared
            XDG-style state path when omitted.
        runtime_dir: Optional runtime directory override for tmux/runtime
            artifacts.
        gc_interval_seconds: Background GC wake-up cadence for finished jobs.
        gc_finished_job_retention_seconds: Retention window before finished jobs
            are eligible for GC.

    This entrypoint is the only CLI path that should pull in the FastAPI and
    uvicorn stack. It parses the listener, constructs `ShellctlConfig`, and
    then hands the configured app to uvicorn.
    """

    from shellctl.server.config import ShellctlConfig

    host, port = _parse_listen(listen)
    config = ShellctlConfig(
        listen=listen,
        auth_token=auth_token,
        state_dir=state_dir or default_state_dir(),
        runtime_dir=runtime_dir,
        gc_interval_seconds=gc_interval_seconds,
        gc_finished_job_retention_seconds=gc_finished_job_retention_seconds,
    )
    _uvicorn_run(_create_app(config), host=host, port=port, log_level="info")


def _parse_listen(value: str) -> tuple[str, int]:
    if ":" not in value:
        raise typer.BadParameter("listen must use host:port format")
    host, raw_port = value.rsplit(":", 1)
    host = host.strip("[]")
    try:
        port = int(raw_port)
    except ValueError as exc:
        raise typer.BadParameter(f"invalid port: {raw_port}") from exc
    return host, port


def _create_app(config: ShellctlConfig) -> Any:
    from shellctl.server.api import create_app

    return create_app(config)


def _uvicorn_run(app: Any, *, host: str, port: int, log_level: str) -> None:
    import uvicorn

    uvicorn.run(app, host=host, port=port, log_level=log_level)


__all__ = ["serve_command"]
