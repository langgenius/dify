"""Keep Classic execution/persistence alive independently of HTTP delivery."""

import contextvars
import logging
from collections.abc import Callable, Generator
from dataclasses import dataclass
from queue import Empty, Full, Queue
from threading import Event, Thread
from typing import cast

from flask import Flask, Response, after_this_request, current_app, has_request_context
from werkzeug.local import LocalProxy

from libs.flask_utils import preserve_flask_contexts

logger = logging.getLogger(__name__)
EXECUTION_OUTPUT_BUFFER_SIZE = 64


@dataclass(frozen=True)
class _Failure:
    error: Exception


class _End:
    pass


def execution_owned_stream[T](
    source: Generator[T],
    *,
    on_finished: Callable[[], None],
    on_failed: Callable[[Exception], None],
) -> Generator[T]:
    """Run one execution consumer; HTTP close only detaches its bounded output.

    The consumer owns source exhaustion, error handling and final persistence.
    It continues draining after a client disconnects, dropping delivery frames
    instead of retaining them or cancelling the execution.
    """
    flask_app = cast(LocalProxy[Flask], current_app)._get_current_object()
    context = contextvars.copy_context()
    delivery: Queue[T | _Failure | _End] = Queue(maxsize=EXECUTION_OUTPUT_BUFFER_SIZE)
    detached = Event()

    def detach() -> None:
        detached.set()
        while True:
            try:
                delivery.get_nowait()
            except Empty:
                break

    if has_request_context():
        # Response converters add several lazy generators. Closing an unstarted
        # outer generator need not close its inner iterator. Bind detachment to
        # the real HTTP response as well, without touching execution cancellation.
        @after_this_request
        def bind_http_close(response: Response) -> Response:
            response.call_on_close(detach)
            return response

    def deliver(item: T | _Failure | _End) -> None:
        while not detached.is_set():
            try:
                delivery.put(item, timeout=0.1)
                return
            except Full:
                continue

    def consume_execution() -> None:
        with preserve_flask_contexts(flask_app, context_vars=context):
            try:
                for item in source:
                    deliver(item)
            except Exception as error:
                try:
                    on_failed(error)
                except Exception:
                    logger.error("Failed to report Classic execution consumer failure")  # noqa: TRY400 - no upstream payload
                deliver(_Failure(error))
            finally:
                try:
                    source.close()
                finally:
                    on_finished()
                    deliver(_End())

    def listen() -> Generator[T]:
        try:
            # Arm cleanup before returning, including close-before-first-read.
            # This private marker is consumed below and is never delivered.
            yield cast(T, None)
            while True:
                item = delivery.get()
                if isinstance(item, _End):
                    return
                if isinstance(item, _Failure):
                    raise item.error
                yield item
        finally:
            detach()

    listener = listen()
    next(listener)
    try:
        Thread(target=consume_execution, name="classic-message-execution", daemon=True).start()
    except Exception:
        listener.close()
        source.close()
        on_finished()
        raise
    return listener
