"""Shared pydantic transport models for shellctl."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator

from shellctl.shared.constants import (
    DEFAULT_HEALTH_STATUS,
    DEFAULT_IDLE_FLUSH_SECONDS,
    DEFAULT_OUTPUT_LIMIT_BYTES,
    DEFAULT_TERMINAL_COLS,
    DEFAULT_TERMINAL_ROWS,
    DEFAULT_TERMINATE_GRACE_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
    MAX_OUTPUT_LIMIT_BYTES,
    MAX_WAIT_TIMEOUT_SECONDS,
)


class ShellctlModel(BaseModel):
    """Base pydantic model with strict extra-field handling.

    shellctl uses these DTOs directly for HTTP request/response bodies, so
    silently accepting unknown fields would make it harder to detect schema
    drift.
    """

    model_config = ConfigDict(extra="forbid")


class JobStatusName(StrEnum):
    """Lifecycle states materialized into SQLite rows and API responses."""

    CREATED = "created"
    STARTING = "starting"
    RUNNING = "running"
    EXITED = "exited"
    TERMINATED = "terminated"
    FAILED = "failed"
    LOST = "lost"


TERMINAL_JOB_STATUSES = frozenset(
    {
        JobStatusName.EXITED,
        JobStatusName.TERMINATED,
        JobStatusName.FAILED,
        JobStatusName.LOST,
    }
)


class TerminalSize(ShellctlModel):
    """Requested initial PTY geometry for a job."""

    cols: int = Field(default=DEFAULT_TERMINAL_COLS, ge=1, le=4096)
    rows: int = Field(default=DEFAULT_TERMINAL_ROWS, ge=1, le=4096)


class JobResult(ShellctlModel):
    """Unified response shape for output-oriented job APIs."""

    job_id: str
    done: bool
    status: JobStatusName
    exit_code: int | None = None
    output_path: str
    output: str
    offset: int = Field(ge=0)
    truncated: bool


class JobStatusView(ShellctlModel):
    """Materialized lifecycle view returned by status-like APIs."""

    job_id: str
    status: JobStatusName
    done: bool
    exit_code: int | None = None
    created_at: str
    started_at: str | None = None
    ended_at: str | None = None
    offset: int = Field(ge=0)


class JobInfo(ShellctlModel):
    """Compact job listing record."""

    job_id: str
    status: JobStatusName
    created_at: str
    started_at: str | None = None
    ended_at: str | None = None


class ListJobsResponse(ShellctlModel):
    """Response body for `GET /v1/jobs`."""

    jobs: list[JobInfo]


class DeleteJobResponse(ShellctlModel):
    """Response body for successful delete operations."""

    job_id: str
    deleted: bool = True


class HealthResponse(ShellctlModel):
    """Public health check response."""

    status: str = DEFAULT_HEALTH_STATUS


class ErrorDetail(ShellctlModel):
    """Machine-readable API error payload."""

    code: str
    message: str


class ErrorResponse(ShellctlModel):
    """Envelope used by server-side exception handlers."""

    error: ErrorDetail


class RunJobRequest(ShellctlModel):
    """HTTP request body for `POST /v1/jobs/run`.

    `env` augments the runner's inherited process environment instead of
    replacing it, so callers can preset script-local variables without losing
    ambient values such as `PATH`.
    """

    script: str
    cwd: str | None = None
    env: dict[str, str] | None = None
    terminal: TerminalSize | None = None
    timeout: float = Field(default=DEFAULT_TIMEOUT_SECONDS, gt=0, le=MAX_WAIT_TIMEOUT_SECONDS)
    output_limit: int = Field(default=DEFAULT_OUTPUT_LIMIT_BYTES, ge=1, le=MAX_OUTPUT_LIMIT_BYTES)
    idle_flush_seconds: float = Field(default=DEFAULT_IDLE_FLUSH_SECONDS, ge=0, le=30)

    @field_validator("env")
    @classmethod
    def _validate_env(cls, env: dict[str, str] | None) -> dict[str, str] | None:
        """Reject env entries that cannot be represented in `execve`.

        shellctl applies `env` as a process environment overlay, so validation
        follows the low-level `NAME=value` constraints instead of shell variable
        naming rules: names must be non-empty and cannot contain `=` or NUL,
        while values cannot contain NUL.
        """

        if env is None:
            return None
        for name, value in env.items():
            if not name:
                raise ValueError("env names must be non-empty")
            if "=" in name:
                raise ValueError(f"env name must not contain '=': {name!r}")
            if "\x00" in name:
                raise ValueError(f"env name must not contain NUL: {name!r}")
            if "\x00" in value:
                raise ValueError(f"env value must not contain NUL: {name!r}")
        return env


class WaitJobRequest(ShellctlModel):
    """HTTP request body for `POST /v1/jobs/{job_id}/wait`."""

    timeout: float = Field(default=DEFAULT_TIMEOUT_SECONDS, ge=0, le=MAX_WAIT_TIMEOUT_SECONDS)
    offset: int = Field(ge=0)
    output_limit: int = Field(default=DEFAULT_OUTPUT_LIMIT_BYTES, ge=1, le=MAX_OUTPUT_LIMIT_BYTES)
    idle_flush_seconds: float = Field(default=DEFAULT_IDLE_FLUSH_SECONDS, ge=0, le=30)


class InputJobRequest(ShellctlModel):
    """HTTP request body for `POST /v1/jobs/{job_id}/input`."""

    text: str
    timeout: float = Field(default=DEFAULT_TIMEOUT_SECONDS, gt=0, le=MAX_WAIT_TIMEOUT_SECONDS)
    offset: int = Field(ge=0)
    output_limit: int = Field(default=DEFAULT_OUTPUT_LIMIT_BYTES, ge=1, le=MAX_OUTPUT_LIMIT_BYTES)
    idle_flush_seconds: float = Field(default=DEFAULT_IDLE_FLUSH_SECONDS, ge=0, le=30)


class TerminateJobRequest(ShellctlModel):
    """HTTP request body for `POST /v1/jobs/{job_id}/terminate`."""

    grace_seconds: float = Field(default=DEFAULT_TERMINATE_GRACE_SECONDS, ge=0, le=300)


__all__ = [
    "TERMINAL_JOB_STATUSES",
    "DeleteJobResponse",
    "ErrorDetail",
    "ErrorResponse",
    "HealthResponse",
    "InputJobRequest",
    "JobInfo",
    "JobResult",
    "JobStatusName",
    "JobStatusView",
    "ListJobsResponse",
    "RunJobRequest",
    "ShellctlModel",
    "TerminalSize",
    "TerminateJobRequest",
    "WaitJobRequest",
]
