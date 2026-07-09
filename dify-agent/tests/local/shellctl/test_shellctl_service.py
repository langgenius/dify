from __future__ import annotations

import importlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path

import anyio
import httpx2 as httpx
import pytest
from typer.testing import CliRunner

import shellctl.server.service as server_service_module
from shellctl.server import (
    JobRow,
    ShellctlConfig,
    ShellctlServerError,
    ShellctlService,
    cli,
    create_app,
)
from shellctl.server.artifacts import (
    JOB_ENV_FILENAME,
    PIPE_DRAINED_FILENAME,
    PIPE_ERROR_LOG_FILENAME,
    PIPE_FAILED_FILENAME,
    RUNNER_ENDED_AT_FILENAME,
    RUNNER_EXIT_CODE_FILENAME,
    job_env_path,
    pipe_error_log_path,
)
from shellctl.server.tmux import TmuxController
from shellctl.shared import (
    DEFAULT_AUTH_TOKEN_ENV,
    InputJobRequest,
    JobStatusName,
    JobStatusView,
    RunJobRequest,
    TerminalSize,
    TerminateJobRequest,
    WaitJobRequest,
    job_pane_target,
    job_session_name,
)

server_serve_module = importlib.import_module("shellctl.server.serve")


class FakeTmuxController:
    def __init__(self) -> None:
        self.sessions: set[str] = set()
        self.pipe_active: dict[str, bool | None] = {}
        self.cleaned: list[str] = []
        self.touch_ready_on_enable = True
        self.pipe_active_on_enable: bool | None = True
        self.pipe_error_log_text: str | None = None
        self.on_send_interrupt: Callable[[str], Awaitable[None]] | None = None
        self.on_send_input: Callable[[str, str], Awaitable[None]] | None = None

    async def start_server(self) -> None:
        return None

    async def list_sessions(self) -> set[str]:
        return set(self.sessions)

    async def session_exists(self, session_name: str) -> bool:
        return session_name in self.sessions

    async def is_output_pipe_active(self, *, job_id: str) -> bool | None:
        return self.pipe_active.get(job_id)

    async def create_job_session(self, *, job_id: str, job_dir: Path, cwd: Path, terminal: TerminalSize) -> None:
        del job_dir, cwd, terminal
        self.sessions.add(job_session_name(job_id))
        self.pipe_active[job_id] = False

    async def enable_output_pipe(self, *, job_id: str, job_dir: Path, ready_file: Path) -> None:
        self.pipe_active[job_id] = self.pipe_active_on_enable
        if self.pipe_error_log_text is not None:
            pipe_error_log_path(job_dir).write_text(
                self.pipe_error_log_text,
                encoding="utf-8",
            )
        if self.touch_ready_on_enable:
            ready_file.touch()

    async def send_input(self, *, job_id: str, text: str) -> None:
        if self.on_send_input is not None:
            await self.on_send_input(job_id, text)

    async def send_interrupt(self, *, job_id: str) -> None:
        if self.on_send_interrupt is not None:
            await self.on_send_interrupt(job_id)

    async def cleanup_session(self, *, job_id: str) -> None:
        self.cleaned.append(job_id)
        self.sessions.discard(job_session_name(job_id))
        self.pipe_active.pop(job_id, None)


async def _create_service(
    tmp_path: Path, *, auth_token: str | None = None
) -> tuple[ShellctlService, FakeTmuxController]:
    fake_tmux = FakeTmuxController()
    service = ShellctlService(
        ShellctlConfig(
            auth_token=auth_token,
            state_dir=tmp_path / "state",
            runtime_dir=tmp_path / "run",
        ),
        tmux=fake_tmux,
    )
    await service.initialize_database()
    service._ensure_dir(service.config.jobs_dir)
    return service, fake_tmux


async def _create_real_service(
    tmp_path: Path,
    *,
    runner_exit_command: tuple[str, ...] | None = None,
    sanitize_pty_command: tuple[str, ...] | None = None,
) -> ShellctlService:
    defaults = ShellctlConfig(
        state_dir=tmp_path / "default-state",
        runtime_dir=tmp_path / "default-run",
    )
    config = ShellctlConfig(
        state_dir=tmp_path / "state",
        runtime_dir=tmp_path / "run",
        runner_exit_command=runner_exit_command or defaults.runner_exit_command,
        sanitize_pty_command=sanitize_pty_command or defaults.sanitize_pty_command,
    )
    service = ShellctlService(config)
    await service.initialize()
    return service


