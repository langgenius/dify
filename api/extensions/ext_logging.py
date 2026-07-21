"""Logging extension for Dify Flask application."""

import atexit
import contextlib
import logging
import os
import queue
import sys
import threading
from logging import LogRecord
from logging.handlers import QueueHandler, RotatingFileHandler
from typing import override

from configs import dify_config
from dify_app import DifyApp

# Keep the listener (and its thread) referenced for the process lifetime so it
# is never garbage-collected while the root logger still feeds its queue.
_log_listener: "_QueueLogListener | None" = None


def _spawn_real_thread(target, name: str) -> threading.Thread:
    """Start a **real OS thread**, even under gevent monkey-patching.

    gevent's ``monkey.patch_all()`` turns ``threading.Thread`` into a
    greenlet-backed thread. The logging queue listener below blocks on
    ``queue.SimpleQueue.get()`` -- a C-level call that is NOT cooperative -- so
    running it on a greenlet would freeze the whole gevent hub. We therefore
    resolve the original (unpatched) ``Thread`` and run the listener there.
    """
    # If gevent is unavailable or threading is unpatched, threading.Thread is
    # already a real OS thread and the suppressed block simply leaves it alone.
    thread_cls = threading.Thread
    with contextlib.suppress(Exception):
        from gevent import monkey

        if monkey.is_module_patched("threading"):
            thread_cls = monkey.get_original("threading", "Thread")
    t = thread_cls(target=target, name=name, daemon=True)
    t.start()
    return t


class _LockFreeQueueHandler(QueueHandler):
    """QueueHandler that enqueues records WITHOUT taking the handler lock.

    Under gevent monkey-patching a ``logging.Handler``'s lock is a gevent
    ``BoundedSemaphore``. ``Handler.handle()`` acquires it around ``emit()``;
    when a request greenlet is parked in that acquire and a gevent threadpool
    worker (a different hub) releases the semaphore, the cross-hub wakeup can be
    lost and the greenlet sleeps forever -- the request hangs (HTTP 200, empty
    body) with no error and no timeout.

    ``queue.SimpleQueue.put_nowait`` is a C-atomic, lock-free operation, so the
    handler lock is unnecessary here. We drop it entirely, which removes the
    contended semaphore from every request/greenlet's logging path.
    """

    @override
    def prepare(self, record: LogRecord) -> LogRecord:
        # Do NOT pre-format: the real formatter (e.g. StructuredJSONFormatter)
        # runs on the listener side and needs the untouched record/args. Context
        # filters already ran on this (request) side via Handler.filter().
        return record

    @override
    def handle(self, record: LogRecord) -> bool:
        rv = self.filter(record)
        if isinstance(rv, LogRecord):
            record = rv
        if rv:
            # No self.acquire()/self.release(): the SimpleQueue is thread-safe.
            self.emit(record)
        return bool(rv)


class _QueueLogListener:
    """Drains the log queue on a real OS thread and emits to the real handlers.

    We deliberately do not use ``logging.handlers.QueueListener``: it runs its
    drain loop on a ``threading.Thread``, which gevent's monkey-patching turns
    into a greenlet, and a greenlet blocking in ``SimpleQueue.get()`` would
    freeze the hub.
    """

    def __init__(self, log_queue: "queue.SimpleQueue[LogRecord | None]", handlers: list[logging.Handler]):
        self._queue = log_queue
        self._handlers = handlers
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = _spawn_real_thread(self._run, name="log-queue-listener")

    def _run(self) -> None:
        while True:
            record = self._queue.get()
            if record is None:  # sentinel from stop()
                break
            for handler in self._handlers:
                if record.levelno >= handler.level:
                    try:
                        handler.handle(record)
                    except Exception:
                        # A failing sink must never kill the listener thread.
                        handler.handleError(record)

    def stop(self) -> None:
        """Flush what is already queued, then stop the listener thread."""
        thread = self._thread
        if thread is None:
            return
        self._queue.put(None)
        thread.join(timeout=5)
        self._thread = None


