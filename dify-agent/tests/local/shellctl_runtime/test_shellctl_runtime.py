from __future__ import annotations

import ast
import importlib.metadata
import importlib.util
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import textwrap
from pathlib import Path
from types import TracebackType
from typing import BinaryIO, TypedDict, cast

import anyio
import pytest

from shellctl.server import ShellctlConfig, ShellctlService
from shellctl_runtime.runner_exit import record_runner_exit
from shellctl_runtime.sanitize import run_sanitize_pty

PACKAGE_ROOT = Path(__file__).resolve().parents[3]
SRC_PATH = PACKAGE_ROOT / "src"
HEAVY_IMPORT_ROOTS = {
    "fastapi",
    "httpx",
    "pydantic",
    "pygments",
    "rich",
    "sqlalchemy",
    "shellctl",
    "typer",
    "uvicorn",
}


class ModuleHelpStats(TypedDict):
    code: int
    elapsed: float
    deny: list[str]


def _pythonpath_env() -> dict[str, str]:
    env = dict(os.environ)
    current_pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = f"{SRC_PATH}{os.pathsep}{current_pythonpath}" if current_pythonpath else str(SRC_PATH)
    return env


async def _initialize_database(state_dir: Path) -> None:
    service = ShellctlService(ShellctlConfig(state_dir=state_dir, runtime_dir=state_dir / "run"))
    await service.initialize_database()
    await service.shutdown()


def _insert_job_row(
    *,
    state_dir: Path,
    job_id: str,
    status: str,
    exit_code: int | None = None,
    ended_at: str | None = None,
    reason: str | None = None,
    message: str | None = None,
    updated_at: str = "2026-05-21T15:30:13Z",
) -> None:
    db_path = state_dir / "shellctl.db"
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO jobs (
                job_id,
                script_path,
                output_path,
                cwd,
                terminal_cols,
                terminal_rows,
                status,
                session_name,
                pane_target,
                exit_code,
                reason,
                message,
                created_at,
                started_at,
                ended_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                f"jobs/{job_id}/script",
                f"jobs/{job_id}/output.log",
                "/tmp",
                80,
                24,
                status,
                f"shellctl-{job_id}",
                f"shellctl-{job_id}:0.0",
                exit_code,
                reason,
                message,
                "2026-05-21T15:30:12Z",
                "2026-05-21T15:30:13Z",
                ended_at,
                updated_at,
            ),
        )
        connection.commit()


def _fetch_job_row(state_dir: Path, job_id: str) -> tuple[object, ...]:
    with sqlite3.connect(state_dir / "shellctl.db") as connection:
        row = connection.execute(
            """
            SELECT status, exit_code, ended_at, updated_at, reason, message
            FROM jobs
            WHERE job_id = ?
            """,
            (job_id,),
        ).fetchone()
    assert row is not None
    return row


def _measure_module_help(module_name: str) -> ModuleHelpStats:
    script = textwrap.dedent(
        f"""
        import contextlib
        import io
        import json
        import runpy
        import sys
        import time

        sys.path.insert(0, {str(SRC_PATH)!r})
        sys.argv = [{module_name!r}, "--help"]
        start = time.perf_counter()
        stdout = io.StringIO()
        stderr = io.StringIO()
        code = 0
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            try:
                runpy.run_module({module_name!r}, run_name="__main__")
            except SystemExit as exc:
                if isinstance(exc.code, int):
                    code = exc.code
        elapsed = time.perf_counter() - start
        deny = sorted(
            name
            for name in sys.modules
            if name.split(".", 1)[0] in {sorted(HEAVY_IMPORT_ROOTS)!r}
        )
        print(json.dumps({{"code": code, "elapsed": elapsed, "deny": deny}}))
        """
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        check=False,
        cwd=PACKAGE_ROOT,
    )
    assert result.returncode == 0, result.stderr
    return cast(ModuleHelpStats, json.loads(result.stdout))


def test_run_sanitize_pty_touches_ready_file_before_reading(tmp_path: Path) -> None:
    ready_file = tmp_path / "ready"
    output = io.BytesIO()

    class ReadyCheckingInput:
        def __init__(self) -> None:
            self._reads = 0

        def read(self, _size: int) -> bytes:
            self._reads += 1
            assert ready_file.exists()
            return b"before\rafter\n" if self._reads == 1 else b""

    run_sanitize_pty(
        ready_file,
        stdin=cast(BinaryIO, cast(object, ReadyCheckingInput())),
        stdout=output,
    )

    assert output.getvalue() == b"after\n"


def test_removed_sanitizer_modules_are_not_importable() -> None:
    assert importlib.util.find_spec("shellctl.sanitize_pty") is None
    assert importlib.util.find_spec("shellctl.shared.sanitize") is None


def test_removed_sanitizer_helpers_are_not_shellctl_exports() -> None:
    import shellctl as shellctl
    import shellctl.shared as shared

    for module in (shellctl, shared):
        for name in ("PtySanitizer", "sanitize_pty_output", "sanitize_pty_stream"):
            assert not hasattr(module, name)


