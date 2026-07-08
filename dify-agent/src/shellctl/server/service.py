"""SQLite-backed shellctl job service.

This module owns the long-lived job lifecycle rules: artifact creation,
SQLite compare-and-swap transitions, tmux reconciliation, runner exit
materialization, and GC. API and local server entrypoints should call into
`ShellctlService` rather than duplicating lifecycle logic, choosing either the
lightweight `prepare_runtime()` bootstrap or the full `initialize()` startup
depending on whether they need bounded setup work or long-running maintenance.
"""

from __future__ import annotations

import asyncio
import json
import shlex
import shutil
import stat
import sys
from contextlib import suppress
from pathlib import Path
from typing import Any, cast

import anyio
from sqlalchemy import case, delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from shellctl.server.artifacts import (
    JOB_ENV_FILENAME,
    RUNNER_ENDED_AT_FILENAME,
    RUNNER_EXIT_CODE_FILENAME,
    job_env_path,
    pipe_drained_path,
    pipe_error_log_path,
    pipe_failed_path,
    runner_ended_at_path,
    runner_exit_code_path,
)
from shellctl.server.config import ShellctlConfig
from shellctl.server.db import JobRow, configure_sqlite_engine
from shellctl.server.errors import ShellctlServerError
from shellctl.server.tmux import (
    TmuxController,
    TmuxControllerProtocol,
)
from shellctl.shared.constants import DEFAULT_AUTH_TOKEN_ENV
from shellctl.shared.output import (
    OutputWindow,
    read_output_window,
    tail_output_window,
)
from shellctl.shared.runtime import (
    format_timestamp,
    generate_job_id,
    is_terminal_status,
    job_pane_target,
    job_session_name,
    parse_timestamp,
    utc_now,
)
from shellctl.shared.schemas import (
    DeleteJobResponse,
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
)