def _write_delayed_sanitize_wrapper(
    tmp_path: Path,
    *,
    delay_seconds: float,
    sanitize_exit_code: int | None = None,
) -> tuple[str, ...]:
    wrapper_path = tmp_path / "delayed-sanitize-wrapper.py"
    wrapper_path.write_text(
        "\n".join(
            [
                "from __future__ import annotations",
                "",
                "import subprocess",
                "import sys",
                "import time",
                "from pathlib import Path",
                "",
                (f"REAL = [{sys.executable!r}, '-m', 'shellctl_runtime.sanitize']"),
                "args = sys.argv[1:]",
                "if '--ready-file' in args:",
                "    ready_file = Path(args[args.index('--ready-file') + 1])",
                "    ready_file.touch()",
                f"    time.sleep({delay_seconds!r})",
                (f"    raise SystemExit({sanitize_exit_code!r})" if sanitize_exit_code is not None else ""),
                "raise SystemExit(subprocess.run(REAL + args, check=False).returncode)",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return (sys.executable, str(wrapper_path))


def _capture_serve_config(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[dict[str, object], CliRunner]:
    captured: dict[str, object] = {}

    def fake_create_app(config: ShellctlConfig) -> object:
        captured["config"] = config
        return object()

    def fake_run(app: object, *, host: str, port: int, log_level: str) -> None:
        captured["app"] = app
        captured["host"] = host
        captured["port"] = port
        captured["log_level"] = log_level

    monkeypatch.setattr(server_serve_module, "_create_app", fake_create_app)
    monkeypatch.setattr(server_serve_module, "_uvicorn_run", fake_run)
    return captured, CliRunner()


async def _seed_job(
    service: ShellctlService,
    *,
    job_id: str,
    status: JobStatusName,
    exit_code: int | None = None,
    ended_at: str | None = None,
    created_at: str = "2026-05-21T15:30:12Z",
    started_at: str | None = "2026-05-21T15:30:13Z",
) -> JobRow:
    job_dir = service.config.jobs_dir / job_id
    job_dir.mkdir(mode=0o700)
    (job_dir / "script").write_text("printf ready\n", encoding="utf-8")
    (job_dir / "output.log").write_text("hello\n", encoding="utf-8")
    row = JobRow(
        job_id=job_id,
        script_path=f"jobs/{job_id}/script",
        output_path=f"jobs/{job_id}/output.log",
        cwd="/tmp",
        terminal_cols=120,
        terminal_rows=80,
        status=status.value,
        session_name=job_session_name(job_id),
        pane_target=job_pane_target(job_id),
        exit_code=exit_code,
        reason=None,
        message=None,
        created_at=created_at,
        started_at=started_at,
        ended_at=ended_at,
        updated_at=created_at,
    )
    inserted = await service._insert_job_row(row)
    assert inserted is True
    return row


class RecordingService(ShellctlService):
    def __init__(self, config: ShellctlConfig, *, tmux: FakeTmuxController) -> None:
        super().__init__(config, tmux=tmux)
        self.deleted_rows: list[str] = []

    async def _delete_job_row(self, job_id: str) -> None:
        self.deleted_rows.append(job_id)
        await super()._delete_job_row(job_id)


class StartupObservationService(RecordingService):
    def __init__(self, config: ShellctlConfig, *, tmux: FakeTmuxController) -> None:
        super().__init__(config, tmux=tmux)
        self.observed_startup_statuses: list[JobStatusName] = []

    async def _insert_job_row(self, row: JobRow) -> bool:
        inserted = await super()._insert_job_row(row)
        if inserted:
            startup_view = await self.get_job_status(row.job_id)
            self.observed_startup_statuses.append(startup_view.status)
        return inserted


class ConcurrentDeleteRaceService(RecordingService):
    def __init__(self, config: ShellctlConfig, *, tmux: FakeTmuxController) -> None:
        super().__init__(config, tmux=tmux)
        self.disappear_on_status: set[str] = set()
        self.disappear_on_delete: set[str] = set()

    async def get_job_status(self, job_id: str):  # type: ignore[override]
        if job_id in self.disappear_on_status:
            self.disappear_on_status.remove(job_id)
            await super()._delete_job_row(job_id)
        return await super().get_job_status(job_id)

    async def _delete_job_row(self, job_id: str) -> None:
        if job_id in self.disappear_on_delete:
            self.disappear_on_delete.remove(job_id)
            raise ShellctlServerError(404, "job_not_found", f"Unknown job id: {job_id}")
        await super()._delete_job_row(job_id)


class InsertConflictService(RecordingService):
    def __init__(self, config: ShellctlConfig, *, tmux: FakeTmuxController) -> None:
        super().__init__(config, tmux=tmux)
        self.failed_insert_job_ids: list[str] = []

    async def _insert_job_row(self, row: JobRow) -> bool:
        if not self.failed_insert_job_ids:
            self.failed_insert_job_ids.append(row.job_id)
            return False
        return await super()._insert_job_row(row)


@pytest.mark.anyio
async def test_sqlite_persistence_survives_service_restart(tmp_path: Path) -> None:
    service, _fake_tmux = await _create_service(tmp_path)
    await _seed_job(
        service,
        job_id="05211530-k7p",
        status=JobStatusName.EXITED,
        exit_code=0,
        ended_at="2026-05-21T15:30:20Z",
    )
    await service.shutdown()

    restarted, _fake_tmux = await _create_service(tmp_path)
    row = await restarted._get_job_row("05211530-k7p")

    assert row.status == JobStatusName.EXITED.value
    assert row.exit_code == 0
    assert restarted.config.db_path.exists()
    await restarted.shutdown()


@pytest.mark.anyio
async def test_run_job_does_not_materialize_fresh_row_to_lost_during_startup_window(
    tmp_path: Path,
) -> None:
    fake_tmux = FakeTmuxController()
    service = StartupObservationService(
        ShellctlConfig(state_dir=tmp_path / "state", runtime_dir=tmp_path / "run"),
        tmux=fake_tmux,
    )
    await service.initialize_database()
    service._ensure_dir(service.config.jobs_dir)
    fake_tmux.touch_ready_on_enable = False
    service.config = ShellctlConfig(
        state_dir=service.config.state_dir,
        runtime_dir=service.config.runtime_dir,
        poll_interval_seconds=0.001,
        pipe_ready_timeout_seconds=0.01,
    )

    await service.run_job(
        RunJobRequest(
            script="printf ready\n",
            cwd=str(tmp_path),
            terminal=TerminalSize(),
            timeout=0.01,
            output_limit=8192,
            idle_flush_seconds=0.01,
        )
    )

    assert len(service.observed_startup_statuses) == 1
    assert service.observed_startup_statuses[0] in {
        JobStatusName.CREATED,
        JobStatusName.STARTING,
        JobStatusName.RUNNING,
    }
    await service.shutdown()


@pytest.mark.anyio
async def test_run_job_happy_path_persists_running_row_and_artifacts(
    tmp_path: Path,
) -> None:
    fake_tmux = FakeTmuxController()
    service = RecordingService(
        ShellctlConfig(state_dir=tmp_path / "state", runtime_dir=tmp_path / "run"),
        tmux=fake_tmux,
    )
    await service.initialize_database()
    service._ensure_dir(service.config.jobs_dir)

    result = await service.run_job(
        RunJobRequest(
            script="printf ready\n",
            cwd=str(tmp_path),
            env={"HELLO": "world", "UNICODE": "盐粒"},
            terminal=TerminalSize(cols=100, rows=40),
            timeout=0.01,
            output_limit=8192,
            idle_flush_seconds=0.01,
        )
    )

    row = await service._get_job_row(result.job_id)
    job_dir = service.config.jobs_dir / result.job_id

    assert result.status is JobStatusName.RUNNING
    assert result.done is False
    assert result.output == ""
    assert result.offset == 0
    assert row.status == JobStatusName.RUNNING.value
    assert row.cwd == str(tmp_path.resolve())
    assert row.script_path == f"jobs/{result.job_id}/script"
    assert row.output_path == f"jobs/{result.job_id}/output.log"
    assert row.started_at is not None
    assert (job_dir / "script").exists()
    assert json.loads(job_env_path(job_dir).read_text(encoding="utf-8")) == {
        "HELLO": "world",
        "UNICODE": "盐粒",
    }
    assert (job_dir / "output.log").exists()
    assert (job_dir / "start-gate").exists()
    assert job_session_name(result.job_id) in fake_tmux.sessions
    assert fake_tmux.pipe_active[result.job_id] is True
    assert await service.get_job_status(result.job_id) == JobStatusView(
        job_id=result.job_id,
        status=JobStatusName.RUNNING,
        done=False,
        exit_code=None,
        created_at=row.created_at,
        started_at=row.started_at,
        ended_at=None,
        offset=0,
    )
    await service.shutdown()


@pytest.mark.anyio
@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux is required")
async def test_run_job_env_overlay_is_visible_without_replacing_inherited_env(
    tmp_path: Path,
) -> None:
    service = await _create_real_service(tmp_path)

    try:
        result = await service.run_job(
            RunJobRequest(
                script=(
                    "python3 - <<'PY'\n"
                    "import os\n"
                    "print(os.environ['SHELLCTL_PRESET'])\n"
                    "print('PATH' in os.environ)\n"
                    "PY\n"
                ),
                cwd=str(tmp_path),
                env={"SHELLCTL_PRESET": "from-client"},
                terminal=TerminalSize(),
                timeout=5,
                output_limit=8192,
                idle_flush_seconds=1,
            )
        )

        assert result.done is True
        assert result.status is JobStatusName.EXITED
        assert result.exit_code == 0
        assert result.output == "from-client\nTrue\n"
    finally:
        await service.shutdown()


@pytest.mark.anyio
@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux is required")
async def test_run_job_env_overlay_overrides_inherited_value(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SHELLCTL_PRESET", "parent")
    service = await _create_real_service(tmp_path)

    try:
        result = await service.run_job(
            RunJobRequest(
                script=("python3 - <<'PY'\nimport os\nprint(os.environ['SHELLCTL_PRESET'])\nPY\n"),
                cwd=str(tmp_path),
                env={"SHELLCTL_PRESET": "from-client"},
                terminal=TerminalSize(),
                timeout=5,
                output_limit=8192,
                idle_flush_seconds=1,
            )
        )

        assert result.done is True
        assert result.status is JobStatusName.EXITED
        assert result.exit_code == 0
        assert result.output == "from-client\n"
    finally:
        await service.shutdown()


@pytest.mark.anyio
@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux is required")
async def test_send_input_reaches_real_job_stdin_after_env_bootstrap(
    tmp_path: Path,
) -> None:
    service = await _create_real_service(tmp_path)

    try:
        initial = await service.run_job(
            RunJobRequest(
                script=("printf 'ready\\n'\nIFS= read -r line\nprintf 'got:%s\\n' \"$line\"\n"),
                cwd=str(tmp_path),
                terminal=TerminalSize(),
                timeout=5,
                output_limit=8192,
                idle_flush_seconds=0.01,
            )
        )

        ready_window = initial
        if ready_window.output == "":
            ready_window = await service.wait_job(
                initial.job_id,
                WaitJobRequest(
                    offset=initial.offset,
                    timeout=1,
                    output_limit=8192,
                    idle_flush_seconds=0.01,
                ),
            )

        result = await service.send_input(
            initial.job_id,
            InputJobRequest(
                text="hello from stdin\n",
                offset=ready_window.offset,
                timeout=1,
                output_limit=8192,
                idle_flush_seconds=0.01,
            ),
        )

        output_after_input = result.output
        final = result
        if not final.done:
            # `send_input()` shares wait semantics with `wait_job()`: it may
            # return after the post-input output flushes but before tmux exit
            # artifacts have materialized into a terminal DB status on slower CI.
            final = await service.wait_job(
                initial.job_id,
                WaitJobRequest(
                    offset=result.offset,
                    timeout=5,
                    output_limit=8192,
                    idle_flush_seconds=0.01,
                ),
            )
            output_after_input += final.output

        assert ready_window.done is False
        assert final.done is True
        assert final.status is JobStatusName.EXITED
        assert final.exit_code == 0
        assert output_after_input.endswith("got:hello from stdin\n")
    finally:
        await service.shutdown()


@pytest.mark.anyio
@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux is required")
async def test_terminated_job_does_not_emit_python_wrapper_traceback(
    tmp_path: Path,
) -> None:
    service = await _create_real_service(tmp_path)

    try:
        initial = await service.run_job(
            RunJobRequest(
                script=("trap 'exit 130' INT\nprintf 'ready\\n'\nwhile :; do sleep 1; done\n"),
                cwd=str(tmp_path),
                terminal=TerminalSize(),
                timeout=5,
                output_limit=8192,
                idle_flush_seconds=0.01,
            )
        )

        ready_window = initial
        if ready_window.output == "":
            ready_window = await service.wait_job(
                initial.job_id,
                WaitJobRequest(
                    offset=initial.offset,
                    timeout=1,
                    output_limit=8192,
                    idle_flush_seconds=0.01,
                ),
            )
        assert ready_window.done is False

        terminated = await service.terminate_job(
            initial.job_id,
            TerminateJobRequest(grace_seconds=0.2),
        )
        final = await service.wait_job(
            initial.job_id,
            WaitJobRequest(
                offset=ready_window.offset,
                timeout=1,
                output_limit=8192,
                idle_flush_seconds=0.01,
            ),
        )

        assert terminated.status is JobStatusName.TERMINATED
        assert final.done is True
        assert "KeyboardInterrupt" not in final.output
        assert "Traceback (most recent call last)" not in final.output
    finally:
        await service.shutdown()


@pytest.mark.anyio
@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux is required")
async def test_run_job_returns_flushed_output_on_first_terminal_result(
    tmp_path: Path,
) -> None:
    sanitize_pty_command = _write_delayed_sanitize_wrapper(tmp_path, delay_seconds=0.2)
    service = await _create_real_service(
        tmp_path,
        sanitize_pty_command=sanitize_pty_command,
    )

    try:
        result = await service.run_job(
            RunJobRequest(
                script="printf 'delayed-flush\\n'\n",
                cwd=str(tmp_path),
                terminal=TerminalSize(),
                timeout=3,
                output_limit=8192,
                idle_flush_seconds=1,
            )
        )

        reread = await service.wait_job(
            result.job_id,
            WaitJobRequest(
                offset=0,
                timeout=0.001,
                output_limit=8192,
                idle_flush_seconds=0.01,
            ),
        )

        assert result.done is True
        assert result.status is JobStatusName.EXITED
        assert result.exit_code == 0
        assert result.output == "delayed-flush\n"
        assert reread.output == "delayed-flush\n"
        assert reread.offset == result.offset
    finally:
        await service.shutdown()


@pytest.mark.anyio
@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux is required")
async def test_sanitize_failure_does_not_commit_normal_exit(
    tmp_path: Path,
) -> None:
    sanitize_pty_command = _write_delayed_sanitize_wrapper(
        tmp_path,
        delay_seconds=0.2,
        sanitize_exit_code=7,
    )
    service = await _create_real_service(
        tmp_path,
        sanitize_pty_command=sanitize_pty_command,
    )

    try:
        result = await service.run_job(
            RunJobRequest(
                script="printf 'missing-output\\n'\n",
                cwd=str(tmp_path),
                terminal=TerminalSize(),
                timeout=3,
                output_limit=8192,
                idle_flush_seconds=1,
            )
        )

        reread = await service.wait_job(
            result.job_id,
            WaitJobRequest(
                offset=0,
                timeout=0.001,
                output_limit=8192,
                idle_flush_seconds=0.01,
            ),
        )
        job_dir = service.config.jobs_dir / result.job_id

        assert result.done is True
        assert result.status is not JobStatusName.EXITED
        assert result.exit_code is None
        assert result.output == ""
        assert reread.output == ""
        assert not (job_dir / PIPE_DRAINED_FILENAME).exists()
        assert (job_dir / PIPE_FAILED_FILENAME).exists()
    finally:
        await service.shutdown()


@pytest.mark.anyio
@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux is required")
@pytest.mark.skipif(shutil.which("uv") is None, reason="uv is required")
async def test_uv_quiet_shebang_returns_output_in_first_terminal_result(
    tmp_path: Path,
) -> None:
    service = await _create_real_service(tmp_path)

    try:
        result = await service.run_job(
            RunJobRequest(
                script=(
                    "#!/usr/bin/env -S uv run --script --quiet\n"
                    "# /// script\n"
                    '# requires-python = ">=3.12"\n'
                    "# dependencies = []\n"
                    "# ///\n"
                    'print("hello")\n'
                ),
                cwd=str(tmp_path),
                terminal=TerminalSize(),
                timeout=10,
                output_limit=8192,
                idle_flush_seconds=1,
            )
        )

        assert result.done is True
        assert result.status is JobStatusName.EXITED
        assert result.exit_code == 0
        assert result.output == "hello\n"
    finally:
        await service.shutdown()


@pytest.mark.anyio
@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux is required")
@pytest.mark.skipif(shutil.which("bash") is None, reason="bash is required")
@pytest.mark.parametrize(
    ("script", "expected_output"),
    [
        ("printf 'no-shebang\\n'\n", "no-shebang\n"),
        ("#!/bin/sh\nprintf 'sh-shebang\\n'\n", "sh-shebang\n"),
        (
            "#!/usr/bin/env bash\nprintf 'bash-shebang\\n'\n",
            "bash-shebang\n",
        ),
    ],
)
async def test_existing_script_modes_still_return_output(
    tmp_path: Path,
    script: str,
    expected_output: str,
) -> None:
    service = await _create_real_service(tmp_path)

    try:
        result = await service.run_job(
            RunJobRequest(
                script=script,
                cwd=str(tmp_path),
                terminal=TerminalSize(),
                timeout=5,
                output_limit=8192,
                idle_flush_seconds=1,
            )
        )

        assert result.done is True
        assert result.status is JobStatusName.EXITED
        assert result.exit_code == 0
        assert result.output == expected_output
    finally:
        await service.shutdown()


@pytest.mark.anyio
async def test_run_job_retries_after_sqlite_insert_conflict_and_cleans_artifacts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_tmux = FakeTmuxController()
    service = InsertConflictService(
        ShellctlConfig(state_dir=tmp_path / "state", runtime_dir=tmp_path / "run"),
        tmux=fake_tmux,
    )
    await service.initialize_database()
    service._ensure_dir(service.config.jobs_dir)
    generated_ids = iter(["05211530-k7p", "05211530-abc"])

    monkeypatch.setattr(server_service_module, "generate_job_id", lambda now=None: next(generated_ids))

    result = await service.run_job(
        RunJobRequest(
            script="printf ready\n",
            cwd=str(tmp_path),
            terminal=TerminalSize(),
            timeout=0.01,
            output_limit=8192,
            idle_flush_seconds=0.01,
        )
    )

    failed_job_id = service.failed_insert_job_ids[0]
    assert failed_job_id == "05211530-k7p"
    assert result.job_id == "05211530-abc"
    assert not (service.config.jobs_dir / failed_job_id).exists()
    assert (service.config.jobs_dir / result.job_id).exists()
    with pytest.raises(ShellctlServerError, match="Unknown job id"):
        await service._get_job_row(failed_job_id)
    await service.shutdown()


@pytest.mark.anyio
async def test_transition_status_does_not_overwrite_terminal_state(
    tmp_path: Path,
) -> None:
    service, _fake_tmux = await _create_service(tmp_path)
    await _seed_job(
        service,
        job_id="05211530-k7p",
        status=JobStatusName.TERMINATED,
        ended_at="2026-05-21T15:30:20Z",
    )

    row = await service._transition_status(
        "05211530-k7p",
        allowed_from={JobStatusName.RUNNING},
        target=JobStatusName.RUNNING,
    )

    assert row.status == JobStatusName.TERMINATED.value
    await service.shutdown()


@pytest.mark.anyio
async def test_wait_job_flushes_preexisting_unread_output_after_idle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service, fake_tmux = await _create_service(tmp_path)
    await _seed_job(service, job_id="05211530-k7p", status=JobStatusName.RUNNING)
    fake_tmux.sessions.add(job_session_name("05211530-k7p"))
    fake_tmux.pipe_active["05211530-k7p"] = True

    async def fail_sleep(_delay: float) -> None:
        raise AssertionError("wait_job should not sleep when idle_flush_seconds=0")

    monkeypatch.setattr(server_service_module.anyio, "sleep", fail_sleep)

    result = await service.wait_job(
        "05211530-k7p",
        WaitJobRequest(offset=0, timeout=0.2, output_limit=8192, idle_flush_seconds=0),
    )

    assert result.output == "hello\n"
    assert result.done is False
    await service.shutdown()


@pytest.mark.anyio
async def test_wait_job_returns_immediately_for_terminal_row_and_reads_remaining_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service, _fake_tmux = await _create_service(tmp_path)
    job_id = "05211530-k7p"
    await _seed_job(
        service,
        job_id=job_id,
        status=JobStatusName.EXITED,
        exit_code=0,
        ended_at="2026-05-21T15:30:20Z",
    )
    output_path = service.config.jobs_dir / job_id / "output.log"
    output_path.write_text("hello\nworld\n", encoding="utf-8")

    async def fail_sleep(_delay: float) -> None:
        raise AssertionError("terminal wait should not sleep")

    monkeypatch.setattr(server_service_module.anyio, "sleep", fail_sleep)

    result = await service.wait_job(
        job_id,
        WaitJobRequest(
            offset=len(b"hello\n"),
            timeout=0.5,
            output_limit=8192,
            idle_flush_seconds=0.01,
        ),
    )

    assert result.done is True
    assert result.status is JobStatusName.EXITED
    assert result.exit_code == 0
    assert result.output == "world\n"
    assert result.offset == len(b"hello\nworld\n")
    await service.shutdown()


@pytest.mark.anyio
async def test_starting_job_is_not_marked_lost_during_local_startup_window(
    tmp_path: Path,
) -> None:
    service, _fake_tmux = await _create_service(tmp_path)
    await _seed_job(service, job_id="05211530-k7p", status=JobStatusName.STARTING)
    service._starting_jobs.add("05211530-k7p")

    view = await service.get_job_status("05211530-k7p")

    assert view.status is JobStatusName.STARTING
    assert view.done is False
    await service.shutdown()


@pytest.mark.anyio
async def test_stale_starting_job_with_dead_pipe_materializes_failed(
    tmp_path: Path,
) -> None:
    service, fake_tmux = await _create_service(tmp_path)
    await _seed_job(service, job_id="05211530-k7p", status=JobStatusName.STARTING)
    fake_tmux.sessions.add(job_session_name("05211530-k7p"))
    fake_tmux.pipe_active["05211530-k7p"] = False

    view = await service.get_job_status("05211530-k7p")
    row = await service._get_job_row("05211530-k7p")

    assert view.status is JobStatusName.FAILED
    assert row.reason == "pipe_failed"
    await service.shutdown()


@pytest.mark.anyio
async def test_terminate_beats_concurrent_runner_exit(tmp_path: Path) -> None:
    service, fake_tmux = await _create_service(tmp_path)
    await _seed_job(service, job_id="05211530-k7p", status=JobStatusName.RUNNING)
    fake_tmux.sessions.add(job_session_name("05211530-k7p"))
    fake_tmux.pipe_active["05211530-k7p"] = True

    async def record_exit(job_id: str) -> None:
        await service.record_runner_exit(job_id, 130, "2026-05-21T15:30:20Z")

    fake_tmux.on_send_interrupt = record_exit
    view = await service.terminate_job("05211530-k7p", TerminateJobRequest(grace_seconds=0))

    assert view.status is JobStatusName.TERMINATED
    assert view.exit_code == 130
    await service.shutdown()


@pytest.mark.anyio
async def test_record_runner_exit_materializes_nonterminal_row_to_exited(
    tmp_path: Path,
) -> None:
    service, _fake_tmux = await _create_service(tmp_path)
    await _seed_job(service, job_id="05211530-k7p", status=JobStatusName.RUNNING)

    await service.record_runner_exit("05211530-k7p", 7, "2026-05-21T15:30:20Z")

    row = await service._get_job_row("05211530-k7p")
    view = await service.get_job_status("05211530-k7p")

    assert row.status == JobStatusName.EXITED.value
    assert row.exit_code == 7
    assert row.ended_at == "2026-05-21T15:30:20Z"
    assert view.status is JobStatusName.EXITED
    assert view.done is True
    assert view.exit_code == 7
    assert view.ended_at == "2026-05-21T15:30:20Z"
    await service.shutdown()


@pytest.mark.anyio
async def test_pipe_monitor_marks_running_job_failed_when_pipe_disappears(
    tmp_path: Path,
) -> None:
    service, fake_tmux = await _create_service(tmp_path)
    await _seed_job(service, job_id="05211530-k7p", status=JobStatusName.RUNNING)
    fake_tmux.sessions.add(job_session_name("05211530-k7p"))
    fake_tmux.pipe_active["05211530-k7p"] = False

    await service.check_running_jobs_pipe_health()
    row = await service._get_job_row("05211530-k7p")

    assert row.status == JobStatusName.FAILED.value
    assert row.reason == "pipe_failed"
    await service.shutdown()


@pytest.mark.anyio
async def test_session_disappearing_between_probes_materializes_lost_not_pipe_failed(
    tmp_path: Path,
) -> None:
    service, fake_tmux = await _create_service(tmp_path)
    await _seed_job(service, job_id="05211530-k7p", status=JobStatusName.RUNNING)
    fake_tmux.sessions.add(job_session_name("05211530-k7p"))
    fake_tmux.pipe_active["05211530-k7p"] = None

    view = await service.get_job_status("05211530-k7p")
    row = await service._get_job_row("05211530-k7p")

    assert view.status is JobStatusName.LOST
    assert row.reason == "tmux_session_missing"
    await service.shutdown()


@pytest.mark.anyio
async def test_drained_uncommitted_normal_exit_self_commits_to_exited(
    tmp_path: Path,
) -> None:
    service, _fake_tmux = await _create_service(tmp_path)
    job_id = "05211530-k7p"
    await _seed_job(service, job_id=job_id, status=JobStatusName.RUNNING)
    job_dir = service.config.jobs_dir / job_id
    (job_dir / RUNNER_EXIT_CODE_FILENAME).write_text("0\n", encoding="utf-8")
    (job_dir / RUNNER_ENDED_AT_FILENAME).write_text("2026-05-21T15:30:20Z\n", encoding="utf-8")
    (job_dir / PIPE_DRAINED_FILENAME).touch()

    view = await service.get_job_status(job_id)
    row = await service._get_job_row(job_id)

    assert view.status is JobStatusName.EXITED
    assert view.done is True
    assert view.exit_code == 0
    assert row.status == JobStatusName.EXITED.value
    assert row.exit_code == 0
    assert row.ended_at == "2026-05-21T15:30:20Z"
    await service.shutdown()


@pytest.mark.anyio
async def test_list_jobs_ignores_half_created_directory_and_uses_db_rows(
    tmp_path: Path,
) -> None:
    service, fake_tmux = await _create_service(tmp_path)
    (service.config.jobs_dir / "half-created").mkdir(mode=0o700)
    await _seed_job(service, job_id="05211530-k7p", status=JobStatusName.RUNNING)
    fake_tmux.sessions.add(job_session_name("05211530-k7p"))
    fake_tmux.pipe_active["05211530-k7p"] = True

    jobs = await service.list_jobs(limit=10)

    assert [job.job_id for job in jobs.jobs] == ["05211530-k7p"]
    assert fake_tmux.cleaned == []
    await service.shutdown()


@pytest.mark.anyio
async def test_reconcile_and_gc_query_sqlite_rows(tmp_path: Path) -> None:
    service, fake_tmux = await _create_service(tmp_path)
    await _seed_job(
        service,
        job_id="05211530-old",
        status=JobStatusName.EXITED,
        exit_code=0,
        ended_at="2020-05-21T15:30:20Z",
        created_at="2020-05-21T15:30:12Z",
    )
    await _seed_job(service, job_id="05211530-run", status=JobStatusName.RUNNING)
    fake_tmux.sessions.add(job_session_name("05211530-run"))
    fake_tmux.pipe_active["05211530-run"] = True

    await service.reconcile()
    await service.gc_once()

    with pytest.raises(ShellctlServerError, match="Unknown job id"):
        await service._get_job_row("05211530-old")
    row = await service._get_job_row("05211530-run")
    assert row.status == JobStatusName.RUNNING.value
    assert not (service.config.jobs_dir / "05211530-old").exists()
    await service.shutdown()


@pytest.mark.anyio
async def test_delete_job_removes_db_row_before_artifact_cleanup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_tmux = FakeTmuxController()
    service = RecordingService(
        ShellctlConfig(state_dir=tmp_path / "state", runtime_dir=tmp_path / "run"),
        tmux=fake_tmux,
    )
    await service.initialize_database()
    service._ensure_dir(service.config.jobs_dir)
    await _seed_job(
        service,
        job_id="05211530-k7p",
        status=JobStatusName.EXITED,
        exit_code=0,
        ended_at="2026-05-21T15:30:20Z",
    )

    observed_db_missing_before_cleanup = False
    original_rmtree = server_service_module.shutil.rmtree

    def assert_db_deleted_then_remove(path: Path, *, ignore_errors: bool = False) -> None:
        nonlocal observed_db_missing_before_cleanup
        with sqlite3.connect(service.config.db_path) as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM jobs WHERE job_id = ?",
                ("05211530-k7p",),
            ).fetchone()[0]
        assert count == 0
        observed_db_missing_before_cleanup = True
        original_rmtree(path, ignore_errors=ignore_errors)

    monkeypatch.setattr(server_service_module.shutil, "rmtree", assert_db_deleted_then_remove)

    await service.delete_job("05211530-k7p", force=False, grace_seconds=0)

    assert service.deleted_rows == ["05211530-k7p"]
    assert observed_db_missing_before_cleanup is True
    with pytest.raises(ShellctlServerError, match="Unknown job id"):
        await service._get_job_row("05211530-k7p")
    await service.shutdown()


@pytest.mark.anyio
async def test_list_jobs_skips_row_deleted_mid_iteration(tmp_path: Path) -> None:
    fake_tmux = FakeTmuxController()
    service = ConcurrentDeleteRaceService(
        ShellctlConfig(state_dir=tmp_path / "state", runtime_dir=tmp_path / "run"),
        tmux=fake_tmux,
    )
    await service.initialize_database()
    service._ensure_dir(service.config.jobs_dir)
    await _seed_job(service, job_id="05211530-gone", status=JobStatusName.RUNNING)
    await _seed_job(service, job_id="05211530-keep", status=JobStatusName.RUNNING)
    fake_tmux.sessions.add(job_session_name("05211530-gone"))
    fake_tmux.sessions.add(job_session_name("05211530-keep"))
    fake_tmux.pipe_active["05211530-gone"] = True
    fake_tmux.pipe_active["05211530-keep"] = True
    service.disappear_on_status.add("05211530-gone")

    jobs = await service.list_jobs(limit=10)

    assert [job.job_id for job in jobs.jobs] == ["05211530-keep"]
    await service.shutdown()


@pytest.mark.anyio
async def test_reconcile_skips_row_deleted_mid_iteration(tmp_path: Path) -> None:
    fake_tmux = FakeTmuxController()
    service = ConcurrentDeleteRaceService(
        ShellctlConfig(state_dir=tmp_path / "state", runtime_dir=tmp_path / "run"),
        tmux=fake_tmux,
    )
    await service.initialize_database()
    service._ensure_dir(service.config.jobs_dir)
    await _seed_job(service, job_id="05211530-gone", status=JobStatusName.RUNNING)
    await _seed_job(service, job_id="05211530-keep", status=JobStatusName.RUNNING)
    fake_tmux.sessions.add(job_session_name("05211530-gone"))
    fake_tmux.sessions.add(job_session_name("05211530-keep"))
    fake_tmux.pipe_active["05211530-gone"] = True
    fake_tmux.pipe_active["05211530-keep"] = True
    service.disappear_on_status.add("05211530-gone")

    await service.reconcile()

    row = await service._get_job_row("05211530-keep")
    assert row.status == JobStatusName.RUNNING.value
    await service.shutdown()


@pytest.mark.anyio
async def test_gc_skips_row_deleted_mid_pass(tmp_path: Path) -> None:
    fake_tmux = FakeTmuxController()
    service = ConcurrentDeleteRaceService(
        ShellctlConfig(state_dir=tmp_path / "state", runtime_dir=tmp_path / "run"),
        tmux=fake_tmux,
    )
    await service.initialize_database()
    service._ensure_dir(service.config.jobs_dir)
    await _seed_job(
        service,
        job_id="05211530-gone",
        status=JobStatusName.EXITED,
        exit_code=0,
        ended_at="2020-05-21T15:30:20Z",
        created_at="2020-05-21T15:30:12Z",
    )
    await _seed_job(
        service,
        job_id="05211530-keep",
        status=JobStatusName.EXITED,
        exit_code=0,
        ended_at="2020-05-21T15:30:20Z",
        created_at="2020-05-21T15:30:13Z",
    )
    service.disappear_on_delete.add("05211530-gone")

    await service.gc_once()

    with pytest.raises(ShellctlServerError, match="Unknown job id"):
        await service._get_job_row("05211530-keep")
    await service.shutdown()


@pytest.mark.anyio
async def test_run_job_keeps_start_gate_closed_when_pipe_never_becomes_ready(
    tmp_path: Path,
) -> None:
    service, fake_tmux = await _create_service(tmp_path)
    fake_tmux.touch_ready_on_enable = False
    service.config = ShellctlConfig(
        state_dir=service.config.state_dir,
        runtime_dir=service.config.runtime_dir,
        poll_interval_seconds=0.001,
        pipe_monitor_interval_seconds=0.01,
        pipe_ready_timeout_seconds=0.01,
    )

    result = await service.run_job(
        RunJobRequest(
            script="printf ready\n",
            cwd=str(tmp_path),
            terminal=TerminalSize(),
            timeout=0.05,
            output_limit=8192,
            idle_flush_seconds=0.01,
        )
    )

    assert result.status is JobStatusName.FAILED
    assert result.done is True
    assert not (service.config.jobs_dir / result.job_id / "start-gate").exists()
    await service.shutdown()


@pytest.mark.anyio
async def test_run_job_pipe_ready_timeout_records_diagnostics(tmp_path: Path) -> None:
    service, fake_tmux = await _create_service(tmp_path)
    fake_tmux.touch_ready_on_enable = False
    fake_tmux.pipe_active_on_enable = False
    fake_tmux.pipe_error_log_text = "Traceback: sanitizer crashed\nsecond line\n"
    service.config = ShellctlConfig(
        state_dir=service.config.state_dir,
        runtime_dir=service.config.runtime_dir,
        poll_interval_seconds=0.001,
        pipe_ready_timeout_seconds=0.01,
    )

    result = await service.run_job(
        RunJobRequest(
            script="printf ready\n",
            cwd=str(tmp_path),
            terminal=TerminalSize(),
            timeout=0.05,
            output_limit=8192,
            idle_flush_seconds=0.01,
        )
    )

    row = await service._get_job_row(result.job_id)
    ready_file = service.config.jobs_dir / result.job_id / ".pipe-ready"

    assert result.status is JobStatusName.FAILED
    assert row.message is not None
    assert "waited " in row.message
    assert str(ready_file) in row.message
    assert "tmux #{pane_pipe}=0" in row.message
    assert PIPE_ERROR_LOG_FILENAME in row.message
    assert "Traceback: sanitizer crashed | second line" in row.message
    await service.shutdown()


@pytest.mark.anyio
async def test_send_input_terminal_race_returns_conflict_not_500(
    tmp_path: Path,
) -> None:
    service, fake_tmux = await _create_service(tmp_path)
    await _seed_job(service, job_id="05211530-k7p", status=JobStatusName.RUNNING)
    fake_tmux.sessions.add(job_session_name("05211530-k7p"))
    fake_tmux.pipe_active["05211530-k7p"] = True

    async def finish_before_send(job_id: str, _text: str) -> None:
        fake_tmux.sessions.clear()
        fake_tmux.pipe_active.pop(job_id, None)
        await service.record_runner_exit(job_id, 0, "2026-05-21T15:30:20Z")
        raise ShellctlServerError(
            409,
            "tmux_target_missing",
            "no server running on /tmp/tmux.sock",
        )

    fake_tmux.on_send_input = finish_before_send

    with pytest.raises(ShellctlServerError) as exc_info:
        await service.send_input(
            "05211530-k7p",
            InputJobRequest(
                text="pwd\n",
                offset=0,
                timeout=0.05,
                output_limit=8192,
                idle_flush_seconds=0.01,
            ),
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "job_not_running"
    await service.shutdown()


@pytest.mark.anyio
async def test_allocate_job_dir_retries_on_atomic_mkdir_collision(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service, _fake_tmux = await _create_service(tmp_path)
    (service.config.jobs_dir / "05211530-k7p").mkdir(mode=0o700)
    generated_ids = iter(["05211530-k7p", "05211530-abc"])

    monkeypatch.setattr(server_service_module, "generate_job_id", lambda now=None: next(generated_ids))

    job_id, job_dir = service._allocate_job_dir()

    assert job_id == "05211530-abc"
    assert job_dir.exists()
    await service.shutdown()


@pytest.mark.anyio
async def test_service_initialize_allows_missing_auth_token(tmp_path: Path) -> None:
    service = ShellctlService(
        ShellctlConfig(state_dir=tmp_path / "state", runtime_dir=tmp_path / "run"),
        tmux=FakeTmuxController(),
    )

    await service.initialize()

    assert service.config.runner_path.exists()
    await service.shutdown()


@pytest.mark.anyio
async def test_http_routes_inject_shellctl_service_dependency(
    tmp_path: Path,
) -> None:
    service, _fake_tmux = await _create_service(tmp_path, auth_token="route-token")
    app = create_app(service.config, service=service)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://shellctl.test") as client:
        health = await client.get("/healthz")
        assert health.status_code == 200

        unauthenticated = await client.get("/v1/jobs")
        assert unauthenticated.status_code == 401

        authenticated = await client.get("/v1/jobs", headers={"Authorization": "Bearer route-token"})

    assert authenticated.status_code == 200
    assert authenticated.json() == {"jobs": []}
    await service.shutdown()


@pytest.mark.anyio
async def test_http_routes_enforce_auth_from_environment_fallback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(DEFAULT_AUTH_TOKEN_ENV, "route-token")
    service, _fake_tmux = await _create_service(tmp_path)
    app = create_app(service.config, service=service)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://shellctl.test") as client:
        unauthenticated = await client.get("/v1/jobs")
        authenticated = await client.get("/v1/jobs", headers={"Authorization": "Bearer route-token"})

    assert unauthenticated.status_code == 401
    assert authenticated.status_code == 200
    await service.shutdown()


@pytest.mark.anyio
async def test_create_app_without_explicit_config_reads_auth_token_from_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def noop_initialize(self: ShellctlService) -> None:
        return None

    monkeypatch.setenv(DEFAULT_AUTH_TOKEN_ENV, "route-token")
    monkeypatch.setattr(ShellctlService, "initialize", noop_initialize)
    monkeypatch.setattr(ShellctlService, "start_background_gc", lambda self: None)
    monkeypatch.setattr(ShellctlService, "start_background_pipe_monitor", lambda self: None)

    app = create_app()
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://shellctl.test") as client:
        response = await client.get("/v1/jobs")

    assert app.state.shellctl_service.config.auth_token == "route-token"
    assert response.status_code == 401
    await app.state.shellctl_service.shutdown()


@pytest.mark.anyio
async def test_http_routes_skip_auth_when_token_missing(tmp_path: Path) -> None:
    service, _fake_tmux = await _create_service(tmp_path)
    app = create_app(service.config, service=service)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://shellctl.test") as client:
        response = await client.get("/v1/jobs")

    assert response.status_code == 200
    assert response.json() == {"jobs": []}
    await service.shutdown()


@pytest.mark.anyio
async def test_http_routes_skip_auth_when_token_is_empty(tmp_path: Path) -> None:
    service, _fake_tmux = await _create_service(tmp_path, auth_token="")
    app = create_app(service.config, service=service)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://shellctl.test") as client:
        response = await client.get("/v1/jobs")

    assert response.status_code == 200
    assert response.json() == {"jobs": []}
    await service.shutdown()


def test_shellctl_config_reads_auth_token_from_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DEFAULT_AUTH_TOKEN_ENV, "env-token")

    config = ShellctlConfig(state_dir=tmp_path / "state", runtime_dir=tmp_path / "run")

    assert config.auth_token == "env-token"


def test_shellctl_config_treats_empty_environment_auth_token_as_disabled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(DEFAULT_AUTH_TOKEN_ENV, "")

    config = ShellctlConfig(state_dir=tmp_path / "state", runtime_dir=tmp_path / "run")

    assert config.auth_token is None


def test_serve_cli_passes_direct_auth_token_to_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    captured, runner = _capture_serve_config(monkeypatch)

    result = runner.invoke(
        cli,
        [
            "serve",
            "--listen",
            "0.0.0.0:9999",
            "--auth-token",
            "direct-token",
            "--state-dir",
            str(tmp_path / "state"),
        ],
    )

    assert result.exit_code == 0, result.output
    assert captured["host"] == "0.0.0.0"
    assert captured["port"] == 9999
    assert captured["log_level"] == "info"
    config = captured["config"]
    assert isinstance(config, ShellctlConfig)
    assert config.auth_token == "direct-token"


def test_serve_cli_prefers_explicit_auth_token_over_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(DEFAULT_AUTH_TOKEN_ENV, "env-token")
    captured, runner = _capture_serve_config(monkeypatch)

    result = runner.invoke(
        cli,
        [
            "serve",
            "--auth-token",
            "direct-token",
            "--state-dir",
            str(tmp_path / "state"),
        ],
    )

    assert result.exit_code == 0, result.output
    config = captured["config"]
    assert isinstance(config, ShellctlConfig)
    assert config.auth_token == "direct-token"


def test_serve_cli_treats_empty_auth_token_as_disabled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    captured, runner = _capture_serve_config(monkeypatch)

    result = runner.invoke(
        cli,
        [
            "serve",
            "--auth-token",
            "",
            "--state-dir",
            str(tmp_path / "state"),
        ],
    )

    assert result.exit_code == 0, result.output
    config = captured["config"]
    assert isinstance(config, ShellctlConfig)
    assert config.auth_token is None


def test_serve_cli_explicit_empty_auth_token_beats_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DEFAULT_AUTH_TOKEN_ENV, "env-token")
    captured, runner = _capture_serve_config(monkeypatch)

    result = runner.invoke(
        cli,
        [
            "serve",
            "--auth-token",
            "",
            "--state-dir",
            str(tmp_path / "state"),
        ],
    )

    assert result.exit_code == 0, result.output
    config = captured["config"]
    assert isinstance(config, ShellctlConfig)
    assert config.auth_token is None


def test_serve_cli_reads_auth_token_from_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DEFAULT_AUTH_TOKEN_ENV, "env-token")
    captured, runner = _capture_serve_config(monkeypatch)

    result = runner.invoke(
        cli,
        [
            "serve",
            "--state-dir",
            str(tmp_path / "state"),
        ],
    )

    assert result.exit_code == 0, result.output
    config = captured["config"]
    assert isinstance(config, ShellctlConfig)
    assert config.auth_token == "env-token"


def test_serve_cli_forwards_state_runtime_and_gc_flags(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    captured, runner = _capture_serve_config(monkeypatch)
    state_dir = tmp_path / "state"
    runtime_dir = tmp_path / "runtime"

    result = runner.invoke(
        cli,
        [
            "serve",
            "--state-dir",
            str(state_dir),
            "--runtime-dir",
            str(runtime_dir),
            "--gc-interval-seconds",
            "12.5",
            "--gc-finished-job-retention-seconds",
            "345.0",
        ],
    )

    assert result.exit_code == 0, result.output
    config = captured["config"]
    assert isinstance(config, ShellctlConfig)
    assert config.state_dir == state_dir
    assert config.runtime_dir == runtime_dir
    assert config.gc_interval_seconds == 12.5
    assert config.gc_finished_job_retention_seconds == 345.0


def test_runner_script_records_completion_metadata_without_direct_runner_exit(
    tmp_path: Path,
) -> None:
    service = ShellctlService(
        ShellctlConfig(state_dir=tmp_path / "state", runtime_dir=tmp_path / "run"),
        tmux=FakeTmuxController(),
    )
    source = service._runner_script_source()

    assert JOB_ENV_FILENAME in source
    assert RUNNER_EXIT_CODE_FILENAME in source
    assert RUNNER_ENDED_AT_FILENAME in source
    assert "write_atomic" in source
    assert 'mv "$tmp" "$dest"' in source
    assert re.search(r"\brunner-exit\s+--state-dir\b", source) is None
    anyio.run(service.shutdown)


def test_shellctl_config_defaults_to_lightweight_sanitize_entrypoint(
    tmp_path: Path,
) -> None:
    config = ShellctlConfig(state_dir=tmp_path / "state", runtime_dir=tmp_path / "run")

    assert config.pipe_ready_timeout_seconds == 10.0
    assert config.tmux_command_timeout_seconds == 15.0
    assert config.tmux_session_start_timeout_seconds == 90.0
    assert config.sanitize_pty_command == ("shellctl-sanitize-pty",)
    assert config.runner_exit_command == ("shellctl-runner-exit",)


@pytest.mark.anyio
async def test_tmux_command_timeout_returns_structured_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def slow_run_process(*args: object, **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        del args, kwargs
        await anyio.sleep(1)
        return subprocess.CompletedProcess(["tmux"], 0, stdout=b"", stderr=b"")

    monkeypatch.setattr(anyio, "run_process", slow_run_process)
    controller = TmuxController(
        ShellctlConfig(
            state_dir=tmp_path / "state",
            runtime_dir=tmp_path / "run",
            tmux_command_timeout_seconds=0.01,
        )
    )

    with pytest.raises(ShellctlServerError) as exc_info:
        await controller.list_sessions()

    assert exc_info.value.status_code == 504
    assert exc_info.value.code == "tmux_timeout"
    assert "tmux command timed out after 0.010s" in exc_info.value.message
    assert "list-sessions" in exc_info.value.message


@pytest.mark.anyio
async def test_tmux_commands_do_not_inherit_process_stdin_or_session(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_kwargs: dict[str, object] = {}

    async def fake_run_process(*args: object, **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        del args
        captured_kwargs.update(kwargs)
        return subprocess.CompletedProcess(["tmux"], 0, stdout=b"", stderr=b"")

    monkeypatch.setattr(anyio, "run_process", fake_run_process)
    controller = TmuxController(
        ShellctlConfig(
            state_dir=tmp_path / "state",
            runtime_dir=tmp_path / "run",
        )
    )

    await controller.start_server()

    assert captured_kwargs["stdin"] == subprocess.DEVNULL
    assert captured_kwargs["start_new_session"] is True


@pytest.mark.anyio
async def test_tmux_session_start_uses_dedicated_timeout(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def slow_run_process(*args: object, **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        del args, kwargs
        await anyio.sleep(1)
        return subprocess.CompletedProcess(["tmux"], 0, stdout=b"", stderr=b"")

    monkeypatch.setattr(anyio, "run_process", slow_run_process)
    controller = TmuxController(
        ShellctlConfig(
            state_dir=tmp_path / "state",
            runtime_dir=tmp_path / "run",
            tmux_command_timeout_seconds=30.0,
            tmux_session_start_timeout_seconds=0.01,
        )
    )

    with pytest.raises(ShellctlServerError) as exc_info:
        await controller.create_job_session(
            job_id="job-timeout",
            job_dir=tmp_path / "job-timeout",
            cwd=tmp_path,
            terminal=TerminalSize(cols=120, rows=80),
        )

    assert exc_info.value.status_code == 504
    assert exc_info.value.code == "tmux_timeout"
    assert "tmux command timed out after 0.010s" in exc_info.value.message
    assert "new-session" in exc_info.value.message


@pytest.mark.anyio
async def test_tmux_session_start_timeout_succeeds_when_session_was_created(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_name = job_session_name("job-timeout")

    async def fake_run_process(
        command: list[str],
        **kwargs: object,
    ) -> subprocess.CompletedProcess[bytes]:
        del kwargs
        if "new-session" in command:
            await anyio.sleep(1)
            return subprocess.CompletedProcess(command, 0, stdout=b"", stderr=b"")
        if "list-sessions" in command:
            return subprocess.CompletedProcess(command, 0, stdout=f"{session_name}\n".encode(), stderr=b"")
        return subprocess.CompletedProcess(command, 1, stdout=b"", stderr=b"unexpected command")

    monkeypatch.setattr(anyio, "run_process", fake_run_process)
    controller = TmuxController(
        ShellctlConfig(
            state_dir=tmp_path / "state",
            runtime_dir=tmp_path / "run",
            tmux_session_start_timeout_seconds=0.01,
        )
    )

    await controller.create_job_session(
        job_id="job-timeout",
        job_dir=tmp_path / "job-timeout",
        cwd=tmp_path,
        terminal=TerminalSize(cols=120, rows=80),
    )


def test_pipe_command_finalizer_commits_runner_exit_after_drain(tmp_path: Path) -> None:
    controller = TmuxController(
        ShellctlConfig(
            state_dir=tmp_path / "state",
            runtime_dir=tmp_path / "run",
            sqlite_busy_timeout_ms=6789,
        )
    )
    source = controller._pipe_command_source(
        job_id="05211530-k7p",
        job_dir=tmp_path / "state" / "jobs" / "05211530-k7p",
        ready_file=tmp_path / "state" / "jobs" / "05211530-k7p" / ".pipe-ready",
    )

    assert "shellctl-sanitize-pty" in source
    assert PIPE_DRAINED_FILENAME in source
    assert PIPE_ERROR_LOG_FILENAME in source
    assert PIPE_FAILED_FILENAME in source
    assert RUNNER_EXIT_CODE_FILENAME in source
    assert RUNNER_ENDED_AT_FILENAME in source
    assert "shellctl-runner-exit" in source
    assert "--sqlite-busy-timeout-ms 6789" in source
    assert "2>>" in source
    assert 'exit "$sanitize_status"' in source
    assert 'if [ "$sanitize_status" -eq 0 ]' in source
    assert "2>" in source
    assert source.index("shellctl-sanitize-pty") < source.index(PIPE_DRAINED_FILENAME)
    assert source.index(PIPE_DRAINED_FILENAME) < source.index("shellctl-runner-exit")


def test_server_cli_no_longer_exposes_sanitize_pty_command() -> None:
    result = CliRunner().invoke(cli, ["sanitize-pty"])

    assert result.exit_code != 0


def test_python_m_shellctl_server_module_entrypoint_shows_cli_help() -> None:
    package_root = Path(__file__).resolve().parents[3]
    src_path = package_root / "src"
    env = dict(os.environ)
    current_pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = f"{src_path}{os.pathsep}{current_pythonpath}" if current_pythonpath else str(src_path)

    result = subprocess.run(
        [sys.executable, "-m", "shellctl.server", "--help"],
        capture_output=True,
        text=True,
        check=False,
        cwd=package_root,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    assert "sanitize-pty" not in result.stdout
    assert "runner-exit" not in result.stdout


def test_server_package_keeps_config_access_lazy() -> None:
    package_root = Path(__file__).resolve().parents[3]
    src_path = package_root / "src"
    env = dict(os.environ)
    current_pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = f"{src_path}{os.pathsep}{current_pythonpath}" if current_pythonpath else str(src_path)

    script = """
import json
import sys

import shellctl.server as server

server.ShellctlConfig

print(json.dumps({
    "deny": sorted(
        name for name in sys.modules
        if name.split(".", 1)[0] in {"fastapi", "typer", "uvicorn"}
    ),
    "server_modules": sorted(
        name for name in sys.modules
        if name.startswith("shellctl.server.")
    ),
}))
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        check=False,
        cwd=package_root,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["deny"] == []
    assert "shellctl.server.api" not in payload["server_modules"]
    assert "shellctl.server.cli" not in payload["server_modules"]
    assert "shellctl.server.service" not in payload["server_modules"]
