"""Hide dynamic transport diagnostics only inside sensitive trace HTTP calls.

The Aliyun collector carries credentials in its path. Do not try to recognize
individual encodings of those credentials: replace dynamic content at the
standard Logger.makeRecord entry before any record factory or handler sees it.
The current record factory remains independently configurable. Other concurrent
requests retain their normal logging, levels and handlers. This does not defend
against arbitrary process code replacing the protected logging entry itself.
"""

import logging
from collections.abc import Callable, Generator
from contextlib import contextmanager
from contextvars import ContextVar
from threading import RLock

type RecordMaker = Callable[..., logging.LogRecord]

SAFE_HTTP_LOG_MESSAGE = "Sensitive tracing HTTP request; dynamic transport details redacted"
_sensitive_request: ContextVar[bool] = ContextVar("sensitive_trace_http_request", default=False)


def _protected_record_maker(previous: RecordMaker) -> RecordMaker:
    def create_record(
        self: logging.Logger,
        name: str,
        level: int,
        fn: str,
        lno: int,
        msg: object,
        args: object,
        exc_info: object,
        func: str | None = None,
        extra: object = None,
        sinfo: str | None = None,
    ) -> logging.LogRecord:
        if not _sensitive_request.get():
            return previous(self, name, level, fn, lno, msg, args, exc_info, func, extra, sinfo)
        # Sanitize before delegating, including extras, chained exceptions and
        # stack information. Never stringify the original diagnostic values.
        # The original makeRecord still invokes the dynamic current factory.
        record = previous(self, name, level, fn, lno, SAFE_HTTP_LOG_MESSAGE, (), None, func, None, None)
        record.msg = SAFE_HTTP_LOG_MESSAGE
        record.args = ()
        record.exc_info = None
        record.exc_text = None
        record.stack_info = None
        return record

    return create_record


class _RecordMakerLeases:
    def __init__(self) -> None:
        self.lock = RLock()
        self.users = 0
        self.previous: RecordMaker | None = None
        self.installed: RecordMaker | None = None

    def acquire(self) -> None:
        with self.lock:
            if self.users == 0:
                self.previous = logging.Logger.makeRecord
                self.installed = _protected_record_maker(self.previous)
                logging.Logger.makeRecord = self.installed
            self.users += 1

    def release(self) -> None:
        with self.lock:
            self.users -= 1
            if self.users == 0:
                # Preserve an independently installed method instead of
                # overwriting another logging integration during cleanup.
                if logging.Logger.makeRecord is self.installed and self.previous is not None:
                    logging.Logger.makeRecord = self.previous
                self.previous = None
                self.installed = None


_record_maker_leases = _RecordMakerLeases()


@contextmanager
def protect_http_request_logs(sensitive: bool) -> Generator[None]:
    """Scope protection to this call; nested public calls restore their parent."""
    token = _sensitive_request.set(sensitive)
    leased = False
    try:
        if sensitive:
            _record_maker_leases.acquire()
            leased = True
        yield
    finally:
        try:
            if leased:
                _record_maker_leases.release()
        finally:
            _sensitive_request.reset(token)
