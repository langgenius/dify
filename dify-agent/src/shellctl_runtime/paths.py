"""Stdlib-only filesystem helpers shared by shellctl runtime commands."""

from __future__ import annotations

from pathlib import Path

DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5000


def db_path_from_state_dir(state_dir: Path) -> Path:
    """Resolve the SQLite database path for a shellctl state directory."""

    return state_dir / "shellctl.db"


__all__ = ["DEFAULT_SQLITE_BUSY_TIMEOUT_MS", "db_path_from_state_dir"]
