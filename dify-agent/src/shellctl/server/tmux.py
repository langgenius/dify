"""tmux control layer for shellctl jobs.

The rest of shellctl treats this module as the only place that knows tmux CLI
 command shapes. Tests can replace `TmuxControllerProtocol` with a fake to
 exercise SQLite/output semantics without depending on a local tmux daemon.
"""

from __future__ import annotations

import os
import shlex
import subprocess
import tempfile
from pathlib import Path
from typing import Protocol, cast

import anyio

from shellctl.server.artifacts import (
    pipe_drained_path,
    pipe_error_log_path,
    pipe_failed_path,
    runner_ended_at_path,
    runner_exit_code_path,
)
from shellctl.server.config import ShellctlConfig
from shellctl.server.errors import ShellctlServerError
from shellctl.shared.runtime import (
    job_pane_target,
    job_session_name,
)
from shellctl.shared.schemas import TerminalSize


class TmuxControllerProtocol(Protocol):
    """Protocol used by `ShellctlService` for tmux interactions."""

    async def start_server(self) -> None: ...

    async def list_sessions(self) -> set[str]: ...

    async def session_exists(self, session_name: str) -> bool: ...

    async def is_output_pipe_active(self, *, job_id: str) -> bool | None: ...

    async def create_job_session(
        self,
        *,
        job_id: str,
        job_dir: Path,
        cwd: Path,
        terminal: TerminalSize,
    ) -> None: ...

    async def enable_output_pipe(
        self, *, job_id: str, job_dir: Path, ready_file: Path
    ) -> None: ...

    async def send_input(self, *, job_id: str, text: str) -> None: ...

    async def send_interrupt(self, *, job_id: str) -> None: ...

    async def cleanup_session(self, *, job_id: str) -> None: ...


