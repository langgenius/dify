"""Process-local lease cancellation shared by the owner and GraphEngine worker."""

from threading import Lock
from time import monotonic

from graphon.runtime.graph_runtime_state import GraphExecutionProtocol
from services.errors.workflow_service import WorkflowDebugReservationExpiredError

LEASE_EXPIRED_MESSAGE = "Trigger debug worker lease expired"


class DebugExecutionCancellation:
    def __init__(self, *, deadline: float) -> None:
        self._deadline = deadline
        self._lock = Lock()
        self._execution: GraphExecutionProtocol | None = None
        self._cancelled = False
        self._finished = False

    def _settled(self) -> bool:
        return self._finished or (self._execution is not None and (self._execution.completed or self._execution.paused))

    def _cancel(self) -> None:
        if self._settled():
            return
        self._cancelled = True
        if self._execution is not None:
            # The same flag is observed by GraphEngine scheduling and Agent SSE
            # consumption, which cancels the remote Agent run cooperatively.
            self._execution.abort(LEASE_EXPIRED_MESSAGE)

    def cancel(self) -> None:
        with self._lock:
            self._cancel()

    def is_cancelled(self) -> bool:
        with self._lock:
            if monotonic() >= self._deadline:
                self._cancel()
            return self._cancelled

    def seconds_until_expiry(self) -> float | None:
        """Return the next deadline, or None when no active execution remains."""
        with self._lock:
            if self._cancelled or self._settled():
                return None
            return max(0.0, self._deadline - monotonic())

    def renew_until(self, deadline: float) -> None:
        with self._lock:
            # A blocked renewal cannot grant time after the old lease expired.
            if monotonic() >= self._deadline:
                self._cancel()
            if not self._cancelled:
                self._deadline = deadline

    def bind(self, execution: GraphExecutionProtocol) -> None:
        with self._lock:
            self._execution = execution
            if self._cancelled or monotonic() >= self._deadline:
                self._cancel()
        self.raise_if_cancelled()

    def finish(self) -> None:
        with self._lock:
            self._finished = True

    def raise_if_cancelled(self) -> None:
        if self.is_cancelled():
            raise WorkflowDebugReservationExpiredError(LEASE_EXPIRED_MESSAGE)
