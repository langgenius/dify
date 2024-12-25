import logging
import os
import sys
import uuid
from logging.handlers import RotatingFileHandler

import flask

from configs import dify_config
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
    sh.addFilter(RequestIdFilter())
    log_formatter = logging.Formatter(fmt=dify_config.LOG_FORMAT)
    sh.setFormatter(log_formatter)
    log_handlers.append(sh)

    logging.basicConfig(
        level=dify_config.LOG_LEVEL,
        datefmt=dify_config.LOG_DATEFORMAT,
        handlers=log_handlers,
        force=True,
    )
    log_tz = dify_config.LOG_TZ
    if log_tz:
        from datetime import datetime

        import pytz

        timezone = pytz.timezone(log_tz)

        def time_converter(seconds):
            return datetime.utcfromtimestamp(seconds).astimezone(timezone).timetuple()

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
        record.req_id = get_request_id() if flask.has_request_context() else ""
        return True
