"""Per-job artifact names used by shellctl server/runtime code.

Normal job completion is coordinated through small marker files inside each
`jobs/<job_id>/` directory so the tmux output-pipe finalizer can publish the
SQLite `exited(exit_code, ended_at)` state only after PTY output is fully
drained into `output.log`. The same artifact directory also stores the request's
environment overlay so the runner can merge arbitrary key/value pairs without
shell-escaping them into the generated script. Separate failure markers and a
dedicated `pipe-error.log` stderr capture keep startup diagnostics available
when the sanitizer never reaches its ready-file handshake.
"""

from __future__ import annotations

from pathlib import Path

RUNNER_EXIT_CODE_FILENAME = ".runner-exit-code"
RUNNER_ENDED_AT_FILENAME = ".runner-ended-at"
JOB_ENV_FILENAME = ".job-env.json"
PIPE_DRAINED_FILENAME = ".pipe-drained"
PIPE_FAILED_FILENAME = ".pipe-failed"
PIPE_ERROR_LOG_FILENAME = "pipe-error.log"


def runner_exit_code_path(job_dir: Path) -> Path:
    return job_dir / RUNNER_EXIT_CODE_FILENAME


def runner_ended_at_path(job_dir: Path) -> Path:
    return job_dir / RUNNER_ENDED_AT_FILENAME


def job_env_path(job_dir: Path) -> Path:
    return job_dir / JOB_ENV_FILENAME


def pipe_drained_path(job_dir: Path) -> Path:
    return job_dir / PIPE_DRAINED_FILENAME


def pipe_failed_path(job_dir: Path) -> Path:
    return job_dir / PIPE_FAILED_FILENAME


def pipe_error_log_path(job_dir: Path) -> Path:
    return job_dir / PIPE_ERROR_LOG_FILENAME


__all__ = [
    "JOB_ENV_FILENAME",
    "PIPE_DRAINED_FILENAME",
    "PIPE_ERROR_LOG_FILENAME",
    "PIPE_FAILED_FILENAME",
    "RUNNER_ENDED_AT_FILENAME",
    "RUNNER_EXIT_CODE_FILENAME",
    "job_env_path",
    "pipe_drained_path",
    "pipe_error_log_path",
    "pipe_failed_path",
    "runner_ended_at_path",
    "runner_exit_code_path",
]
