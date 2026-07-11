"""Configuration objects for shellctl server/runtime modules."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

from shellctl.shared.constants import (
    DEFAULT_AUTH_TOKEN_ENV,
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
    MAX_WAIT_TIMEOUT_SECONDS,
)
from shellctl.shared.runtime import (
    default_runtime_dir,
    default_state_dir,
)
from shellctl_runtime.paths import DEFAULT_SQLITE_BUSY_TIMEOUT_MS


@dataclass(slots=True, frozen=True)
class ShellctlConfig:
    """Runtime configuration for the shellctl service and CLI.

    The tmux subprocess hooks use dedicated console scripts instead of
    `python -m shellctl...` entrypoints so every job does not pay
    the shellctl client/server import cost just to sanitize PTY bytes or record
    an exit row. `sqlite_busy_timeout_ms` still applies to the out-of-process
    `runner-exit` callback, so non-default deployments keep one SQLite timeout
    policy across the service and tmux finalizer.

    Bearer auth is opt-in: if the explicit `auth_token` and the fallback
    `SHELLCTL_AUTH_TOKEN` environment variable are both missing or empty,
    `shellctl serve` accepts requests without checking an Authorization header.
    """

    listen: str = "127.0.0.1:8765"
    auth_token: str | None = None
    state_dir: Path = field(default_factory=default_state_dir)
    runtime_dir: Path | None = None
    gc_interval_seconds: float = DEFAULT_GC_INTERVAL_SECONDS
    gc_finished_job_retention_seconds: float = DEFAULT_GC_FINISHED_JOB_RETENTION_SECONDS
    default_timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    max_wait_timeout_seconds: float = MAX_WAIT_TIMEOUT_SECONDS
    idle_flush_seconds: float = DEFAULT_IDLE_FLUSH_SECONDS
    default_cwd: Path = field(default_factory=Path.home)
    default_terminal_cols: int = DEFAULT_TERMINAL_COLS
    default_terminal_rows: int = DEFAULT_TERMINAL_ROWS
    default_list_limit: int = DEFAULT_LIST_LIMIT
    max_list_limit: int = MAX_LIST_LIMIT
    default_output_limit_bytes: int = DEFAULT_OUTPUT_LIMIT_BYTES
    max_output_limit_bytes: int = MAX_OUTPUT_LIMIT_BYTES
    default_terminate_grace_seconds: float = DEFAULT_TERMINATE_GRACE_SECONDS
    poll_interval_seconds: float = 0.05
    pipe_monitor_interval_seconds: float = 1.0
    pipe_ready_timeout_seconds: float = 10.0
    sqlite_busy_timeout_ms: int = DEFAULT_SQLITE_BUSY_TIMEOUT_MS
    sanitize_pty_command: tuple[str, ...] = ("shellctl-sanitize-pty",)
    runner_exit_command: tuple[str, ...] = ("shellctl-runner-exit",)

    def __post_init__(self) -> None:
        if self.runtime_dir is None:
            object.__setattr__(self, "runtime_dir", default_runtime_dir(self.state_dir))
        token = self.auth_token
        if token is None:
            token = os.environ.get(DEFAULT_AUTH_TOKEN_ENV)
        if not token:
            token = None
        object.__setattr__(self, "auth_token", token)

    @property
    def jobs_dir(self) -> Path:
        return self.state_dir / "jobs"

    @property
    def db_path(self) -> Path:
        return self.state_dir / "shellctl.db"

    @property
    def database_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.db_path}"

    @property
    def tmux_socket(self) -> Path:
        runtime_dir = cast(Path, self.runtime_dir)
        return runtime_dir / "tmux.sock"

    @property
    def runner_path(self) -> Path:
        runtime_dir = cast(Path, self.runtime_dir)
        return runtime_dir / "bin" / "shellctl-runner"


__all__ = ["ShellctlConfig"]
