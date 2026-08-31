"""Process-local memory admission for buffered KnowledgeFS uploads."""

from __future__ import annotations

from collections import deque
from collections.abc import Generator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from threading import Condition
from typing import Protocol


@dataclass(frozen=True, slots=True)
class KnowledgeFSBufferedUploadAdmissionSnapshot:
    """Current process-local capacity usage for diagnostics and tests."""

    active_count: int
    reserved_bytes: int
    pending_count: int


class KnowledgeFSBufferedUploadAdmissionPort(Protocol):
    def admit(self, *, reserved_bytes: int) -> AbstractContextManager[None]: ...


class KnowledgeFSBufferedUploadAdmission:
    """FIFO dual-budget gate held for the full lifetime of a buffered upload.

    The reservation uses the operation's maximum body size rather than the
    eventual payload length because capacity must be granted before reading the
    request stream into memory. A request whose configured per-file limit is
    larger than the aggregate budget is admitted only when it can run alone;
    otherwise a valid paid-plan limit could wait forever or fail before read.
    """

    def __init__(self, *, max_concurrency: int, max_reserved_bytes: int) -> None:
        if max_concurrency <= 0:
            raise ValueError("max_concurrency must be greater than zero")
        if max_reserved_bytes <= 0:
            raise ValueError("max_reserved_bytes must be greater than zero")
        self._max_concurrency = max_concurrency
        self._max_reserved_bytes = max_reserved_bytes
        self._condition = Condition()
        self._waiters: deque[object] = deque()
        self._active_count = 0
        self._reserved_bytes = 0

    @contextmanager
    def admit(self, *, reserved_bytes: int) -> Generator[None, None, None]:
        if reserved_bytes <= 0:
            raise ValueError("reserved_bytes must be greater than zero")

        waiter = object()
        with self._condition:
            self._waiters.append(waiter)
            try:
                while not self._can_admit(waiter=waiter, reserved_bytes=reserved_bytes):
                    self._condition.wait()
            except BaseException:
                self._remove_waiter(waiter)
                self._condition.notify_all()
                raise
            popped = self._waiters.popleft()
            if popped is not waiter:  # pragma: no cover - guarded by _can_admit
                raise RuntimeError("buffered upload admission queue is inconsistent")
            self._active_count += 1
            self._reserved_bytes += reserved_bytes
            self._condition.notify_all()

        try:
            yield
        finally:
            with self._condition:
                self._active_count -= 1
                self._reserved_bytes -= reserved_bytes
                self._condition.notify_all()

    def snapshot(self) -> KnowledgeFSBufferedUploadAdmissionSnapshot:
        with self._condition:
            return KnowledgeFSBufferedUploadAdmissionSnapshot(
                active_count=self._active_count,
                reserved_bytes=self._reserved_bytes,
                pending_count=len(self._waiters),
            )

    def _can_admit(self, *, waiter: object, reserved_bytes: int) -> bool:
        has_fifo_turn = bool(self._waiters) and self._waiters[0] is waiter
        if reserved_bytes > self._max_reserved_bytes:
            return has_fifo_turn and self._active_count == 0 and self._reserved_bytes == 0
        return (
            has_fifo_turn
            and self._active_count < self._max_concurrency
            and self._reserved_bytes + reserved_bytes <= self._max_reserved_bytes
        )

    def _remove_waiter(self, waiter: object) -> None:
        try:
            self._waiters.remove(waiter)
        except ValueError:
            pass


DEFAULT_KNOWLEDGE_FS_BUFFERED_UPLOAD_ADMISSION = KnowledgeFSBufferedUploadAdmission(
    max_concurrency=2,
    max_reserved_bytes=30 * 1024 * 1024,
)


__all__ = [
    "DEFAULT_KNOWLEDGE_FS_BUFFERED_UPLOAD_ADMISSION",
    "KnowledgeFSBufferedUploadAdmission",
    "KnowledgeFSBufferedUploadAdmissionPort",
    "KnowledgeFSBufferedUploadAdmissionSnapshot",
]
