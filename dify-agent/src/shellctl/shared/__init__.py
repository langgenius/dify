"""Shared shellctl transport/runtime helpers.

This package preserves the historical import surface while keeping the package
root lazy. Lightweight callers can import concrete submodules such as
`shared.runtime` without eagerly importing the pydantic schema layer, output
or helpers outside the shared compatibility surface.
"""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from shellctl.shared.constants import (
        DEFAULT_AUTH_TOKEN_ENV,
        DEFAULT_BASE_URL,
        DEFAULT_BASE_URL_ENV,
        DEFAULT_GC_FINISHED_JOB_RETENTION_SECONDS,
        DEFAULT_GC_INTERVAL_SECONDS,
        DEFAULT_HEALTH_STATUS,
        DEFAULT_IDLE_FLUSH_SECONDS,
        DEFAULT_LIST_LIMIT,
        DEFAULT_OUTPUT_LIMIT_BYTES,
        DEFAULT_TERMINAL_COLS,
        DEFAULT_TERMINAL_ROWS,
        DEFAULT_TERMINATE_GRACE_SECONDS,
        DEFAULT_TIMEOUT_SECONDS,
        JOB_ID_ALPHABET,
        JOB_ID_RANDOM_SUFFIX_LENGTH,
        MAX_LIST_LIMIT,
        MAX_OUTPUT_LIMIT_BYTES,
        MAX_WAIT_TIMEOUT_SECONDS,
        SESSION_NAME_PREFIX,
    )
    from shellctl.shared.output import (
        OutputWindow,
        read_output_window,
        tail_output_window,
    )
    from shellctl.shared.runtime import (
        default_runtime_dir,
        default_state_dir,
        format_timestamp,
        generate_job_id,
        is_terminal_status,
        job_pane_target,
        job_session_name,
        parse_timestamp,
        utc_now,
    )
    from shellctl.shared.schemas import (
        TERMINAL_JOB_STATUSES,
        DeleteJobResponse,
        ErrorDetail,
        ErrorResponse,
        HealthResponse,
        InputJobRequest,
        JobInfo,
        JobResult,
        JobStatusName,
        JobStatusView,
        ListJobsResponse,
        RunJobRequest,
        ShellctlModel,
        TerminalSize,
        TerminateJobRequest,
        WaitJobRequest,
    )

__all__ = [
    "DEFAULT_AUTH_TOKEN_ENV",
    "DEFAULT_BASE_URL",
    "DEFAULT_BASE_URL_ENV",
    "DEFAULT_GC_FINISHED_JOB_RETENTION_SECONDS",
    "DEFAULT_GC_INTERVAL_SECONDS",
    "DEFAULT_HEALTH_STATUS",
    "DEFAULT_IDLE_FLUSH_SECONDS",
    "DEFAULT_LIST_LIMIT",
    "DEFAULT_OUTPUT_LIMIT_BYTES",
    "DEFAULT_TERMINAL_COLS",
    "DEFAULT_TERMINAL_ROWS",
    "DEFAULT_TERMINATE_GRACE_SECONDS",
    "DEFAULT_TIMEOUT_SECONDS",
    "JOB_ID_ALPHABET",
    "JOB_ID_RANDOM_SUFFIX_LENGTH",
    "MAX_LIST_LIMIT",
    "MAX_OUTPUT_LIMIT_BYTES",
    "MAX_WAIT_TIMEOUT_SECONDS",
    "SESSION_NAME_PREFIX",
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
    "OutputWindow",
    "RunJobRequest",
    "ShellctlModel",
    "TerminalSize",
    "TerminateJobRequest",
    "WaitJobRequest",
    "default_runtime_dir",
    "default_state_dir",
    "format_timestamp",
    "generate_job_id",
    "is_terminal_status",
    "job_pane_target",
    "job_session_name",
    "parse_timestamp",
    "read_output_window",
    "tail_output_window",
    "utc_now",
]

_EXPORTS = {
    "DEFAULT_AUTH_TOKEN_ENV": "shellctl.shared.constants",
    "DEFAULT_BASE_URL": "shellctl.shared.constants",
    "DEFAULT_BASE_URL_ENV": "shellctl.shared.constants",
    "DEFAULT_GC_FINISHED_JOB_RETENTION_SECONDS": "shellctl.shared.constants",
    "DEFAULT_GC_INTERVAL_SECONDS": "shellctl.shared.constants",
    "DEFAULT_HEALTH_STATUS": "shellctl.shared.constants",
    "DEFAULT_IDLE_FLUSH_SECONDS": "shellctl.shared.constants",
    "DEFAULT_LIST_LIMIT": "shellctl.shared.constants",
    "DEFAULT_OUTPUT_LIMIT_BYTES": "shellctl.shared.constants",
    "DEFAULT_TERMINAL_COLS": "shellctl.shared.constants",
    "DEFAULT_TERMINAL_ROWS": "shellctl.shared.constants",
    "DEFAULT_TERMINATE_GRACE_SECONDS": "shellctl.shared.constants",
    "DEFAULT_TIMEOUT_SECONDS": "shellctl.shared.constants",
    "JOB_ID_ALPHABET": "shellctl.shared.constants",
    "JOB_ID_RANDOM_SUFFIX_LENGTH": "shellctl.shared.constants",
    "MAX_LIST_LIMIT": "shellctl.shared.constants",
    "MAX_OUTPUT_LIMIT_BYTES": "shellctl.shared.constants",
    "MAX_WAIT_TIMEOUT_SECONDS": "shellctl.shared.constants",
    "SESSION_NAME_PREFIX": "shellctl.shared.constants",
    "OutputWindow": "shellctl.shared.output",
    "read_output_window": "shellctl.shared.output",
    "tail_output_window": "shellctl.shared.output",
    "default_runtime_dir": "shellctl.shared.runtime",
    "default_state_dir": "shellctl.shared.runtime",
    "format_timestamp": "shellctl.shared.runtime",
    "generate_job_id": "shellctl.shared.runtime",
    "is_terminal_status": "shellctl.shared.runtime",
    "job_pane_target": "shellctl.shared.runtime",
    "job_session_name": "shellctl.shared.runtime",
    "parse_timestamp": "shellctl.shared.runtime",
    "utc_now": "shellctl.shared.runtime",
    "TERMINAL_JOB_STATUSES": "shellctl.shared.schemas",
    "DeleteJobResponse": "shellctl.shared.schemas",
    "ErrorDetail": "shellctl.shared.schemas",
    "ErrorResponse": "shellctl.shared.schemas",
    "HealthResponse": "shellctl.shared.schemas",
    "InputJobRequest": "shellctl.shared.schemas",
    "JobInfo": "shellctl.shared.schemas",
    "JobResult": "shellctl.shared.schemas",
    "JobStatusName": "shellctl.shared.schemas",
    "JobStatusView": "shellctl.shared.schemas",
    "ListJobsResponse": "shellctl.shared.schemas",
    "RunJobRequest": "shellctl.shared.schemas",
    "ShellctlModel": "shellctl.shared.schemas",
    "TerminalSize": "shellctl.shared.schemas",
    "TerminateJobRequest": "shellctl.shared.schemas",
    "WaitJobRequest": "shellctl.shared.schemas",
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
