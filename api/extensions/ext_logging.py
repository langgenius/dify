"""Logging extension for Dify Flask application."""

import logging
import os
import sys
from logging.handlers import RotatingFileHandler

from configs import dify_config
from dify_app import DifyApp


def init_app(app: DifyApp):
    """Initialize logging with support for text or JSON format."""
    log_handlers: list[logging.Handler] = []

    # File handler
    log_file = dify_config.LOG_FILE
    if log_file:
        log_dir = os.path.dirname(log_file)
        os.makedirs(log_dir, exist_ok=True)
        log_handlers.append(
            RotatingFileHandler(
                filename=log_file,
                maxBytes=dify_config.LOG_FILE_MAX_SIZE * 1024 * 1024,
                backupCount=dify_config.LOG_FILE_BACKUP_COUNT,
            )
        )

    # Console handler
    sh = logging.StreamHandler(sys.stdout)
    log_handlers.append(sh)

    # Apply filters to all handlers
    from core.logging.filters import IdentityContextFilter, TraceContextFilter

    for handler in log_handlers:
        handler.addFilter(TraceContextFilter())
        handler.addFilter(IdentityContextFilter())

    # Configure formatter based on format type
    formatter = _create_formatter()
    for handler in log_handlers:
        handler.setFormatter(formatter)

    # Configure root logger
    logging.basicConfig(
        level=dify_config.LOG_LEVEL,
        handlers=log_handlers,
        force=True,
    )

    # Disable propagation for noisy loggers to avoid duplicate logs
    logging.getLogger("sqlalchemy.engine").propagate = False

    # Apply timezone if specified (only for text format)
    if dify_config.LOG_OUTPUT_FORMAT == "text":
        _apply_timezone(log_handlers)


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

    def filter(self, record: logging.LogRecord) -> bool:
        from core.logging.context import get_request_id as _get_request_id
        from core.logging.context import get_trace_id as _get_trace_id

        record.req_id = _get_request_id()
        record.trace_id = _get_trace_id()
        return True


class RequestIdFormatter(logging.Formatter):
    """Deprecated: Use _TextFormatter instead."""

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
