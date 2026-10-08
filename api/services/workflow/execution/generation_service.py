"""Own the execution worker until its response has been consumed or closed."""

import logging
from collections.abc import Callable, Generator
from typing import Protocol

logger = logging.getLogger(__name__)
WORKER_JOIN_TIMEOUT_SECONDS = 300


class ExecutionWorker(Protocol):
    @property
    def name(self) -> str: ...
    def start(self) -> None: ...
    def join(self, timeout: float | None = None) -> None: ...
    def is_alive(self) -> bool: ...


def join_worker(worker: ExecutionWorker) -> None:
    worker.join(timeout=WORKER_JOIN_TIMEOUT_SECONDS)
    if worker.is_alive():
        logger.warning("Workflow worker %s did not stop within %s seconds", worker.name, WORKER_JOIN_TIMEOUT_SECONDS)


def consume_stream[EventT](
    stream: Generator[EventT, None, None], worker: ExecutionWorker
) -> Generator[EventT, None, None]:
    try:
        yield from stream
    finally:
        join_worker(worker)


def generate_response[ResponseT, EventT](
    *, worker: ExecutionWorker, respond: Callable[[], ResponseT | Generator[EventT, None, None]]
) -> ResponseT | Generator[EventT, None, None]:
    """Start execution, receive its result, and close ownership on every exit path."""
    worker.start()
    try:
        response = respond()
    except BaseException:
        join_worker(worker)
        raise
    if isinstance(response, Generator):
        return consume_stream(response, worker)
    join_worker(worker)
    return response