def init_app(app: DifyApp):
    """Initialize logging with support for text or JSON format.

    All records flow through a lock-free ``SimpleQueue`` (see
    ``_LockFreeQueueHandler``) and are emitted by a single listener running on a
    real OS thread, so no request greenlet ever contends on a gevent semaphore
    inside the logging path.
    """
    # "Real" output handlers -- these run ONLY on the listener thread, so their
    # (gevent-semaphore) locks are never contended and cannot wedge anyone.
    output_handlers: list[logging.Handler] = []

    # File handler
    log_file = dify_config.LOG_FILE
    if log_file:
        log_dir = os.path.dirname(log_file)
        os.makedirs(log_dir, exist_ok=True)
        output_handlers.append(
            RotatingFileHandler(
                filename=log_file,
                maxBytes=dify_config.LOG_FILE_MAX_SIZE * 1024 * 1024,
                backupCount=dify_config.LOG_FILE_BACKUP_COUNT,
            )
        )

    # Console handler
    output_handlers.append(logging.StreamHandler(sys.stdout))

    # Formatter runs on the listener side.
    formatter = _create_formatter()
    for handler in output_handlers:
        handler.setFormatter(formatter)

    # The queue handler is the ONE handler installed on the root logger. Context
    # filters must run on the producing (request) side where request context is
    # available, so they live here -- and now run once per record instead of
    # once per output handler (previously the identity filter's end_users SELECT
    # ran twice: once for file, once for console).
    from core.logging.filters import IdentityContextFilter, TraceContextFilter

    log_queue: queue.SimpleQueue[LogRecord | None] = queue.SimpleQueue()
    queue_handler = _LockFreeQueueHandler(log_queue)
    queue_handler.addFilter(TraceContextFilter())
    queue_handler.addFilter(IdentityContextFilter())

    # (Re)start the listener that drains the queue into the real handlers.
    global _log_listener
    if _log_listener is not None:
        _log_listener.stop()
    _log_listener = _QueueLogListener(log_queue, output_handlers)
    _log_listener.start()
    atexit.register(_stop_listener)

    # Configure root logger with ONLY the queue handler.
    logging.basicConfig(
        level=dify_config.LOG_LEVEL,
        handlers=[queue_handler],
        force=True,
    )

    # Disable propagation for noisy loggers to avoid duplicate logs
    logging.getLogger("sqlalchemy.engine").propagate = False

    # Apply timezone if specified (only for text format)
    if dify_config.LOG_OUTPUT_FORMAT == "text":
        _apply_timezone(output_handlers)


def _stop_listener() -> None:
    """Flush and stop the queue listener at interpreter shutdown."""
    global _log_listener
    if _log_listener is not None:
        _log_listener.stop()
        _log_listener = None


def _create_formatter() -> logging.Formatter:
    """Create appropriate formatter based on configuration."""
    if dify_config.LOG_OUTPUT_FORMAT == "json":
        from core.logging.structured_formatter import StructuredJSONFormatter

        return StructuredJSONFormatter()
    else:
        # Text format - use existing pattern with backward compatible formatter
        return _TextFormatter(
            fmt=dify_config.LOG_FORMAT,
            datefmt=dify_config.LOG_DATEFORMAT,
        )


def _apply_timezone(handlers: list[logging.Handler]):
    """Apply timezone conversion to text formatters."""
    log_tz = dify_config.LOG_TZ
    if log_tz:
        from datetime import datetime

        import pytz

        timezone = pytz.timezone(log_tz)

        def time_converter(seconds):
            return datetime.fromtimestamp(seconds, tz=timezone).timetuple()

        for handler in handlers:
            if handler.formatter:
                handler.formatter.converter = time_converter  # type: ignore[attr-defined]


class _TextFormatter(logging.Formatter):
    """Text formatter that ensures trace_id and req_id are always present."""

    @override
    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, "req_id"):
            record.req_id = ""
        if not hasattr(record, "trace_id"):
            record.trace_id = ""
        if not hasattr(record, "span_id"):
            record.span_id = ""
        return super().format(record)


def get_request_id() -> str:
    """Get request ID for current request context.

    Deprecated: Use core.logging.context.get_request_id() directly.
    """
    from core.logging.context import get_request_id as _get_request_id

    return _get_request_id()


# Backward compatibility aliases
class RequestIdFilter(logging.Filter):
    """Deprecated: Use TraceContextFilter from core.logging.filters instead."""

    @override
    def filter(self, record: logging.LogRecord) -> bool:
        from core.logging.context import get_request_id as _get_request_id
        from core.logging.context import get_trace_id as _get_trace_id

        record.req_id = _get_request_id()
        record.trace_id = _get_trace_id()
        return True


class RequestIdFormatter(logging.Formatter):
    """Deprecated: Use _TextFormatter instead."""

    @override
    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, "req_id"):
            record.req_id = ""
        if not hasattr(record, "trace_id"):
            record.trace_id = ""
        return super().format(record)


def apply_request_id_formatter():
    """Deprecated: Formatter is now applied in init_app."""
    for handler in logging.root.handlers:
        if handler.formatter:
            handler.formatter = RequestIdFormatter(dify_config.LOG_FORMAT, dify_config.LOG_DATEFORMAT)
