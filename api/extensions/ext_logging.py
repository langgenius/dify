import logging
import os
import sys
from datetime import datetime
from logging.handlers import RotatingFileHandler

import pytz
from flask import Flask

from configs import dify_config


def init_app(app: Flask):
    log_handlers = None
    log_file = dify_config.LOG_FILE
    if log_file:
        log_dir = os.path.dirname(log_file)
        os.makedirs(log_dir, exist_ok=True)
        log_handlers = [
            RotatingFileHandler(
                filename=log_file,
                maxBytes=dify_config.LOG_FILE_MAX_SIZE * 1024 * 1024,
                backupCount=dify_config.LOG_FILE_BACKUP_COUNT,
            ),
            logging.StreamHandler(sys.stdout),
        ]

    logging.basicConfig(
        level=dify_config.LOG_LEVEL,
        format=dify_config.LOG_FORMAT,
        datefmt=dify_config.LOG_DATEFORMAT,
        handlers=log_handlers,
        force=True,
    )

    log_tz = dify_config.LOG_TZ
    if log_tz:
        for handler in logging.root.handlers:
            handler.formatter.converter = lambda seconds: (
                datetime.fromtimestamp(seconds, tz=pytz.UTC).astimezone(log_tz).timetuple()
            )
