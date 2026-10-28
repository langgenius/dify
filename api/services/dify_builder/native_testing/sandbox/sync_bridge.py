"""One retained Python 3.13 native handle and bounded origin-worker mailbox.

Only the originating worker services callbacks. A timed-out handle stays retained;
refresh_join observes actual exit without requiring that worker's gevent hub.
No native callback may access Flask, SQL, Graphon or host locks directly.
"""

from __future__ import annotations

import asyncio
import selectors
from collections.abc import Callable, Coroutine
from contextlib import suppress
from dataclasses import dataclass
from math import isfinite
from time import monotonic, sleep
from typing import Any, cast

from gevent.monkey import get_original

_NATIVE_LOCK = get_original("_thread", "allocate_lock")
_NATIVE_IDENT = get_original("_thread", "get_ident")
_NATIVE_SLEEP = get_original("time", "sleep")
_NATIVE_SELECT = get_original("select", "select")
_NATIVE_SOCKETPAIR = get_original("_socket", "socketpair")


class _Selector(selectors.SelectSelector):
    _select = staticmethod(_NATIVE_SELECT)


class _Loop(asyncio.SelectorEventLoop):
    def __init__(self):
        super().__init__(selector=_Selector())

    def _make_self_pipe(self):
        # socket.socketpair's Python wrapper resolves a monkey-patched global
        # socket class. The original C factory avoids that implicit hub entry.
        self._ssock, self._csock = _NATIVE_SOCKETPAIR()
        self._ssock.setblocking(False)
        self._csock.setblocking(False)
        # CPython 3.13 private selector internals; pinned-process witness required.
        cast(Any, self)._internal_fds += 1
        cast(Any, self)._add_reader(self._ssock.fileno(), cast(Any, self)._read_from_self)


class _MailboxBusyError(Exception):
    pass


@dataclass(slots=True)
class _Message:
    kind: str
    payload: object
    deadline: float
    settlement: bool
    done: bool = False
    value: object = None
    error: BaseException | None = None


