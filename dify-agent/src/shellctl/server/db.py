"""SQLite models and engine helpers for shellctl."""

from __future__ import annotations

from typing import Any, cast

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlmodel import Field, SQLModel


class JobRow(SQLModel, table=True):
    """SQLite source-of-truth row for shellctl jobs.

    The table intentionally combines immutable metadata, mutable lifecycle state,
    and exit facts so state transitions can be expressed as single conditional
    `UPDATE` statements without synchronizing separate records.
    """

    __tablename__ = cast(Any, "jobs")

    job_id: str = Field(primary_key=True)
    script_path: str
    output_path: str
    cwd: str
    terminal_cols: int
    terminal_rows: int
    status: str = Field(index=True)
    session_name: str
    pane_target: str
    exit_code: int | None = Field(default=None, nullable=True)
    reason: str | None = Field(default=None, nullable=True)
    message: str | None = Field(default=None, nullable=True)
    created_at: str = Field(index=True)
    started_at: str | None = Field(default=None, nullable=True)
    ended_at: str | None = Field(default=None, nullable=True, index=True)
    updated_at: str


def configure_sqlite_engine(engine: AsyncEngine, *, busy_timeout_ms: int) -> None:
    """Install SQLite pragmas required by the proposal's concurrency model."""

    @event.listens_for(engine.sync_engine, "connect")
    def _set_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute(f"PRAGMA busy_timeout={busy_timeout_ms}")
        cursor.close()


__all__ = ["JobRow", "configure_sqlite_engine"]
