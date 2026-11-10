"""Narrow logging records whose ``exc_info`` may be a tuple or ``False``."""

from __future__ import annotations

from logging import LogRecord


def logged_exception(record: LogRecord) -> BaseException | None:
    """Return the exception stored on a log record.

    Preconditions: ``record`` is a logging ``LogRecord``.
    Postconditions: return the attached exception when ``exc_info`` is a tuple
    holding one. ``False``, ``None``, and tuples without an exception return
    ``None`` and are not subscripted.
    """

    exc_info = record.exc_info
    if not isinstance(exc_info, tuple):
        return None
    exception = exc_info[1]
    if isinstance(exception, BaseException):
        return exception
    return None