class NativeCodeLoopBridge:
    """Single-use bridge; construction does not start work or grant authority."""

    def __init__(
        self,
        *,
        deadline: float,
        close_deadline: float,
        service: Callable[[str, object], object],
        create_deadline: float | None = None,
        execution_seconds: float | None = None,
        join_deadline: float | None = None,
        join_seconds: float = 0,
        settlement_seconds: float | None = None,
    ):
        if not all(isfinite(x) for x in (deadline, close_deadline)) or close_deadline < deadline:
            raise ValueError("native_code_budget_invalid")
        self.deadline, self.close_deadline = deadline, close_deadline
        # The legacy standalone mailbox has no phase profile. Actual Code hosts
        # always supply every phase and required positive create/join budgets.
        self.create_deadline = deadline if create_deadline is None else create_deadline
        self.join_deadline = close_deadline if join_deadline is None else join_deadline
        self.execution_seconds = execution_seconds
        self.join_seconds = join_seconds
        self.settlement_seconds = settlement_seconds
        if (
            not all(isfinite(x) for x in (self.create_deadline, self.join_deadline, join_seconds))
            or not self.create_deadline <= deadline <= close_deadline <= self.join_deadline
            or join_seconds < 0
            or any(x is not None and (not isfinite(x) or x <= 0) for x in (execution_seconds, settlement_seconds))
        ):
            raise ValueError("native_code_budget_invalid")
        self._created = False
        self._service = service
        self._origin = _NATIVE_IDENT()
        self._lock = _NATIVE_LOCK()
        self._message: _Message | None = None
        self._started = False
        self._handle = get_original("_thread", "_ThreadHandle")()
        self._start = get_original("_thread", "start_joinable_thread")
        self._result: str | None = None
        self._error: BaseException | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._loop_closed = False
        self._joined = False
        self._cancelled = False
        self._finished = False

    @property
    def joined(self) -> bool:
        return self._joined

    @property
    def loop_closed(self) -> bool:
        return self._loop_closed

    @property
    def cancelled(self) -> bool:
        with self._lock:
            return self._cancelled

    def cancel(self, *, deadline: float | None = None) -> None:
        with self._lock:
            self._cancelled = True
            if deadline is not None:
                self.close_deadline = min(self.close_deadline, deadline - self.join_seconds)
                self.join_deadline = min(self.join_deadline, deadline)

    def created(self):
        with self._lock:
            if monotonic() >= self.create_deadline:
                raise ValueError("native_code_create_expired")
            if not self._created:
                self._created = True
                if self.execution_seconds is not None:
                    self.deadline = min(self.deadline, monotonic() + self.execution_seconds)

    def begin_settlement(self):
        with self._lock:
            if self.settlement_seconds is not None:
                self.close_deadline = min(self.close_deadline, monotonic() + self.settlement_seconds)

    def begin_join(self):
        with self._lock:
            if self.join_seconds:
                self.join_deadline = min(self.join_deadline, monotonic() + self.join_seconds)

    def _enqueue(self, kind: str, payload: object, settlement: bool) -> _Message:
        with self._lock:
            deadline = self.close_deadline if settlement else self.deadline
            if not settlement and not self._created:
                deadline = min(deadline, self.create_deadline)
            if monotonic() >= deadline or (self._cancelled and not settlement):
                raise ValueError("native_code_mailbox_unavailable")
            if self._message is not None:
                raise _MailboxBusyError
            message = _Message(kind, payload, deadline, settlement)
            self._message = message
            return message

    def _response(self, message: _Message) -> tuple[bool, object]:
        with self._lock:
            if monotonic() >= message.deadline or (self._cancelled and not message.settlement):
                raise ValueError("native_code_mailbox_expired")
            if not message.done:
                return False, None
            if message.error is not None:
                raise ValueError("native_code_origin_refused") from None
            return True, message.value

    def call(self, kind: str, payload: object, *, settlement: bool = False) -> Any:
        while True:
            try:
                message = self._enqueue(kind, payload, settlement)
                break
            except _MailboxBusyError:
                _NATIVE_SLEEP(0.001)
        while True:
            done, value = self._response(message)
            if done:
                return value
            _NATIVE_SLEEP(0.001)

    async def request(self, kind: str, payload: object, *, settlement: bool = False) -> Any:
        while True:
            try:
                message = self._enqueue(kind, payload, settlement)
                break
            except _MailboxBusyError:
                await asyncio.sleep(0.001)
        while True:
            done, value = self._response(message)
            if done:
                return value
            await asyncio.sleep(0.001)

    def _pump(self) -> None:
        if _NATIVE_IDENT() != self._origin:
            raise ValueError("native_code_origin_required")
        with self._lock:
            message = self._message
            if message is None or message.done:
                return
            refused = monotonic() >= message.deadline or (self._cancelled and not message.settlement)
        # SQL/HTTP and host checks never run under this mutex.
        try:
            if refused:
                raise ValueError("native_code_request_expired")
            value = self._service(message.kind, message.payload)
        except BaseException as error:  # Transport only error handoff, never success.
            with self._lock:
                message.error = error
        else:
            with self._lock:
                message.value = value
        finally:
            with self._lock:
                message.done = True
                if self._message is message:
                    self._message = None

    async def _main(self, operation):
        main = asyncio.create_task(operation())

        async def watch():
            while not main.done():
                if self.cancelled or monotonic() >= self.deadline:
                    self.cancel()
                    main.cancel()
                    return  # Never repeatedly cancel the adapter cleanup task.
                await asyncio.sleep(0.001)

        watcher = asyncio.create_task(watch())
        try:
            return await main
        finally:
            self.begin_join()
            watcher.cancel()
            with suppress(asyncio.CancelledError):
                await watcher

    def _work(self, operation) -> None:
        try:
            with asyncio.Runner(loop_factory=_Loop) as runner:
                self._loop = runner.get_loop()
                self._result = runner.run(self._main(operation))
        except BaseException as error:  # Transport only error handoff, never success.
            self._error = error
        finally:
            self._loop_closed = self._loop is not None and self._loop.is_closed()
            self._finished = True

    def refresh_join(self) -> None:
        # Nonblocking exact native handle observation, safe after origin exit.
        if self._started and self._handle.is_done():
            self._handle.join(0)
            self._joined = True

    def run(self, operation: Callable[[], Coroutine[Any, Any, str]]) -> str:
        if self._started or _NATIVE_IDENT() != self._origin or monotonic() >= self.deadline:
            raise ValueError("native_code_start_refused")
        self._started = True
        self._start(lambda: self._work(operation), handle=self._handle, daemon=False)
        try:
            while True:
                self._pump()
                self.refresh_join()
                if self.joined:
                    break
                if monotonic() >= self.deadline:
                    self.cancel()
                if monotonic() >= self.join_deadline:
                    raise ValueError("native_code_work_retained")
                sleep(0.001)  # Origin gevent worker yields; native thread uses originals.
        except BaseException:
            self.cancel()
            while monotonic() < self.join_deadline:
                self._pump()
                self.refresh_join()
                if self.joined:
                    break
                sleep(0.001)
            raise
        if self.cancelled or self._error is not None or not self.loop_closed or not isinstance(self._result, str):
            raise ValueError("native_code_execution_unknown")
        return self._result
