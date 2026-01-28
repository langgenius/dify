"""
CommandFuture: Async command execution with gevent compatibility.

This module uses gevent primitives (greenlets, events) instead of native threads
to ensure proper cooperative scheduling in gevent-based WSGI servers like Gunicorn.

Using native threading.Thread or concurrent.futures.ThreadPoolExecutor in a gevent
environment can cause deadlocks because:
1. Native threads hold the GIL during blocking I/O
2. gevent's monkey-patching doesn't affect code running in native threads
3. Blocking operations in native threads prevent greenlet switching

By using gevent.spawn() and gevent.event.Event, all I/O operations become
cooperative, allowing proper greenlet scheduling even during blocking reads.
"""

import contextlib
import logging
from collections.abc import Callable
from typing import Any

import gevent
from gevent.event import Event

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
    Lightweight future for command execution using gevent greenlets.

    This implementation uses gevent primitives instead of native threads to ensure
    proper cooperative scheduling in gevent-based WSGI servers. All blocking I/O
    operations are performed in greenlets, allowing gevent to switch between them.

    Mirrors concurrent.futures.Future API with 4 essential methods:
    result(), done(), cancel(), cancelled().
    """

    def __init__(
        self,
        pid: str,
        stdin_transport: TransportWriteCloser,
        stdout_transport: TransportReadCloser,
        stderr_transport: TransportReadCloser,
        poll_status: Callable[[], CommandStatus],
        poll_interval: float = 0.1,
    ):
        self._pid = pid
        self._stdin_transport = stdin_transport
        self._stdout_transport = stdout_transport
        self._stderr_transport = stderr_transport
        self._poll_status = poll_status
        self._poll_interval = poll_interval

        self._done_event: Event = Event()  # gevent Event for cooperative waiting
        self._result: CommandResult | None = None
        self._exception: BaseException | None = None
        self._cancelled: bool = False
        self._started: bool = False
        self._execute_greenlet: Any = None

    def result(self, timeout: float | None = None) -> CommandResult:
        """
        Block until command completes and return result.

        Uses gevent.event.Event.wait() for cooperative waiting, allowing other
        greenlets to run while this one waits.

        Args:
            timeout: Maximum seconds to wait. None means wait forever.

        Raises:
            CommandTimeoutError: If timeout exceeded.
            CommandCancelledError: If command was cancelled.
        """
        self._ensure_started()

        # gevent Event.wait() returns True if set, False on timeout
        if not self._done_event.wait(timeout):
            raise CommandTimeoutError(f"Command timed out after {timeout}s")

        if self._cancelled:
            raise CommandCancelledError("Command was cancelled")

        if self._exception is not None:
            raise self._exception

        assert self._result is not None
        return self._result

    def done(self) -> bool:
        self._ensure_started()
        return self._done_event.is_set()

    def cancel(self) -> bool:
        """
        Attempt to cancel command by closing transports and killing greenlets.
        Returns True if cancelled, False if already completed.
        """
        if self._done_event.is_set():
            return False
        self._cancelled = True
        self._close_transports()
        # Kill the execute greenlet if it's still running
        if self._execute_greenlet is not None:
            self._execute_greenlet.kill(block=False)
        self._done_event.set()
        return True

    def cancelled(self) -> bool:
        return self._cancelled

    def _ensure_started(self) -> None:
        if not self._started:
            self._started = True
            # Use gevent.spawn instead of threading.Thread for cooperative scheduling
            self._execute_greenlet = gevent.spawn(self._execute)

    def _execute(self) -> None:
        """
        Execute command and collect output using gevent greenlets.

        Spawns separate greenlets for stdout/stderr draining to allow concurrent
        reading while polling for command completion.
        """
        stdout_buf = bytearray()
        stderr_buf = bytearray()
        is_combined_stream = self._stdout_transport is self._stderr_transport

        stdout_greenlet: Any = None
        stderr_greenlet: Any = None

        try:
            # Spawn greenlets for draining transports
            stdout_greenlet = gevent.spawn(self._drain_transport, self._stdout_transport, stdout_buf)
            if not is_combined_stream:
                stderr_greenlet = gevent.spawn(self._drain_transport, self._stderr_transport, stderr_buf)

            exit_code = self._wait_for_completion()

            # Wait for drain greenlets to complete
            stdout_greenlet.join()
            if stderr_greenlet is not None:
                stderr_greenlet.join()

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
            if not self._cancelled:
                self._exception = e
                self._done_event.set()
        finally:
            # Kill any remaining greenlets
            if stdout_greenlet is not None:
                stdout_greenlet.kill(block=False)
            if stderr_greenlet is not None:
                stderr_greenlet.kill(block=False)
            self._close_transports()

    def _wait_for_completion(self) -> int | None:
        """
        Poll for command completion using gevent.sleep for cooperative yielding.
        """
        while not self._cancelled:
            try:
                status = self._poll_status()
            except NotSupportedOperationError:
                return None

            if status.status == CommandStatus.Status.COMPLETED:
                return status.exit_code

            # Use gevent.sleep for cooperative scheduling
            gevent.sleep(self._poll_interval)

        return None

    def _drain_transport(self, transport: TransportReadCloser, buffer: bytearray) -> None:
        """
        Drain all data from a transport into a buffer.

        This runs in a greenlet, so blocking reads will yield to other greenlets
        thanks to gevent's monkey-patching of socket operations.
        """
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
