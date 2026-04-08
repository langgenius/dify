import contextlib
import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from core.virtual_environment.__base.entities import CommandResult, CommandStatus
from core.virtual_environment.__base.exec import NotSupportedOperationError
from core.virtual_environment.channel.exec import TransportEOFError
from core.virtual_environment.channel.transport import TransportReadCloser, TransportWriteCloser

logger = logging.getLogger(__name__)


class CommandTimeoutError(Exception):
    pass


class CommandCancelledError(Exception):
    pass


class CommandFuture:
    """
    Lightweight future for command execution.
    Mirrors concurrent.futures.Future API with 4 essential methods:
    result(), done(), cancel(), cancelled().

    When a command is cancelled or times out the future now asks the provider
    to terminate the underlying process/session before marking itself done.
    """

    def __init__(
        self,
        pid: str,
        stdin_transport: TransportWriteCloser,
        stdout_transport: TransportReadCloser,
        stderr_transport: TransportReadCloser,
        poll_status: Callable[[], CommandStatus],
        terminate_command: Callable[[], bool] | None = None,
        poll_interval: float = 0.1,
    ):
        self._pid = pid
        self._stdin_transport = stdin_transport
        self._stdout_transport = stdout_transport
        self._stderr_transport = stderr_transport
        self._poll_status = poll_status
        self._terminate_command = terminate_command
        self._poll_interval = poll_interval

        self._done_event = threading.Event()
        self._lock = threading.Lock()
        self._result: CommandResult | None = None
        self._exception: BaseException | None = None
        self._cancelled = False
        self._timed_out = False
        self._started = False
        self._termination_requested = False

    def result(self, timeout: float | None = None) -> CommandResult:
        """
        Block until command completes and return result.

        Args:
            timeout: Maximum seconds to wait. None means wait forever.

        Raises:
            CommandTimeoutError: If timeout exceeded.
            CommandCancelledError: If command was cancelled.

        A timeout is terminal for this future: it triggers best-effort command
        termination and subsequent ``result()`` calls keep raising timeout.
        """
        self._ensure_started()

        if not self._done_event.wait(timeout):
            self._request_stop(timed_out=True)
            raise CommandTimeoutError(f"Command timed out after {timeout}s")

        if self._cancelled:
            raise CommandCancelledError("Command was cancelled")

        if self._timed_out:
            raise CommandTimeoutError("Command timed out")

        if self._exception is not None:
            raise self._exception

        assert self._result is not None
        return self._result

    def done(self) -> bool:
        self._ensure_started()
        return self._done_event.is_set()

    def cancel(self) -> bool:
        """
        Attempt to cancel command by terminating it and closing transports.
        Returns True if cancelled, False if already completed.
        """
        return self._request_stop(cancelled=True)

    def cancelled(self) -> bool:
        return self._cancelled

    def _ensure_started(self) -> None:
        with self._lock:
            if not self._started:
                self._started = True
                thread = threading.Thread(target=self._execute, daemon=True)
                thread.start()

    def _request_stop(self, *, cancelled: bool = False, timed_out: bool = False) -> bool:
        should_terminate = False
        with self._lock:
            if self._done_event.is_set():
                return False

            if cancelled:
                self._cancelled = True
            if timed_out:
                self._timed_out = True

            should_terminate = not self._termination_requested
            if should_terminate:
                self._termination_requested = True

            self._close_transports()
            self._done_event.set()

        if should_terminate:
            self._terminate_running_command()
        return True

    def _execute(self) -> None:
        stdout_buf = bytearray()
        stderr_buf = bytearray()
        is_combined_stream = self._stdout_transport is self._stderr_transport

        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                stdout_future = executor.submit(self._drain_transport, self._stdout_transport, stdout_buf)
                stderr_future = None
                if not is_combined_stream:
                    stderr_future = executor.submit(self._drain_transport, self._stderr_transport, stderr_buf)

                exit_code = self._wait_for_completion()

                stdout_future.result()
                if stderr_future:
                    stderr_future.result()

            with self._lock:
                if not self._cancelled:
                    self._result = CommandResult(
                        stdout=bytes(stdout_buf),
                        stderr=b"" if is_combined_stream else bytes(stderr_buf),
                        exit_code=exit_code,
                        pid=self._pid,
                    )
                    self._done_event.set()

        except Exception as e:
            logger.exception("Command execution failed for pid %s", self._pid)
            with self._lock:
                if not self._cancelled:
                    self._exception = e
                    self._done_event.set()
        finally:
            self._close_transports()

    def _wait_for_completion(self) -> int | None:
        while not self._cancelled and not self._timed_out:
            try:
                status = self._poll_status()
            except NotSupportedOperationError:
                return None

            if status.status == CommandStatus.Status.COMPLETED:
                return status.exit_code

            time.sleep(self._poll_interval)

        return None

    def _drain_transport(self, transport: TransportReadCloser, buffer: bytearray) -> None:
        try:
            while True:
                buffer.extend(transport.read(4096))
        except TransportEOFError:
            pass
        except Exception:
            logger.exception("Failed reading transport")

    def _close_transports(self) -> None:
        for transport in (self._stdin_transport, self._stdout_transport, self._stderr_transport):
            with contextlib.suppress(Exception):
                transport.close()

    def _terminate_running_command(self) -> None:
        if self._terminate_command is None:
            return

        try:
            self._terminate_command()
        except Exception:
            logger.exception("Failed to terminate command for pid %s", self._pid)
