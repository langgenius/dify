"""Bounded context/Thread protection for Dify's application logs during sensitive IO.

Logging owners install the filter once at initialization. The guard never changes
global logging or instrumentation configuration. It covers the registered Dify
handlers and supported OpenTelemetry auto-instrumentation, not arbitrary SDKs,
operator handlers, or concurrent logging reconfiguration. Callers must translate
raw transport exceptions before they escape an enclosing manual tracing span.
"""

import logging
from collections.abc import Generator
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Lock, Thread, current_thread
from typing import override

from opentelemetry.instrumentation.utils import suppress_instrumentation

_sensitive_http: ContextVar[bool] = ContextVar("dify_sensitive_http_telemetry", default=False)
_HTTP_LOGGERS = ("httpx", "httpcore", "core.helper.ssrf_proxy")
_thread_logs_lock = Lock()
_thread_logs: list[tuple[Thread, list["SensitiveThreadLogLease"]]] = []


class SensitiveThreadLogLease:
    """One logging-only owner of the actual calling Thread until physical exit.

    Capture never accepts a thread ID/name or caller-selected Thread. Multiple
    owners of one actual Thread remain distinct. Owners must retain this handle
    when work is unknown or still running; this grants no cleanup authority.
    """

    def __init__(self, *, additional_emitters: tuple[str, ...] = ()) -> None:
        assert_sensitive_http_telemetry_ready(additional_emitters=additional_emitters)
        self._thread = current_thread()
        self._released = False
        with _thread_logs_lock:
            for thread, owners in _thread_logs:
                if thread is self._thread:
                    owners.append(self)
                    break
            else:
                _thread_logs.append((self._thread, [self]))

    @property
    def thread(self) -> Thread:
        return self._thread

    def release_after_exit(self) -> None:
        """A live/current Thread never loses protection, even on repeated calls."""
        if current_thread() is self._thread or Thread.is_alive(self._thread):
            raise SensitiveHttpTelemetryUnavailable()
        with _thread_logs_lock:
            if self._released:
                return
            for index, (thread, owners) in enumerate(_thread_logs):
                if thread is self._thread:
                    for owner_index, owner in enumerate(owners):
                        if owner is self:
                            del owners[owner_index]
                            if not owners:
                                del _thread_logs[index]
                            self._released = True
                            return
            raise SensitiveHttpTelemetryUnavailable()


def protect_current_thread_logs(*, additional_emitters: tuple[str, ...] = ()) -> SensitiveThreadLogLease:
    """Readiness-checked capture of actual current Thread; no logger mutation."""
    return SensitiveThreadLogLease(additional_emitters=additional_emitters)


def _current_thread_protected() -> bool:
    actual = current_thread()
    with _thread_logs_lock:
        return any(thread is actual for thread, _owners in _thread_logs)


class SensitiveHttpTelemetryUnavailable(RuntimeError):  # noqa: N818 - shared HTTP boundary API
    """The application logging boundary is not ready for sensitive HTTP IO."""

    def __init__(self) -> None:
        super().__init__("Sensitive HTTP telemetry protection is unavailable")


class SensitiveHttpLogFilter(logging.Filter):
    """Drop scoped operation records before application sinks format or export them."""

    @override
    def filter(self, record: logging.LogRecord) -> bool:
        return not (_sensitive_http.get() or _current_thread_protected())


def _protected(handler: logging.Handler) -> bool:
    return any(type(item) is SensitiveHttpLogFilter for item in tuple(handler.filters))


def assert_sensitive_http_telemetry_ready(*, additional_emitters: tuple[str, ...] = ()) -> None:
    """Fail closed before authorization if existing HTTP logging can bypass filters.

    This read-only snapshot checks the current configuration; application owners
    must keep logging configuration stable during dispatch. New custom handlers
    and SDK exporters require their own admission review. A trusted caller may
    additionally qualify its surrounding logger routes; HTTP routes are always
    retained. The empty default preserves ordinary HTTP admission.
    """
    if type(additional_emitters) is not tuple or any(type(name) is not str or not name for name in additional_emitters):
        raise SensitiveHttpTelemetryUnavailable()
    emitters = _HTTP_LOGGERS + additional_emitters
    handlers = tuple(logging.getLogger().handlers)
    if not handlers or not all(_protected(handler) for handler in handlers):
        raise SensitiveHttpTelemetryUnavailable()

    # Copy before iteration: other threads may create loggers. Inspect existing
    # emitters, descendants and routing ancestors without creating any loggers.
    for name, logger in logging.Logger.manager.loggerDict.copy().items():
        if not isinstance(logger, logging.Logger):
            continue
        if not any(
            name == emitter or name.startswith(emitter + ".") or emitter.startswith(name + ".") for emitter in emitters
        ):
            continue
        if not logger.propagate or not all(_protected(handler) for handler in tuple(logger.handlers)):
            raise SensitiveHttpTelemetryUnavailable()


@contextmanager
def sensitive_http_telemetry(*, additional_emitters: tuple[str, ...] = ()) -> Generator[None]:
    """Guard only sensitive dispatch/read/close; recheck readiness at the IO edge.

    Use assert_sensitive_http_telemetry_ready before spending dispatch authority.
    Catch and translate raw transport exceptions inside this scope when an outer
    tracing owner might otherwise record them after exit. Nesting and all exit
    paths restore the prior context, including BaseException interruptions.
    Additional surrounding logger routes are rechecked at context entry too;
    supplying them neither installs filters nor changes logger configuration.
    """
    assert_sensitive_http_telemetry_ready(additional_emitters=additional_emitters)
    token = _sensitive_http.set(True)
    try:
        with suppress_instrumentation():
            yield
    finally:
        _sensitive_http.reset(token)