class ShellctlService:
    """SQLite-backed shellctl job service used by HTTP and local server entrypoints.

    The service keeps only minimal in-memory coordination state:

    - `_starting_jobs` prevents `created`/`starting` rows from being marked
      `lost` while the current startup path is still installing tmux state.

    Everything else uses SQLite conditional updates so concurrent readers and
    lifecycle paths converge through the DB rather than through mutable JSON
    artifacts.
    """

    def __init__(
        self,
        config: ShellctlConfig,
        *,
        tmux: TmuxControllerProtocol | None = None,
    ) -> None:
        self.config = config
        self._tmux = tmux or TmuxController(config)
        self._gc_task: asyncio.Task[None] | None = None
        self._monitor_task: asyncio.Task[None] | None = None
        self._starting_jobs: set[str] = set()
        self._engine = create_async_engine(self.config.database_url, future=True)
        configure_sqlite_engine(
            self._engine,
            busy_timeout_ms=self.config.sqlite_busy_timeout_ms,
        )
        self._session_factory = async_sessionmaker(
            self._engine,
            expire_on_commit=False,
            class_=AsyncSession,
        )

    async def initialize_database(self) -> None:
        """Ensure the SQLite database exists and its schema is initialized."""

        self._ensure_dir(self.config.state_dir)
        async with self._engine.begin() as connection:
            await connection.run_sync(SQLModel.metadata.create_all)

    async def prepare_runtime(self) -> None:
        """Prepare the minimal local runtime needed for bounded server-side work.

        This startup path intentionally skips reconciliation, GC, and background
        tasks. Entry points that only need local runtime artifacts should stay
        bounded by the requested operation instead of scanning or maintaining
        the full historical job set on every invocation.
        """

        await self.initialize_database()
        self._ensure_dir(cast(Path, self.config.runtime_dir))
        self._ensure_dir(self.config.jobs_dir)
        self._ensure_dir(self.config.runner_path.parent)
        self._install_runner()
        await self._tmux.start_server()

    async def initialize(self) -> None:
        """Run the full server startup path used by `shellctl serve`.

        Auth is configured at the API layer, so service startup must also work
        when `shellctl serve` is intentionally running without a bearer token.
        Unlike `prepare_runtime()`, this path also reconciles persisted jobs and
        performs one foreground GC pass before the long-running server starts.
        """

        await self.prepare_runtime()
        await self.reconcile()
        await self.gc_once()

    async def shutdown(self) -> None:
        """Stop background work and close the SQLite engine."""

        for task_name in ("_gc_task", "_monitor_task"):
            task = getattr(self, task_name)
            if task is not None:
                task.cancel()
                with anyio.CancelScope(shield=True):
                    with suppress(asyncio.CancelledError):
                        await task
                setattr(self, task_name, None)
        await self._engine.dispose()

    def start_background_gc(self) -> None:
        if self._gc_task is None:
            self._gc_task = asyncio.create_task(self._gc_loop(), name="shellctl-gc")

    def start_background_pipe_monitor(self) -> None:
        if self._monitor_task is None:
            self._monitor_task = asyncio.create_task(
                self._pipe_monitor_loop(), name="shellctl-pipe-monitor"
            )

    async def run_job(self, request: RunJobRequest) -> JobResult:
        """Create a tmux-backed job and wait for its initial result window.

        Side effects:
        - allocates `jobs/<job_id>/` and writes `script`, `.job-env.json`, and
          `output.log`
        - inserts a `jobs` row into SQLite, then conditionally transitions it
          through `created -> starting -> running`
        - creates a dedicated tmux session, installs `pipe-pane`, waits for the
          sanitize/output pipeline ready-file handshake, and only then opens the
          `start-gate`
        - on startup failure, marks the job `failed` in SQLite and cleans up the
          tmux session without deleting the job artifacts

        Returns:
            The same `JobResult` shape as `wait()`, starting from byte offset 0.

        Notes:
            The startup reservation in `_starting_jobs` exists so concurrent
            status/list/reconcile calls can observe a fresh row as a legitimate
            `created`/`starting` job instead of materializing it to `lost` before
            tmux becomes visible.
        """

        cwd = self._resolve_cwd(request.cwd)
        env = self._resolve_env(request.env)
        terminal = request.terminal or TerminalSize(
            cols=self.config.default_terminal_cols,
            rows=self.config.default_terminal_rows,
        )
        created_at = format_timestamp()

        job_id: str | None = None
        job_dir: Path | None = None
        while True:
            candidate_job_id, candidate_job_dir = self._allocate_job_dir()
            try:
                self._starting_jobs.add(candidate_job_id)
                script_path = candidate_job_dir / "script"
                output_path = candidate_job_dir / "output.log"
                script_path.write_text(request.script, encoding="utf-8")
                job_env_path(candidate_job_dir).write_text(
                    json.dumps(env, ensure_ascii=False),
                    encoding="utf-8",
                )
                output_path.touch()
                row = JobRow(
                    job_id=candidate_job_id,
                    script_path=f"jobs/{candidate_job_id}/script",
                    output_path=f"jobs/{candidate_job_id}/output.log",
                    cwd=str(cwd),
                    terminal_cols=terminal.cols,
                    terminal_rows=terminal.rows,
                    status=JobStatusName.CREATED.value,
                    session_name=job_session_name(candidate_job_id),
                    pane_target=job_pane_target(candidate_job_id),
                    exit_code=None,
                    reason=None,
                    message=None,
                    created_at=created_at,
                    started_at=None,
                    ended_at=None,
                    updated_at=created_at,
                )
                if await self._insert_job_row(row):
                    job_id = candidate_job_id
                    job_dir = candidate_job_dir
                    break
                self._starting_jobs.discard(candidate_job_id)
            except BaseException:
                self._starting_jobs.discard(candidate_job_id)
                shutil.rmtree(candidate_job_dir, ignore_errors=True)
                raise
            shutil.rmtree(candidate_job_dir, ignore_errors=True)

        assert job_id is not None and job_dir is not None
        await self._transition_status(
            job_id,
            allowed_from={JobStatusName.CREATED},
            target=JobStatusName.STARTING,
        )

        try:
            pipe_ready_path = job_dir / ".pipe-ready"
            await self._tmux.create_job_session(
                job_id=job_id,
                job_dir=job_dir,
                cwd=cwd,
                terminal=terminal,
            )
            await self._tmux.enable_output_pipe(
                job_id=job_id,
                job_dir=job_dir,
                ready_file=pipe_ready_path,
            )
            await self._wait_for_output_pipe_ready(
                job_id=job_id,
                ready_file=pipe_ready_path,
            )
            (job_dir / "start-gate").touch()
            await self._transition_status(
                job_id,
                allowed_from={JobStatusName.STARTING},
                target=JobStatusName.RUNNING,
                require_exit_code_null=True,
            )
        except Exception as exc:
            await self._transition_status(
                job_id,
                allowed_from={
                    JobStatusName.CREATED,
                    JobStatusName.STARTING,
                    JobStatusName.RUNNING,
                },
                target=JobStatusName.FAILED,
                reason=getattr(exc, "code", "start_failed"),
                message=str(exc),
            )
            await self._tmux.cleanup_session(job_id=job_id)
        finally:
            (job_dir / ".pipe-ready").unlink(missing_ok=True)
            self._starting_jobs.discard(job_id)

        return await self.wait_job(
            job_id,
            WaitJobRequest(
                offset=0,
                timeout=request.timeout,
                output_limit=request.output_limit,
                idle_flush_seconds=request.idle_flush_seconds,
            ),
        )

    async def wait_job(self, job_id: str, request: WaitJobRequest) -> JobResult:
        """Block until output, completion, truncation, or timeout."""

        row = await self._get_job_row(job_id)
        output_path = self._output_log_path(row)
        self._validate_offset(output_path, request.offset)
        deadline = anyio.current_time() + request.timeout
        last_size = output_path.stat().st_size if output_path.exists() else 0
        saw_output = last_size > request.offset
        last_growth_at: float | None = anyio.current_time() if saw_output else None

        while True:
            view = await self.get_job_status(job_id)
            current_size = output_path.stat().st_size if output_path.exists() else 0
            if request.offset > current_size:
                raise ShellctlServerError(
                    400,
                    "invalid_offset",
                    f"offset {request.offset} exceeds current file size {current_size}",
                )

            if current_size > last_size:
                last_size = current_size
                if current_size > request.offset:
                    saw_output = True
                    last_growth_at = anyio.current_time()

            if view.done:
                window = read_output_window(
                    output_path,
                    offset=request.offset,
                    limit=request.output_limit,
                )
                return self._job_result_from_view(view, row, window)

            if current_size > request.offset:
                window = read_output_window(
                    output_path,
                    offset=request.offset,
                    limit=request.output_limit,
                )
                if window.truncated:
                    return self._job_result_from_view(view, row, window)
                if saw_output and last_growth_at is not None:
                    idle_elapsed = anyio.current_time() - last_growth_at
                    if idle_elapsed >= request.idle_flush_seconds:
                        return self._job_result_from_view(view, row, window)

            if anyio.current_time() >= deadline:
                window = (
                    read_output_window(
                        output_path,
                        offset=request.offset,
                        limit=request.output_limit,
                    )
                    if current_size > request.offset
                    else OutputWindow(output="", offset=request.offset, truncated=False)
                )
                return self._job_result_from_view(view, row, window)

            await anyio.sleep(self.config.poll_interval_seconds)

    async def tail_job(self, job_id: str, *, output_limit: int) -> JobResult:
        row = await self._get_job_row(job_id)
        view = await self.get_job_status(job_id)
        tail = tail_output_window(self._output_log_path(row), limit=output_limit)
        return self._job_result_from_view(view, row, tail, truncated=False)

    async def get_job_status(self, job_id: str) -> JobStatusView:
        session_exists, pipe_active = await self._live_runtime_state(job_id)
        view = await self._materialize_status_view(
            job_id,
            session_exists=session_exists,
            pipe_active=pipe_active,
        )
        if view.done:
            await self._tmux.cleanup_session(job_id=job_id)
        return view

    async def list_jobs(
        self,
        *,
        status: JobStatusName | None = None,
        limit: int,
    ) -> ListJobsResponse:
        """List recent jobs ordered by `created_at` descending.

        This intentionally uses live per-job runtime queries instead of a single
        tmux snapshot so concurrent startup cannot turn a healthy job into `lost`.
        Rows may also disappear concurrently because delete removes the DB record
        before artifact cleanup; such races are treated as benign skips rather
        than failing the whole list request.
        """

        rows = await self._list_job_rows()
        items: list[JobInfo] = []
        for row in rows:
            try:
                view = await self.get_job_status(row.job_id)
            except ShellctlServerError as exc:
                if exc.code == "job_not_found":
                    continue
                raise
            if status is not None and view.status != status:
                continue
            items.append(
                JobInfo(
                    job_id=view.job_id,
                    status=view.status,
                    created_at=view.created_at,
                    started_at=view.started_at,
                    ended_at=view.ended_at,
                )
            )
            if len(items) >= limit:
                break
        return ListJobsResponse(jobs=items)

    async def send_input(self, job_id: str, request: InputJobRequest) -> JobResult:
        """Send input to a running job and then wait using the same semantics as `wait()`.

        If the pane disappears after the initial running-state check, this method
        re-materializes the job state before deciding whether to return terminal
        `409` semantics or a true internal tmux failure.
        """

        view = await self.get_job_status(job_id)
        if view.done:
            raise ShellctlServerError(
                409, "job_not_running", f"Job {job_id} is already terminal"
            )
        try:
            await self._tmux.send_input(job_id=job_id, text=request.text)
        except ShellctlServerError as exc:
            if exc.code != "tmux_target_missing":
                raise
            view = await self.get_job_status(job_id)
            if view.done:
                raise ShellctlServerError(
                    409, "job_not_running", f"Job {job_id} is already terminal"
                ) from exc
            raise ShellctlServerError(500, "tmux_input_failed", exc.message) from exc
        return await self.wait_job(
            job_id,
            WaitJobRequest(
                offset=request.offset,
                timeout=request.timeout,
                output_limit=request.output_limit,
                idle_flush_seconds=request.idle_flush_seconds,
            ),
        )

    async def terminate_job(
        self, job_id: str, request: TerminateJobRequest
    ) -> JobStatusView:
        """Terminate a job, reserving `terminated` before tmux cleanup.

        The initial conditional DB update allows an `exited` row to be overridden
        only when it raced after an earlier non-terminal read in this method. That
        preserves proposal semantics: once a user terminates a non-terminal job,
        the final API status stays `terminated` even if the runner exits during the
        same window.
        """

        view = await self.get_job_status(job_id)
        if view.done:
            await self._tmux.cleanup_session(job_id=job_id)
            return view

        await self._transition_status(
            job_id,
            allowed_from={
                JobStatusName.CREATED,
                JobStatusName.STARTING,
                JobStatusName.RUNNING,
            },
            allow_override_from={JobStatusName.EXITED},
            target=JobStatusName.TERMINATED,
        )
        await self._tmux.send_interrupt(job_id=job_id)
        if request.grace_seconds > 0:
            await anyio.sleep(request.grace_seconds)
        await self._tmux.cleanup_session(job_id=job_id)
        return await self.get_job_status(job_id)

    async def delete_job(
        self,
        job_id: str,
        *,
        force: bool,
        grace_seconds: float,
    ) -> DeleteJobResponse:
        """Delete a job row and its artifacts.

        Behavior:
        - if the job is still non-terminal and `force` is false, raises `409`
        - if `force` is true, first applies normal terminate semantics
        - always best-effort cleans the tmux session before removing persisted
          state

        Deletion ordering matters: the SQLite row is removed before best-effort
        artifact-directory cleanup. That ordering intentionally avoids exposing a
        visible half-deleted state where API listing/status can still see a row
        whose `script` / `output.log` artifacts are already gone.
        """

        view = await self.get_job_status(job_id)
        if not view.done:
            if not force:
                raise ShellctlServerError(
                    409, "job_running", f"Job {job_id} is still running"
                )
            await self.terminate_job(
                job_id, TerminateJobRequest(grace_seconds=grace_seconds)
            )
        await self._tmux.cleanup_session(job_id=job_id)
        await self._delete_job_row(job_id)
        shutil.rmtree(self._artifact_dir(job_id), ignore_errors=True)
        return DeleteJobResponse(job_id=job_id)

    async def reconcile(self) -> None:
        """Reconcile SQLite rows against live tmux state using per-job probes.

        Reconciliation also uses a live per-job runtime query to avoid turning a
        job that is still completing startup into `lost` based on an earlier tmux
        snapshot.
        Jobs may disappear between the initial row query and the later status
        materialization because delete removes the SQLite row first. Reconciliation
        treats that race as benign and continues with the remaining jobs.
        """

        for row in await self._list_job_rows():
            try:
                view = await self.get_job_status(row.job_id)
            except ShellctlServerError as exc:
                if exc.code == "job_not_found":
                    continue
                raise
            if view.done:
                await self._tmux.cleanup_session(job_id=row.job_id)

    async def gc_once(self) -> None:
        """Delete expired terminal rows and their artifact directories.

        Like reconciliation, GC tolerates rows disappearing mid-pass due to a
        concurrent explicit delete.

        Deletion ordering matches explicit delete semantics: remove the SQLite
        row first, then best-effort delete the artifact directory. That keeps the
        DB/API source of truth from exposing a row whose filesystem artifacts have
        already been removed.
        """

        cutoff = utc_now().timestamp() - self.config.gc_finished_job_retention_seconds
        for row in await self._list_job_rows():
            try:
                view = await self.get_job_status(row.job_id)
            except ShellctlServerError as exc:
                if exc.code == "job_not_found":
                    continue
                raise
            if not view.done or view.ended_at is None:
                continue
            if parse_timestamp(view.ended_at).timestamp() >= cutoff:
                continue
            await self._tmux.cleanup_session(job_id=row.job_id)
            try:
                await self._delete_job_row(row.job_id)
            except ShellctlServerError as exc:
                if exc.code == "job_not_found":
                    continue
                raise
            shutil.rmtree(self._artifact_dir(row.job_id), ignore_errors=True)

    async def record_runner_exit(
        self, job_id: str, exit_code: int, ended_at: str
    ) -> None:
        """Persist a drained normal-exit fact into SQLite.

        The usual caller is the tmux pipe finalizer after the lightweight PTY
        sanitizer reaches EOF and flushes `output.log`. `_materialize_status_view()`
        may also call this as a recovery path when `.pipe-drained` plus the
        normal exit metadata files exist but SQLite is still non-terminal. The
        statement always records `exit_code` and `ended_at`, but it only changes
        `status` to `exited` when the current row is still non-terminal.
        """

        nonterminal = [
            JobStatusName.CREATED.value,
            JobStatusName.STARTING.value,
            JobStatusName.RUNNING.value,
        ]
        job_id_col = cast(Any, JobRow.job_id)
        status_col = cast(Any, JobRow.status)
        ended_at_col = cast(Any, JobRow.ended_at)
        reason_col = cast(Any, JobRow.reason)
        message_col = cast(Any, JobRow.message)
        async with self._session_factory() as session:
            stmt = (
                update(JobRow)
                .where(job_id_col == job_id)
                .values(
                    exit_code=exit_code,
                    ended_at=case(
                        (ended_at_col.is_(None), ended_at),
                        else_=ended_at_col,
                    ),
                    updated_at=ended_at,
                    status=case(
                        (status_col.in_(nonterminal), JobStatusName.EXITED.value),
                        else_=status_col,
                    ),
                    reason=case(
                        (status_col.in_(nonterminal), None),
                        else_=reason_col,
                    ),
                    message=case(
                        (status_col.in_(nonterminal), None),
                        else_=message_col,
                    ),
                )
            )
            result = await session.execute(stmt)
            if cast(Any, result).rowcount == 0:
                raise ShellctlServerError(
                    404, "job_not_found", f"Unknown job id: {job_id}"
                )
            await session.commit()

    async def check_running_jobs_pipe_health(self) -> None:
        """Fail running jobs whose tmux output pipe disappeared after startup."""

        for row in await self._list_job_rows(statuses={JobStatusName.RUNNING}):
            session_exists, pipe_active = await self._live_runtime_state(row.job_id)
            view = await self._materialize_status_view(
                row.job_id,
                session_exists=session_exists,
                pipe_active=pipe_active,
            )
            if view.done:
                await self._tmux.cleanup_session(job_id=row.job_id)

    async def _gc_loop(self) -> None:
        while True:
            await anyio.sleep(self.config.gc_interval_seconds)
            await self.gc_once()

    async def _pipe_monitor_loop(self) -> None:
        while True:
            await anyio.sleep(self.config.pipe_monitor_interval_seconds)
            await self.check_running_jobs_pipe_health()

    async def _wait_for_output_pipe_ready(
        self, *, job_id: str, ready_file: Path
    ) -> None:
        """Confirm the sanitize/output pipeline is live before opening start-gate.

        Timeout failures include the ready-file path, current `#{pane_pipe}`
        state, and a summary of `pipe-error.log` so operators can tell the
        difference between slow startup, tmux pipe loss, and sanitizer crashes.
        """

        started_at = anyio.current_time()
        deadline = started_at + self.config.pipe_ready_timeout_seconds
        while True:
            waited_seconds = anyio.current_time() - started_at
            if ready_file.exists():
                pipe_state = await self._tmux.is_output_pipe_active(job_id=job_id)
                if pipe_state is True:
                    return
                if pipe_state is None:
                    raise ShellctlServerError(
                        500,
                        "pipe_failed",
                        self._pipe_ready_failure_message(
                            job_id=job_id,
                            ready_file=ready_file,
                            waited_seconds=waited_seconds,
                            pipe_state=pipe_state,
                            cause="tmux pane disappeared after the ready-file handshake",
                        ),
                    )
            else:
                if not await self._tmux.session_exists(job_session_name(job_id)):
                    pipe_state = await self._tmux.is_output_pipe_active(job_id=job_id)
                    raise ShellctlServerError(
                        500,
                        "pipe_failed",
                        self._pipe_ready_failure_message(
                            job_id=job_id,
                            ready_file=ready_file,
                            waited_seconds=waited_seconds,
                            pipe_state=pipe_state,
                            cause="tmux session exited before the ready-file handshake",
                        ),
                    )
            if anyio.current_time() >= deadline:
                pipe_state = await self._tmux.is_output_pipe_active(job_id=job_id)
                raise ShellctlServerError(
                    500,
                    "pipe_failed",
                    self._pipe_ready_failure_message(
                        job_id=job_id,
                        ready_file=ready_file,
                        waited_seconds=waited_seconds,
                        pipe_state=pipe_state,
                        cause="timed out waiting for the sanitize/output pipeline handshake",
                    ),
                )
            await anyio.sleep(self.config.poll_interval_seconds)

    def _pipe_ready_failure_message(
        self,
        *,
        job_id: str,
        ready_file: Path,
        waited_seconds: float,
        pipe_state: bool | None,
        cause: str,
    ) -> str:
        """Build a startup error message with enough pipe diagnostics to debug."""

        return (
            f"Output pipe never became ready for {job_id}: {cause}; "
            f"waited {waited_seconds:.3f}s; "
            f"ready-file={ready_file}; "
            f"tmux #{{pane_pipe}}={self._format_pane_pipe_state(pipe_state)}; "
            f"pipe-error.log={self._pipe_error_log_summary(ready_file.parent)}"
        )

    def _format_pane_pipe_state(self, pipe_state: bool | None) -> str:
        if pipe_state is True:
            return "1"
        if pipe_state is False:
            return "0"
        return "pane-missing"

    def _pipe_error_log_summary(self, job_dir: Path) -> str:
        """Summarize sanitizer stderr without flooding API error responses."""

        error_log = pipe_error_log_path(job_dir)
        if not error_log.exists():
            return f"{error_log} missing"
        stderr_text = error_log.read_text(encoding="utf-8", errors="replace").strip()
        if not stderr_text:
            return f"{error_log} empty"
        summary = " | ".join(
            line.strip() for line in stderr_text.splitlines() if line.strip()
        )
        if not summary:
            return f"{error_log} contains only whitespace"
        if len(summary) > 240:
            summary = f"{summary[:237]}..."
        return f"{error_log}: {summary}"

    async def _materialize_status_view(
        self,
        job_id: str,
        *,
        session_exists: bool,
        pipe_active: bool | None,
    ) -> JobStatusView:
        """Materialize the current API status view from SQLite + live tmux state.

        Priority/invariants:
        - terminal SQLite status wins and is preserved
        - if SQLite already has an `exit_code` on a non-terminal row, materialize
          `exited`
        - if normal-exit metadata and `.pipe-drained` already exist, recover the
          drained normal exit immediately even when the finalizer has not yet
          committed SQLite state
        - if normal-exit metadata exists and neither `.pipe-drained` nor
          `.pipe-failed` exists, keep the non-terminal row instead of guessing
          `lost` while the pipe finalizer is still responsible for the eventual
          `runner-exit` commit
        - if a live tmux session exists but the output pipe is known-dead,
          conditionally materialize `failed(reason=pipe_failed)`
        - if no live session exists and the row is not protected by the local
          startup reservation, conditionally materialize `lost`

        This helper is the main reconciliation point between live tmux probes and
        persisted SQLite state. It must never revive terminal rows and must never
        convert an ambiguous startup race into `lost` while the current `run_job`
        path still owns that startup window.
        """

        row = await self._get_job_row(job_id)
        status = JobStatusName(row.status)

        if is_terminal_status(status):
            if row.ended_at is None:
                row = await self._transition_status(
                    job_id,
                    allowed_from={status},
                    target=status,
                    ended_at=format_timestamp(),
                )
        elif row.exit_code is not None:
            row = await self._transition_status(
                job_id,
                allowed_from={
                    JobStatusName.CREATED,
                    JobStatusName.STARTING,
                    JobStatusName.RUNNING,
                },
                target=JobStatusName.EXITED,
                ended_at=row.ended_at or format_timestamp(),
            )
        elif (drained_exit := self._drained_normal_exit_metadata(job_id)) is not None:
            exit_code, ended_at = drained_exit
            await self.record_runner_exit(job_id, exit_code, ended_at)
            row = await self._get_job_row(job_id)
        elif session_exists:
            if pipe_active is False:
                if (
                    status
                    in {
                        JobStatusName.CREATED,
                        JobStatusName.STARTING,
                    }
                    and job_id in self._starting_jobs
                ):
                    pass
                else:
                    row = await self._transition_status(
                        job_id,
                        allowed_from={
                            JobStatusName.CREATED,
                            JobStatusName.STARTING,
                            JobStatusName.RUNNING,
                        },
                        target=JobStatusName.FAILED,
                        reason="pipe_failed",
                        message="The tmux output pipe stopped while the job was still running.",
                        ended_at=format_timestamp(),
                    )
            elif (
                status in {JobStatusName.CREATED, JobStatusName.STARTING}
                and job_id not in self._starting_jobs
            ):
                row = await self._transition_status(
                    job_id,
                    allowed_from={JobStatusName.CREATED, JobStatusName.STARTING},
                    target=JobStatusName.RUNNING,
                    require_exit_code_null=True,
                )
        else:
            if self._normal_exit_commit_pending(job_id):
                pass
            elif not (
                status in {JobStatusName.CREATED, JobStatusName.STARTING}
                and job_id in self._starting_jobs
            ):
                row = await self._transition_status(
                    job_id,
                    allowed_from={
                        JobStatusName.CREATED,
                        JobStatusName.STARTING,
                        JobStatusName.RUNNING,
                    },
                    target=JobStatusName.LOST,
                    reason="tmux_session_missing",
                    message="The dedicated tmux session is no longer present.",
                    ended_at=format_timestamp(),
                )

        return self._status_view_from_row(row)

    async def _transition_status(
        self,
        job_id: str,
        *,
        allowed_from: set[JobStatusName],
        target: JobStatusName,
        allow_override_from: set[JobStatusName] | None = None,
        require_exit_code_null: bool = False,
        reason: str | None = None,
        message: str | None = None,
        ended_at: str | None = None,
    ) -> JobRow:
        """Conditionally transition a job row through a SQLite CAS update.

        This is the SQLite replacement for the old JSON+lock compare-and-swap
        flow. The method performs a single conditional `UPDATE ... WHERE ...`
        against the current row and returns the post-update materialized row.

        Invariants:
        - non-terminal states may only advance from explicitly allowed source
          states
        - callers can require `exit_code IS NULL` so late runner exits do not let
          startup paths overwrite a concurrently materialized terminal outcome
        - terminal transitions preserve first-writer semantics via the WHERE
          clause and fill `ended_at` only when needed
        - when the conditional update affects zero rows, the method returns the
          current persisted row instead of forcing a stale overwrite
        """

        now = format_timestamp()
        allowed_statuses = {status.value for status in allowed_from}
        if allow_override_from is not None:
            allowed_statuses.update(status.value for status in allow_override_from)

        values: dict[str, Any] = {
            "status": target.value,
            "updated_at": now,
            "reason": reason,
            "message": message,
        }
        status_col = cast(Any, JobRow.status)
        job_id_col = cast(Any, JobRow.job_id)
        started_at_col = cast(Any, JobRow.started_at)
        ended_at_col = cast(Any, JobRow.ended_at)
        exit_code_col = cast(Any, JobRow.exit_code)
        if target in {JobStatusName.STARTING, JobStatusName.RUNNING}:
            values["started_at"] = case(
                (started_at_col.is_(None), now),
                else_=started_at_col,
            )
        if is_terminal_status(target):
            values["ended_at"] = case(
                (ended_at_col.is_(None), ended_at or now),
                else_=ended_at_col,
            )

        async with self._session_factory() as session:
            stmt = update(JobRow).where(
                job_id_col == job_id, status_col.in_(allowed_statuses)
            )
            if require_exit_code_null:
                stmt = stmt.where(exit_code_col.is_(None))
            result = await session.execute(stmt.values(**values))
            await session.commit()
            if cast(Any, result).rowcount == 0:
                return await self._get_job_row(job_id)
        return await self._get_job_row(job_id)

    async def _live_runtime_state(self, job_id: str) -> tuple[bool, bool | None]:
        """Read tmux session/pipe liveness for one job.

        If the pane disappears between the session probe and the pipe probe, this
        helper degrades to `(False, None)` so reconciliation treats the job as a
        missing-session case rather than a `pipe_failed` case.
        """

        session_exists = await self._tmux.session_exists(job_session_name(job_id))
        if not session_exists:
            return False, None
        pipe_active = await self._tmux.is_output_pipe_active(job_id=job_id)
        if pipe_active is None:
            return False, None
        return True, pipe_active

    async def _insert_job_row(self, row: JobRow) -> bool:
        async with self._session_factory() as session:
            session.add(row)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                return False
        return True

    async def _delete_job_row(self, job_id: str) -> None:
        async with self._session_factory() as session:
            result = await session.execute(
                delete(JobRow).where(cast(Any, JobRow.job_id) == job_id)
            )
            if cast(Any, result).rowcount == 0:
                raise ShellctlServerError(
                    404, "job_not_found", f"Unknown job id: {job_id}"
                )
            await session.commit()

    async def _get_job_row(self, job_id: str) -> JobRow:
        async with self._session_factory() as session:
            row = await session.get(JobRow, job_id)
        if row is None:
            raise ShellctlServerError(404, "job_not_found", f"Unknown job id: {job_id}")
        return row

    async def _list_job_rows(
        self, *, statuses: set[JobStatusName] | None = None
    ) -> list[JobRow]:
        created_at_col = cast(Any, JobRow.created_at)
        status_col = cast(Any, JobRow.status)
        async with self._session_factory() as session:
            stmt = select(JobRow).order_by(created_at_col.desc())
            if statuses is not None:
                stmt = stmt.where(status_col.in_([status.value for status in statuses]))
            rows = (await session.execute(stmt)).scalars().all()
        return list(rows)

    def _status_view_from_row(self, row: JobRow) -> JobStatusView:
        status = JobStatusName(row.status)
        output_path = self._output_log_path(row)
        offset = output_path.stat().st_size if output_path.exists() else 0
        return JobStatusView(
            job_id=row.job_id,
            status=status,
            done=is_terminal_status(status),
            exit_code=row.exit_code,
            created_at=row.created_at,
            started_at=row.started_at,
            ended_at=row.ended_at,
            offset=offset,
        )

    def _job_result_from_view(
        self,
        view: JobStatusView,
        row: JobRow,
        window: OutputWindow,
        *,
        truncated: bool | None = None,
    ) -> JobResult:
        return JobResult(
            job_id=view.job_id,
            done=view.done,
            status=view.status,
            exit_code=view.exit_code,
            output_path=str(self._output_log_path(row).resolve()),
            output=window.output,
            offset=window.offset,
            truncated=window.truncated if truncated is None else truncated,
        )

    def _output_log_path(self, row: JobRow) -> Path:
        return self.config.state_dir / row.output_path

    def _artifact_dir(self, job_id: str) -> Path:
        return self.config.jobs_dir / job_id

    def _normal_exit_commit_pending(self, job_id: str) -> bool:
        """Check whether a normal exit is still waiting for pipe drain + commit."""

        job_dir = self._artifact_dir(job_id)
        return (
            runner_exit_code_path(job_dir).exists()
            and runner_ended_at_path(job_dir).exists()
            and not pipe_drained_path(job_dir).exists()
            and not pipe_failed_path(job_dir).exists()
        )

    def _drained_normal_exit_metadata(self, job_id: str) -> tuple[int, str] | None:
        """Read drained normal-exit metadata after successful sanitize drain."""

        job_dir = self._artifact_dir(job_id)
        drained_path = pipe_drained_path(job_dir)
        exit_code_path = runner_exit_code_path(job_dir)
        ended_at_path = runner_ended_at_path(job_dir)
        if (
            not drained_path.exists()
            or not exit_code_path.exists()
            or not ended_at_path.exists()
        ):
            return None
        raw_exit_code = exit_code_path.read_text(encoding="utf-8").strip()
        raw_ended_at = ended_at_path.read_text(encoding="utf-8").strip()
        if not raw_exit_code or not raw_ended_at:
            return None
        return int(raw_exit_code), raw_ended_at

    def _allocate_job_dir(self) -> tuple[str, Path]:
        """Atomically allocate a unique artifact directory for a new job.

        The proposal requires `mkdir jobs/<job_id>` itself to be the collision
        detector. We therefore create the directory inside this helper and retry
        on `FileExistsError` instead of using a separate `exists()` pre-check.
        """

        for _ in range(20):
            job_id = generate_job_id()
            job_dir = self.config.jobs_dir / job_id
            try:
                job_dir.mkdir(mode=0o700)
                return job_id, job_dir
            except FileExistsError:
                continue
        raise ShellctlServerError(
            500, "job_id_collision", "Failed to allocate a unique job id"
        )

    def _resolve_cwd(self, raw_cwd: str | None) -> Path:
        cwd = (
            Path(raw_cwd).expanduser()
            if raw_cwd is not None
            else self.config.default_cwd.expanduser()
        )
        cwd = cwd.resolve()
        if not cwd.exists() or not cwd.is_dir():
            raise ShellctlServerError(
                400, "invalid_cwd", f"cwd is not a directory: {cwd}"
            )
        return cwd

    def _resolve_env(self, raw_env: dict[str, str] | None) -> dict[str, str]:
        """Return a detached environment overlay for the generated runner.

        `RunJobRequest` validates names/values before the service sees them.
        The overlay augments the runner's inherited environment after shellctl
        scrubs its own control variables, so explicit request values can be used
        without replacing ambient entries like `PATH`.
        """

        return dict(raw_env or {})

    def _validate_offset(self, output_path: Path, offset: int) -> None:
        size = output_path.stat().st_size if output_path.exists() else 0
        if offset > size:
            raise ShellctlServerError(
                400,
                "invalid_offset",
                f"offset {offset} exceeds current file size {size}",
            )

    @staticmethod
    def _ensure_dir(path: Path) -> None:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.chmod(0o700)

    def _install_runner(self) -> None:
        self.config.runner_path.write_text(
            self._runner_script_source(), encoding="utf-8"
        )
        mode = self.config.runner_path.stat().st_mode
        self.config.runner_path.chmod(mode | stat.S_IXUSR)

    def _runner_script_source(self) -> str:
        """Build the bash runner installed into the shellctl runtime directory.

        The wrapper still handles gate waiting and exit metadata in bash, but it
        delegates launch setup to Python so per-job env overlays can be loaded
        from JSON without shell-escaping arbitrary values into `export`
        statements. The Python helper then `exec`s the target process instead of
        waiting on it, which keeps `SIGINT` behavior identical to running the
        script directly in the tmux pane. The bootstrap uses `python -c ...`
        instead of a stdin-fed heredoc so the exec'd job still inherits the tmux
        pane's PTY on fd 0 and can receive later `send_input()` data.
        """

        auth_env = shlex.quote(DEFAULT_AUTH_TOKEN_ENV)
        bootstrap_source = shlex.quote(
            """
import json
import os
import stat
import sys
from pathlib import Path

script_path = Path(sys.argv[1])
cwd = sys.argv[2]
env_path = Path(sys.argv[3])

env = os.environ.copy()
if env_path.exists():
    env.update(json.loads(env_path.read_text(encoding="utf-8")))

try:
    os.chdir(cwd)
except OSError:
    raise SystemExit(111)

with script_path.open("r", encoding="utf-8") as handle:
    first_line = handle.readline()

if first_line.startswith("#!"):
    script_path.chmod(script_path.stat().st_mode | stat.S_IXUSR)
    argv = [str(script_path)]
else:
    argv = ["sh", str(script_path)]

try:
    os.execvpe(argv[0], argv, env)
except FileNotFoundError as exc:
    print(f"{argv[0]}: {exc.strerror}", file=sys.stderr)
    raise SystemExit(127) from exc
except OSError as exc:
    print(f"{argv[0]}: {exc.strerror}", file=sys.stderr)
    raise SystemExit(126) from exc
            """.strip()
        )
        return f"""#!/usr/bin/env bash
set -uo pipefail

JOB_DIR="$1"
JOB_ID="$2"
CWD="$3"
SCRIPT_PATH="$JOB_DIR/script"
ENV_PATH="$JOB_DIR/{JOB_ENV_FILENAME}"
START_GATE="$JOB_DIR/start-gate"
RUNNER_EXIT_CODE_PATH="$JOB_DIR/{RUNNER_EXIT_CODE_FILENAME}"
RUNNER_ENDED_AT_PATH="$JOB_DIR/{RUNNER_ENDED_AT_FILENAME}"

write_atomic() {{
  local dest="$1"
  local value="$2"
  local tmp="${{dest}}.tmp.$$"
  printf '%s\n' "$value" > "$tmp"
  mv "$tmp" "$dest"
}}

while [ ! -e "$START_GATE" ]; do
  sleep 0.05
done

unset TMUX
unset SHELLCTL_STATE_DIR
unset SHELLCTL_RUNTIME_DIR
unset SHELLCTL_TMUX_SOCKET
unset SHELLCTL_RUNNER
unset {auth_env}

{shlex.quote(sys.executable)} -c {bootstrap_source} "$SCRIPT_PATH" "$CWD" "$ENV_PATH"
EXIT_CODE=$?

ENDED_AT="$({shlex.quote(sys.executable)} - <<'PY'
from datetime import UTC, datetime
print(datetime.now(UTC).replace(microsecond=0).isoformat().replace('+00:00', 'Z'))
PY
)"

write_atomic "$RUNNER_EXIT_CODE_PATH" "$EXIT_CODE"
write_atomic "$RUNNER_ENDED_AT_PATH" "$ENDED_AT"

exit "$EXIT_CODE"
"""


__all__ = ["ShellctlService", "anyio", "shutil"]
