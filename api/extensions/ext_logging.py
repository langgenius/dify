import logging
import os
import sys
import uuid
from logging.handlers import RotatingFileHandler

import flask

from configs import dify_config
from core.helper.trace_id_helper import get_trace_id_from_otel_context
from dify_app import DifyApp


def init_app(app: DifyApp):
    log_handlers: list[logging.Handler] = []
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

    # Always add StreamHandler to log to console
    sh = logging.StreamHandler(sys.stdout)
    log_handlers.append(sh)

    # Apply RequestIdFilter to all handlers
    for handler in log_handlers:
        handler.addFilter(RequestIdFilter())

    logging.basicConfig(
        level=dify_config.LOG_LEVEL,
        format=dify_config.LOG_FORMAT,
        datefmt=dify_config.LOG_DATEFORMAT,
        handlers=log_handlers,
        force=True,
    )

    # Apply RequestIdFormatter to all handlers
    apply_request_id_formatter()

    # Disable propagation for noisy loggers to avoid duplicate logs
    logging.getLogger("sqlalchemy.engine").propagate = False
    log_tz = dify_config.LOG_TZ
    if log_tz:
        from datetime import datetime

        import pytz

        timezone = pytz.timezone(log_tz)

        def time_converter(seconds):
            return datetime.fromtimestamp(seconds, tz=timezone).timetuple()

        for handler in logging.root.handlers:
            if handler.formatter:
                handler.formatter.converter = time_converter


def get_request_id():
    if getattr(flask.g, "request_id", None):
        return flask.g.request_id

    new_uuid = uuid.uuid4().hex[:10]
    flask.g.request_id = new_uuid

    return new_uuid


class RequestIdFilter(logging.Filter):
    # This is a logging filter that makes the request ID available for use in
    # the logging format. Note that we're checking if we're in a request
    # context, as we may want to log things before Flask is fully loaded.
    def filter(self, record):
        trace_id = get_trace_id_from_otel_context() or ""
        record.req_id = get_request_id() if flask.has_request_context() else ""
        record.trace_id = trace_id
        return True


class RequestIdFormatter(logging.Formatter):
    def format(self, record):
        if not hasattr(record, "req_id"):
            record.req_id = ""
        if not hasattr(record, "trace_id"):
            record.trace_id = ""
        return super().format(record)


def apply_request_id_formatter():
    for handler in logging.root.handlers:
        if handler.formatter:
            handler.formatter = RequestIdFormatter(dify_config.LOG_FORMAT, dify_config.LOG_DATEFORMAT)