class TmuxController:
    """Best-effort wrapper around a dedicated tmux socket.

    The controller always clears `TMUX` from the child environment and always
    passes `-S <socket>` so shellctl sessions stay isolated from the user's
    default tmux server.
    """

    def __init__(self, config: ShellctlConfig) -> None:
        self._config = config

    async def start_server(self) -> None:
        await self._run_tmux("start-server")

    async def list_sessions(self) -> set[str]:
        result = await self._run_tmux(
            "list-sessions", "-F", "#{session_name}", check=False
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")
            if _tmux_target_missing(stderr):
                return set()
            raise ShellctlServerError(
                500, "tmux_error", stderr.strip() or "tmux list-sessions failed"
            )
        output = result.stdout.decode("utf-8", errors="replace")
        return {line.strip() for line in output.splitlines() if line.strip()}

    async def session_exists(self, session_name: str) -> bool:
        return session_name in await self.list_sessions()

    async def is_output_pipe_active(self, *, job_id: str) -> bool | None:
        result = await self._run_tmux(
            "display-message",
            "-p",
            "-t",
            job_pane_target(job_id),
            "#{pane_pipe}",
            check=False,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")
            if _tmux_target_missing(stderr):
                return None
            raise ShellctlServerError(
                500,
                "tmux_error",
                stderr.strip() or f"Failed to inspect output pipe for {job_id}",
            )
        return result.stdout.decode("utf-8", errors="replace").strip() == "1"

    async def create_job_session(
        self,
        *,
        job_id: str,
        job_dir: Path,
        cwd: Path,
        terminal: TerminalSize,
    ) -> None:
        runner_command = self._shell_join(
            [
                str(self._config.runner_path),
                str(job_dir),
                job_id,
                str(cwd),
            ]
        )
        result = await self._run_tmux(
            "-f",
            "/dev/null",
            "new-session",
            "-d",
            "-s",
            job_session_name(job_id),
            "-x",
            str(terminal.cols),
            "-y",
            str(terminal.rows),
            runner_command,
            check=False,
        )
        if result.returncode != 0:
            raise ShellctlServerError(
                500,
                "tmux_new_session_failed",
                result.stderr.decode("utf-8", errors="replace").strip()
                or f"Failed to create tmux session for {job_id}",
            )

    async def enable_output_pipe(
        self, *, job_id: str, job_dir: Path, ready_file: Path
    ) -> None:
        output_command = self._pipe_command_source(
            job_id=job_id,
            job_dir=job_dir,
            ready_file=ready_file,
        )
        result = await self._run_tmux(
            "pipe-pane",
            "-o",
            "-t",
            job_pane_target(job_id),
            output_command,
            check=False,
        )
        if result.returncode != 0:
            raise ShellctlServerError(
                500,
                "pipe_failed",
                result.stderr.decode("utf-8", errors="replace").strip()
                or f"Failed to attach output pipe for {job_id}",
            )

    def _pipe_command_source(
        self, *, job_id: str, job_dir: Path, ready_file: Path
    ) -> str:
        """Build the tmux `pipe-pane` command that drains and finalizes output.

        For normal exits, the runner now records completion metadata into job
        artifacts and the pipe finalizer commits `runner-exit` only after
        the lightweight sanitizer reaches EOF and flushes `output.log`
        successfully. Sanitizer stderr is captured into `pipe-error.log` so
        startup timeouts can distinguish slow imports from subprocess crashes.
        If the follow-up `runner-exit` write fails, the drain marker remains in
        place and stderr is appended to the same log with an explicit status
        line. The pipe still exits with the sanitizer status so a drained job is
        not misclassified as `pipe_failed` before reconciliation can recover the
        SQLite write from the drained artifacts.
        """

        sanitize_command = self._shell_join(
            (
                *self._config.sanitize_pty_command,
                "--ready-file",
                str(ready_file),
            )
        )
        runner_exit_command = self._shell_join(
            (
                *self._config.runner_exit_command,
                "--state-dir",
                str(self._config.state_dir),
                "--job-id",
                job_id,
                "--sqlite-busy-timeout-ms",
                str(self._config.sqlite_busy_timeout_ms),
            )
        )
        output_path = shlex.quote(str(job_dir / "output.log"))
        drained_path = shlex.quote(str(pipe_drained_path(job_dir)))
        error_log_path = shlex.quote(str(pipe_error_log_path(job_dir)))
        failed_path = shlex.quote(str(pipe_failed_path(job_dir)))
        exit_code_path = shlex.quote(str(runner_exit_code_path(job_dir)))
        ended_at_path = shlex.quote(str(runner_ended_at_path(job_dir)))
        return " ; ".join(
            [
                f"{sanitize_command} >> {output_path} 2> {error_log_path}",
                "sanitize_status=$?",
                "runner_exit_status=0",
                (
                    'if [ "$sanitize_status" -eq 0 ]; then '
                    f": > {drained_path}; "
                    f"if [ -s {exit_code_path} ] && [ -s {ended_at_path} ]; then "
                    f'{runner_exit_command} --exit-code "$(cat {exit_code_path})" '
                    f'--ended-at "$(cat {ended_at_path})" 2>> {error_log_path}; '
                    "runner_exit_status=$?; "
                    'if [ "$runner_exit_status" -ne 0 ]; then '
                    f"printf 'runner-exit failed with status %s\\n' \"$runner_exit_status\" >> {error_log_path}; "
                    "fi; fi; "
                    f"else : > {failed_path}; fi"
                ),
                'if [ "$sanitize_status" -ne 0 ]; then exit "$sanitize_status"; fi',
                'exit "$sanitize_status"',
            ]
        )

    async def send_input(self, *, job_id: str, text: str) -> None:
        buffer_name = f"shellctl-in-{job_id}"
        runtime_dir = cast(Path, self._config.runtime_dir)
        runtime_dir.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            prefix=f"shellctl-input-{job_id}-", dir=runtime_dir
        )
        tmp_path = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(text)
            load_result = await self._run_tmux(
                "load-buffer",
                "-b",
                buffer_name,
                str(tmp_path),
                check=False,
            )
            if load_result.returncode != 0:
                stderr = load_result.stderr.decode("utf-8", errors="replace").strip()
                if _tmux_target_missing(stderr):
                    raise ShellctlServerError(
                        409,
                        "tmux_target_missing",
                        stderr or f"The tmux pane for {job_id} is no longer available",
                    )
                raise ShellctlServerError(
                    500,
                    "tmux_input_failed",
                    stderr or f"Failed to load input buffer for {job_id}",
                )
            paste_result = await self._run_tmux(
                "paste-buffer",
                "-t",
                job_pane_target(job_id),
                "-b",
                buffer_name,
                check=False,
            )
            if paste_result.returncode != 0:
                stderr = paste_result.stderr.decode("utf-8", errors="replace").strip()
                if _tmux_target_missing(stderr):
                    raise ShellctlServerError(
                        409,
                        "tmux_target_missing",
                        stderr or f"The tmux pane for {job_id} is no longer available",
                    )
                raise ShellctlServerError(
                    500,
                    "tmux_input_failed",
                    stderr or f"Failed to paste input buffer for {job_id}",
                )
        finally:
            await self._run_tmux("delete-buffer", "-b", buffer_name, check=False)
            tmp_path.unlink(missing_ok=True)

    async def send_interrupt(self, *, job_id: str) -> None:
        await self._run_tmux(
            "send-keys",
            "-t",
            job_pane_target(job_id),
            "C-c",
            check=False,
        )

    async def cleanup_session(self, *, job_id: str) -> None:
        await self._run_tmux(
            "kill-session",
            "-t",
            job_session_name(job_id),
            check=False,
        )

    async def _run_tmux(
        self, *args: str, check: bool = True
    ) -> subprocess.CompletedProcess[bytes]:
        env = dict(os.environ)
        env.pop("TMUX", None)
        try:
            result = await anyio.run_process(
                ["tmux", "-S", str(self._config.tmux_socket), *args],
                env=env,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except FileNotFoundError as exc:
            raise ShellctlServerError(
                500, "tmux_not_installed", "tmux executable was not found"
            ) from exc
        if check and result.returncode != 0:
            raise ShellctlServerError(
                500,
                "tmux_error",
                result.stderr.decode("utf-8", errors="replace").strip()
                or "tmux command failed",
            )
        return result

    @staticmethod
    def _shell_join(parts: tuple[str, ...] | list[str]) -> str:
        return " ".join(shlex.quote(part) for part in parts)


def _tmux_target_missing(stderr: str) -> bool:
    normalized = stderr.lower()
    return (
        "can't find pane" in normalized
        or "can't find session" in normalized
        or "no server running" in normalized
        or "failed to connect" in normalized
        or "server exited unexpectedly" in normalized
    )


__all__ = [
    "TmuxController",
    "TmuxControllerProtocol",
    "_tmux_target_missing",
]
