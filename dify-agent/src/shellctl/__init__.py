"""Public shellctl package exports.

This package stays lazy on purpose. Hot-path runtime helpers live outside the
`shellctl` package, and importing this package root should
not pull the full client/server/public DTO surface unless a caller explicitly
asks for those exports.
"""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from shellctl.client import (
        ShellctlClient,
        ShellctlClientError,
    )
    from shellctl.shared import (
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
        DeleteJobResponse,
        HealthResponse,
        InputJobRequest,
        JobInfo,
        JobResult,
        JobStatusName,
        JobStatusView,
        ListJobsResponse,
        RunJobRequest,
        TerminalSize,
        TerminateJobRequest,
        WaitJobRequest,
        generate_job_id,
        read_output_window,
        tail_output_window,
    )

__all__ = [
    "DEFAULT_AUTH_TOKEN_ENV",
    "DEFAULT_BASE_URL",
    "DEFAULT_BASE_URL_ENV",
    "DEFAULT_GC_FINISHED_JOB_RETENTION_SECONDS",
    "DEFAULT_GC_INTERVAL_SECONDS",
    "DEFAULT_IDLE_FLUSH_SECONDS",
    "DEFAULT_LIST_LIMIT",
    "DEFAULT_OUTPUT_LIMIT_BYTES",
    "DEFAULT_TERMINAL_COLS",
    "DEFAULT_TERMINAL_ROWS",
    "DEFAULT_TERMINATE_GRACE_SECONDS",
    "DEFAULT_TIMEOUT_SECONDS",
    "DeleteJobResponse",
    "HealthResponse",
    "InputJobRequest",
    "JobInfo",
    "JobResult",
    "JobStatusName",
    "JobStatusView",
    "ListJobsResponse",
    "RunJobRequest",
    "ShellctlClient",
    "ShellctlClientError",
    "TerminalSize",
    "TerminateJobRequest",
    "WaitJobRequest",
    "generate_job_id",
    "read_output_window",
    "tail_output_window",
]

_EXPORTS = {
    "ShellctlClient": "shellctl.client",
    "ShellctlClientError": "shellctl.client",
    "DEFAULT_AUTH_TOKEN_ENV": "shellctl.shared",
    "DEFAULT_BASE_URL": "shellctl.shared",
    "DEFAULT_BASE_URL_ENV": "shellctl.shared",
    "DEFAULT_GC_FINISHED_JOB_RETENTION_SECONDS": "shellctl.shared",
    "DEFAULT_GC_INTERVAL_SECONDS": "shellctl.shared",
    "DEFAULT_IDLE_FLUSH_SECONDS": "shellctl.shared",
    "DEFAULT_LIST_LIMIT": "shellctl.shared",
    "DEFAULT_OUTPUT_LIMIT_BYTES": "shellctl.shared",
    "DEFAULT_TERMINAL_COLS": "shellctl.shared",
    "DEFAULT_TERMINAL_ROWS": "shellctl.shared",
    "DEFAULT_TERMINATE_GRACE_SECONDS": "shellctl.shared",
    "DEFAULT_TIMEOUT_SECONDS": "shellctl.shared",
    "DeleteJobResponse": "shellctl.shared",
    "HealthResponse": "shellctl.shared",
    "InputJobRequest": "shellctl.shared",
    "JobInfo": "shellctl.shared",
    "JobResult": "shellctl.shared",
    "JobStatusName": "shellctl.shared",
    "JobStatusView": "shellctl.shared",
    "ListJobsResponse": "shellctl.shared",
    "RunJobRequest": "shellctl.shared",
    "TerminalSize": "shellctl.shared",
    "TerminateJobRequest": "shellctl.shared",
    "WaitJobRequest": "shellctl.shared",
    "generate_job_id": "shellctl.shared",
    "read_output_window": "shellctl.shared",
    "tail_output_window": "shellctl.shared",
}


def __getattr__(name: str) -> Any:
    if name not in _EXPORTS:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(_EXPORTS[name])
    value = getattr(module, name)  # noqa: no-new-getattr lazy export proxy
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(__all__))