def test_runner_exit_matches_service_state_for_running_job(tmp_path: Path) -> None:
    runtime_state_dir = tmp_path / "runtime-state"
    service_state_dir = tmp_path / "service-state"
    anyio.run(_initialize_database, runtime_state_dir)
    anyio.run(_initialize_database, service_state_dir)
    _insert_job_row(state_dir=runtime_state_dir, job_id="job-1", status="running")
    _insert_job_row(state_dir=service_state_dir, job_id="job-1", status="running")

    record_runner_exit(
        state_dir=runtime_state_dir,
        job_id="job-1",
        exit_code=7,
        ended_at="2026-05-21T15:30:20Z",
    )

    async def _record_with_service() -> None:
        service = ShellctlService(
            ShellctlConfig(
                state_dir=service_state_dir,
                runtime_dir=service_state_dir / "run",
            )
        )
        try:
            await service.record_runner_exit("job-1", 7, "2026-05-21T15:30:20Z")
        finally:
            await service.shutdown()

    anyio.run(_record_with_service)

    assert _fetch_job_row(runtime_state_dir, "job-1") == _fetch_job_row(
        service_state_dir,
        "job-1",
    )


def test_runner_exit_is_idempotent_for_terminal_job(tmp_path: Path) -> None:
    state_dir = tmp_path / "state"
    anyio.run(_initialize_database, state_dir)
    _insert_job_row(
        state_dir=state_dir,
        job_id="job-2",
        status="failed",
        exit_code=99,
        ended_at="2026-05-21T15:30:18Z",
        reason="runner_failed",
        message="boom",
        updated_at="2026-05-21T15:30:18Z",
    )

    before = _fetch_job_row(state_dir, "job-2")
    record_runner_exit(
        state_dir=state_dir,
        job_id="job-2",
        exit_code=7,
        ended_at="2026-05-21T15:30:20Z",
    )

    assert _fetch_job_row(state_dir, "job-2") == before


def test_runner_exit_uses_explicit_busy_timeout_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    state_dir = tmp_path / "state"
    anyio.run(_initialize_database, state_dir)
    _insert_job_row(state_dir=state_dir, job_id="job-3", status="running")

    captured: dict[str, object] = {}
    real_connect = sqlite3.connect

    class RecordingConnection:
        def __init__(self, connection: sqlite3.Connection) -> None:
            self._connection = connection

        def execute(self, sql: str, parameters: tuple[object, ...] = ()) -> sqlite3.Cursor:
            if sql.startswith("PRAGMA busy_timeout="):
                captured["pragma"] = sql
            return self._connection.execute(sql, parameters)

        def commit(self) -> None:
            self._connection.commit()

        def close(self) -> None:
            self._connection.close()

    def fake_connect(path: str | Path, timeout: float) -> RecordingConnection:
        captured["path"] = str(path)
        captured["timeout"] = timeout
        return RecordingConnection(real_connect(path, timeout=timeout))

    monkeypatch.setattr("shellctl_runtime.runner_exit.sqlite3.connect", fake_connect)

    record_runner_exit(
        state_dir=state_dir,
        job_id="job-3",
        exit_code=5,
        ended_at="2026-05-21T15:30:20Z",
        busy_timeout_ms=6789,
    )

    assert captured["path"] == str(state_dir / "shellctl.db")
    assert captured["timeout"] == pytest.approx(6.789)
    assert captured["pragma"] == "PRAGMA busy_timeout=6789"


def test_runner_exit_does_not_clobber_newer_terminal_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    state_dir = tmp_path / "state"
    anyio.run(_initialize_database, state_dir)
    _insert_job_row(state_dir=state_dir, job_id="job-4", status="running")

    real_connect = sqlite3.connect

    class RacingConnection:
        def __init__(self, connection: sqlite3.Connection) -> None:
            self._connection = connection
            self._raced = False

        def __enter__(self) -> RacingConnection:
            self._connection.__enter__()
            return self

        def __exit__(
            self,
            exc_type: type[BaseException] | None,
            exc: BaseException | None,
            tb: TracebackType | None,
        ) -> bool | None:
            return self._connection.__exit__(exc_type, exc, tb)

        def execute(self, sql: str, parameters: tuple[object, ...] = ()) -> sqlite3.Cursor:
            if sql.lstrip().startswith("UPDATE jobs") and not self._raced:
                self._raced = True
                with real_connect(state_dir / "shellctl.db") as racing_connection:
                    racing_connection.execute(
                        """
                        UPDATE jobs
                        SET status = ?, exit_code = ?, ended_at = ?, updated_at = ?,
                            reason = ?, message = ?
                        WHERE job_id = ?
                        """,
                        (
                            "failed",
                            91,
                            "2026-05-21T15:30:19Z",
                            "2026-05-21T15:30:19Z",
                            "pipe_failed",
                            "concurrent winner",
                            "job-4",
                        ),
                    )
                    racing_connection.commit()
            return self._connection.execute(sql, parameters)

        def commit(self) -> None:
            self._connection.commit()

        def close(self) -> None:
            self._connection.close()

    def fake_connect(path: str | Path, timeout: float = 5.0, *args: object, **kwargs: object) -> RacingConnection:
        return RacingConnection(real_connect(path, timeout=timeout))

    monkeypatch.setattr("shellctl_runtime.runner_exit.sqlite3.connect", fake_connect)

    record_runner_exit(
        state_dir=state_dir,
        job_id="job-4",
        exit_code=7,
        ended_at="2026-05-21T15:30:20Z",
    )

    assert _fetch_job_row(state_dir, "job-4") == (
        "failed",
        91,
        "2026-05-21T15:30:19Z",
        "2026-05-21T15:30:19Z",
        "pipe_failed",
        "concurrent winner",
    )


