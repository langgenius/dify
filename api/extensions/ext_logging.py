import logging
import os
import re
import sys
from logging.handlers import RotatingFileHandler

from flask import Flask

from configs import dify_config


def replace_env_variables(text):
    def replace(match):
        var_name = match.group(1)
        var_value = os.getenv(var_name)
        return '' if var_value is None else var_value

    pattern = r'\$\{([^}]+)\}'
    return re.sub(pattern, replace, text)


def init_app(app: Flask):
    log_handlers = None
    log_file = replace_env_variables(dify_config.LOG_FILE)
    if log_file:
        log_dir = os.path.dirname(log_file)
        os.makedirs(log_dir, exist_ok=True)
        log_handlers = [
            RotatingFileHandler(
                filename=log_file,
                maxBytes=replace_env_variables(dify_config.LOG_FILE_MAX_SIZE) * 1024 * 1024,
                backupCount=replace_env_variables(dify_config.LOG_FILE_BACKUP_COUNT),
            ),
            logging.StreamHandler(sys.stdout),
        ]
    
    logging.basicConfig(
        level=replace_env_variables(dify_config.LOG_LEVEL),
        format=replace_env_variables(dify_config.LOG_FORMAT),
        datefmt=replace_env_variables(dify_config.LOG_DATEFORMAT),
        handlers=log_handlers,
        force=True,
    )
    log_tz = replace_env_variables(dify_config.LOG_TZ)
    if log_tz:
        from datetime import datetime

        import pytz

        timezone = pytz.timezone(log_tz)

        def time_converter(seconds):
            return datetime.utcfromtimestamp(seconds).astimezone(timezone).timetuple()

        for handler in logging.root.handlers:
            handler.formatter.converter = time_converter
            