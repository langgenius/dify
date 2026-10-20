"""Transfer a trigger-debug reservation from the response stream to its worker."""

from collections.abc import Callable, Generator
from threading import Lock


class WorkflowStreamReservation:
    def __init__(self, cancel: Callable[[], None]) -> None:
        self._cancel = cancel
        self._enqueued = False
        self._closed = False
        self._lock = Lock()

    def enqueue(self, start: Callable[[], None]) -> None:
        # Serialize closing with dispatch: once the broker accepts the task, only
        # the worker may finish its reservation, even if the client disconnects.
        with self._lock:
            if self._closed:
                raise RuntimeError("Trigger debug stream is closed")
            if not self._enqueued:
                start()
                self._enqueued = True

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            cancel = not self._enqueued
        if cancel:
            self._cancel()

    def wrap(self, stream: Generator[str, None, None]) -> Generator[str, None, None]:
        def events() -> Generator[str, None, None]:
            try:
                # Prime the cleanup scope without consuming the transport. Python
                # otherwise skips finally when closing a never-started generator.
                yield ""
                yield from stream
            finally:
                try:
                    stream.close()
                finally:
                    self.close()

        result = events()
        next(result)
        return result