def test_python_m_shellctl_runtime_runner_exit_updates_row(tmp_path: Path) -> None:
    state_dir = tmp_path / "state"
    anyio.run(_initialize_database, state_dir)
    _insert_job_row(state_dir=state_dir, job_id="job-cli", status="running")

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "shellctl_runtime.runner_exit",
            "--state-dir",
            str(state_dir),
            "--job-id",
            "job-cli",
            "--exit-code",
            "7",
            "--ended-at",
            "2026-05-21T15:30:20Z",
        ],
        capture_output=True,
        text=True,
        check=False,
        cwd=PACKAGE_ROOT,
        env=_pythonpath_env(),
    )

    assert result.returncode == 0, result.stderr
    assert _fetch_job_row(state_dir, "job-cli") == (
        "exited",
        7,
        "2026-05-21T15:30:20Z",
        "2026-05-21T15:30:20Z",
        None,
        None,
    )


def test_python_m_shellctl_runtime_runner_exit_reports_missing_job(
    tmp_path: Path,
) -> None:
    state_dir = tmp_path / "state"
    anyio.run(_initialize_database, state_dir)

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "shellctl_runtime.runner_exit",
            "--state-dir",
            str(state_dir),
            "--job-id",
            "missing-job",
            "--exit-code",
            "7",
            "--ended-at",
            "2026-05-21T15:30:20Z",
        ],
        capture_output=True,
        text=True,
        check=False,
        cwd=PACKAGE_ROOT,
        env=_pythonpath_env(),
    )

    assert result.returncode != 0
    assert "Unknown job id: missing-job" in result.stderr or "Unknown job id: missing-job" in result.stdout


def test_runtime_console_scripts_are_installed() -> None:
    entry_points = {
        entry_point.name: entry_point.value for entry_point in importlib.metadata.entry_points(group="console_scripts")
    }

    assert entry_points["shellctl-sanitize-pty"] == "shellctl_runtime.sanitize:main"
    assert entry_points["shellctl-runner-exit"] == "shellctl_runtime.runner_exit:main"
    assert shutil.which("shellctl-sanitize-pty") is not None
    assert shutil.which("shellctl-runner-exit") is not None


def test_runtime_modules_only_import_stdlib_or_runtime_helpers() -> None:
    forbidden_imports = {
        "anyio",
        "fastapi",
        "httpx",
        "pydantic",
        "pygments",
        "rich",
        "shellctl",
        "sqlalchemy",
        "sqlmodel",
        "typer",
        "uvicorn",
    }

    for filename in ("sanitize.py", "runner_exit.py"):
        tree = ast.parse((SRC_PATH / "shellctl_runtime" / filename).read_text("utf-8"))
        imports: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module is not None:
                imports.add(node.module)
        assert not any(
            imported == forbidden or imported.startswith(f"{forbidden}.")
            for imported in imports
            for forbidden in forbidden_imports
        ), (filename, sorted(imports))


def test_python_m_shellctl_runtime_sanitize_module_stays_lightweight() -> None:
    stats = _measure_module_help("shellctl_runtime.sanitize")

    assert stats["code"] == 0
    assert stats["elapsed"] < 0.35
    assert stats["deny"] == []


def test_python_m_shellctl_runtime_runner_exit_module_stays_lightweight() -> None:
    stats = _measure_module_help("shellctl_runtime.runner_exit")

    assert stats["code"] == 0
    assert stats["elapsed"] < 0.35
    assert stats["deny"] == []


def test_python_m_shellctl_runtime_sanitize_sanitizes_output(tmp_path: Path) -> None:
    ready_file = tmp_path / "ready"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "shellctl_runtime.sanitize",
            "--ready-file",
            str(ready_file),
        ],
        input=b"before\rafter\n",
        capture_output=True,
        check=False,
        cwd=PACKAGE_ROOT,
        env=_pythonpath_env(),
    )

    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")
    assert ready_file.exists()
    assert result.stdout.decode("utf-8") == "after\n"
