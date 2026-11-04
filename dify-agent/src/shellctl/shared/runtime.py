"""Stable runtime/naming helpers shared across shellctl modules."""

from __future__ import annotations

import os
import secrets
from datetime import UTC, datetime
from pathlib import Path

from shellctl.shared.constants import (
    JOB_ID_ALPHABET,
    JOB_ID_RANDOM_SUFFIX_LENGTH,
    SESSION_NAME_PREFIX,
)
from shellctl.shared.schemas import (
    TERMINAL_JOB_STATUSES,
    JobStatusName,
)


def utc_now() -> datetime:
    """Return the current UTC time with timezone information."""

    return datetime.now(UTC)


def format_timestamp(value: datetime | None = None) -> str:
    """Format a UTC timestamp in the stable artifact/API representation."""

    moment = (value or utc_now()).astimezone(UTC).replace(microsecond=0)
    return moment.isoformat().replace("+00:00", "Z")


def parse_timestamp(value: str) -> datetime:
    """Parse an artifact/API timestamp back into a timezone-aware datetime."""

    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def is_terminal_status(status: JobStatusName) -> bool:
    """Check whether a lifecycle state is terminal."""

    return status in TERMINAL_JOB_STATUSES


def generate_job_id(*, now: datetime | None = None) -> str:
    """Generate a short, human-readable job id."""

    timestamp = (now or utc_now()).astimezone(UTC).strftime("%m%d%H%M")
    suffix = "".join(secrets.choice(JOB_ID_ALPHABET) for _ in range(JOB_ID_RANDOM_SUFFIX_LENGTH))
    return f"{timestamp}-{suffix}"


def job_session_name(job_id: str) -> str:
    """Return the dedicated tmux session name for a job."""

    return f"{SESSION_NAME_PREFIX}{job_id}"


def job_pane_target(job_id: str) -> str:
    """Return the canonical tmux pane target for a single-pane job session."""

    return f"{job_session_name(job_id)}:0.0"


def default_state_dir() -> Path:
    """Resolve the XDG-style default shellctl state directory."""

    xdg_state_home = os.environ.get("XDG_STATE_HOME")
    if xdg_state_home:
        return Path(xdg_state_home) / "shellctl"
    return Path.home() / ".local" / "state" / "shellctl"


def default_runtime_dir(state_dir: Path | None = None) -> Path:
    """Resolve the XDG-style default shellctl runtime directory."""

    xdg_runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
    if xdg_runtime_dir:
        return Path(xdg_runtime_dir) / "shellctl"
    base_state_dir = state_dir or default_state_dir()
    return base_state_dir / "run" / "shellctl"


__all__ = [
    "default_runtime_dir",
    "default_state_dir",
    "format_timestamp",
    "generate_job_id",
    "is_terminal_status",
    "job_pane_target",
    "job_session_name",
    "parse_timestamp",
    "utc_now",
]
