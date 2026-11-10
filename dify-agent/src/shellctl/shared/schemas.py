"""Shared pydantic transport models for shellctl."""

from __future__ import annotations

from enum import StrEnum
from datetime import datetime
from typing import Literal
import re

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from shellctl.shared.constants import (
    DEFAULT_HEALTH_STATUS,
    DEFAULT_IDLE_FLUSH_SECONDS,
    DEFAULT_OUTPUT_LIMIT_BYTES,
    DEFAULT_TERMINAL_COLS,
    DEFAULT_TERMINAL_ROWS,
    DEFAULT_TERMINATE_GRACE_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
    MAX_OUTPUT_LIMIT_BYTES,
    SHELL_TOOL_HARD_TIMEOUT_SECONDS,
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


class JobMode(StrEnum):
    """Standard-stream wiring used to execute a shellctl job."""

    PTY = "pty"
    STDIO = "stdio"


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
    mode: JobMode = JobMode.PTY
    timeout: float = Field(default=DEFAULT_TIMEOUT_SECONDS, gt=0, le=SHELL_TOOL_HARD_TIMEOUT_SECONDS)
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

    timeout: float = Field(default=DEFAULT_TIMEOUT_SECONDS, ge=0, le=SHELL_TOOL_HARD_TIMEOUT_SECONDS)
    offset: int = Field(ge=0)
    output_limit: int = Field(default=DEFAULT_OUTPUT_LIMIT_BYTES, ge=1, le=MAX_OUTPUT_LIMIT_BYTES)
    idle_flush_seconds: float = Field(default=DEFAULT_IDLE_FLUSH_SECONDS, ge=0, le=30)


class InputJobRequest(ShellctlModel):
    """HTTP request body for `POST /v1/jobs/{job_id}/input`."""

    text: str
    timeout: float = Field(default=DEFAULT_TIMEOUT_SECONDS, gt=0, le=SHELL_TOOL_HARD_TIMEOUT_SECONDS)
    offset: int = Field(ge=0)
    output_limit: int = Field(default=DEFAULT_OUTPUT_LIMIT_BYTES, ge=1, le=MAX_OUTPUT_LIMIT_BYTES)
    idle_flush_seconds: float = Field(default=DEFAULT_IDLE_FLUSH_SECONDS, ge=0, le=30)


class TerminateJobRequest(ShellctlModel):
    """HTTP request body for `POST /v1/jobs/{job_id}/terminate`."""

    grace_seconds: float = Field(default=DEFAULT_TERMINATE_GRACE_SECONDS, ge=0, le=SHELL_TOOL_HARD_TIMEOUT_SECONDS)


__all__ = [
    "TERMINAL_JOB_STATUSES",
    "DeleteJobResponse",
    "ErrorDetail",
    "ErrorResponse",
    "HealthResponse",
    "InputJobRequest",
    "JobInfo",
    "JobMode",
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


class NativeScopeLimits(ShellctlModel):
    """Finite supervisor limits; these never relax ordinary shellctl defaults."""

    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    cpu_quota: int = Field(ge=1000, le=800000)
    memory_bytes: int = Field(ge=64 << 20, le=8 << 30)
    pids: int = Field(ge=8, le=512)
    fds: int = Field(ge=32, le=4096)
    wall_seconds: int = Field(ge=1, le=3600)
    input_bytes: int = Field(ge=1, le=16 << 20)
    output_bytes: int = Field(ge=4096, le=64 << 20)
    disk_bytes: int = Field(ge=1 << 20, le=1 << 30)


class NativeNetworkTarget(ShellctlModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)
    max_bytes: int = Field(ge=1, le=16 << 20)
    timeout_seconds: int = Field(ge=1, le=60)


class NativeScopeSpec(ShellctlModel):
    """Immutable reference-only request to the private native supervisor."""

    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    scope_id: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$")
    generation: int = Field(ge=1)
    binding_ref: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$")
    base_snapshot_ref: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$")
    input_file_refs: tuple[str, ...] = Field(default=(), max_length=64)
    capability_digest: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    deadline: datetime
    limits: NativeScopeLimits
    network_targets: tuple[NativeNetworkTarget, ...] = Field(default=(), max_length=16)

    @field_validator("input_file_refs")
    @classmethod
    def opaque_file_references(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}", item) is None for item in value):
            raise ValueError("input file references must be opaque safe identifiers")
        return value


class NativeScopeHandle(ShellctlModel):
    """Ephemeral transport handle; credentials are excluded from serialization."""

    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    scope_id: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$")
    generation: int = Field(ge=1)
    status: Literal["ready"]
    token: SecretStr = Field(exclude=True, repr=False)
