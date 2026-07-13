"""Lightweight SQLite updater for drained shellctl job exits.

This command runs after the tmux output pipe reaches EOF and flushes
`output.log`. It must stay stdlib-only so exit-state materialization does not
pay the FastAPI/SQLAlchemy import cost on every job completion. The CLI accepts
the busy-timeout override from `ShellctlConfig` so non-default deployments keep
the same SQLite locking behavior in and out of process.
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

from shellctl_runtime.paths import (
    DEFAULT_SQLITE_BUSY_TIMEOUT_MS,
    db_path_from_state_dir,
)

TERMINAL_STATUSES = frozenset({"exited", "terminated", "failed", "lost"})
NONTERMINAL_STATUSES = frozenset({"created", "starting", "running"})


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the tmux finalizer CLI contract."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--exit-code", required=True, type=int)
    parser.add_argument("--ended-at", required=True)
    parser.add_argument(
        "--sqlite-busy-timeout-ms",
        type=int,
        default=DEFAULT_SQLITE_BUSY_TIMEOUT_MS,
    )
    return parser.parse_args(argv)


def record_runner_exit(
    *,
    state_dir: Path,
    job_id: str,
    exit_code: int,
    ended_at: str,
    busy_timeout_ms: int = DEFAULT_SQLITE_BUSY_TIMEOUT_MS,
) -> None:
    """Persist a drained runner exit directly into the shellctl SQLite DB.

    The update is idempotent for terminal rows: once a job reaches a terminal
    state, this helper returns successfully without rewriting the row. The
    terminal/non-terminal decision is repeated inside the `UPDATE` itself so a
    concurrent writer cannot be clobbered by a stale pre-read.
    """

    db_path = db_path_from_state_dir(state_dir)
    if not db_path.exists():
        raise FileNotFoundError(f"shellctl database not found: {db_path}")

    connection = sqlite3.connect(db_path, timeout=busy_timeout_ms / 1000)
    try:
        connection.execute(f"PRAGMA busy_timeout={busy_timeout_ms}")
        row = connection.execute(
            "SELECT status FROM jobs WHERE job_id = ?",
            (job_id,),
        ).fetchone()
        if row is None:
            raise LookupError(f"Unknown job id: {job_id}")
        status = str(row[0])
        if status in TERMINAL_STATUSES:
            return
        if status not in NONTERMINAL_STATUSES:
            raise ValueError(f"Unsupported shellctl job status: {status}")
        nonterminal = tuple(NONTERMINAL_STATUSES)
        cursor = connection.execute(
            """
            UPDATE jobs
            SET status = CASE
                    WHEN status IN (?, ?, ?) THEN ?
                    ELSE status
                END,
                exit_code = CASE
                    WHEN status IN (?, ?, ?) THEN ?
                    ELSE exit_code
                END,
                ended_at = CASE
                    WHEN status IN (?, ?, ?) THEN ?
                    ELSE ended_at
                END,
                updated_at = CASE
                    WHEN status IN (?, ?, ?) THEN ?
                    ELSE updated_at
                END,
                reason = CASE
                    WHEN status IN (?, ?, ?) THEN NULL
                    ELSE reason
                END,
                message = CASE
                    WHEN status IN (?, ?, ?) THEN NULL
                    ELSE message
                END
            WHERE job_id = ?
            """,
            (
                *nonterminal,
                "exited",
                *nonterminal,
                exit_code,
                *nonterminal,
                ended_at,
                *nonterminal,
                ended_at,
                *nonterminal,
                *nonterminal,
                job_id,
            ),
        )
        if cursor.rowcount == 0:
            raise LookupError(f"Unknown job id: {job_id}")
        connection.commit()
    finally:
        connection.close()


def main(argv: list[str] | None = None) -> None:
    """Run the standalone runner-exit command."""

    args = parse_args(argv)
    try:
        record_runner_exit(
            state_dir=args.state_dir,
            job_id=args.job_id,
            exit_code=args.exit_code,
            ended_at=args.ended_at,
            busy_timeout_ms=args.sqlite_busy_timeout_ms,
        )
    except (
        FileNotFoundError,
        LookupError,
        OSError,
        sqlite3.DatabaseError,
        ValueError,
    ) as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()


__all__ = [
    "NONTERMINAL_STATUSES",
    "TERMINAL_STATUSES",
    "main",
    "parse_args",
    "record_runner_exit",
]
