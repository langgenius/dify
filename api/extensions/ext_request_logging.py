import json
import logging

import flask
import werkzeug.http
from flask import Flask
from flask.signals import request_finished, request_started

from configs import dify_config

logger = logging.getLogger(__name__)


def _is_content_type_json(content_type: str) -> bool:
    if not content_type:
        return False
    content_type_no_option, _ = werkzeug.http.parse_options_header(content_type)
    return content_type_no_option.lower() == "application/json"


def _log_request_started(_sender, **_extra):
    """Log the start of a request."""
    if not logger.isEnabledFor(logging.DEBUG):
        return

    request = flask.request
    if not (_is_content_type_json(request.content_type) and request.data):
        logger.debug("Received Request %s -> %s", request.method, request.path)
        return
    try:
        json_data = json.loads(request.data)
    except (TypeError, ValueError):
        logger.exception("Failed to parse JSON request")
        return
    formatted_json = json.dumps(json_data, ensure_ascii=False, indent=2)
    logger.debug(
        "Received Request %s -> %s, Request Body:\n%s",
        request.method,
        request.path,
        formatted_json,
    )


def _log_request_finished(_sender, response, **_extra):
    """Log the end of a request."""
    if not logger.isEnabledFor(logging.DEBUG) or response is None:
        return

    if not _is_content_type_json(response.content_type):
        logger.debug("Response %s %s", response.status, response.content_type)
        return

    response_data = response.get_data(as_text=True)
    try:
        json_data = json.loads(response_data)
    except (TypeError, ValueError):
        logger.exception("Failed to parse JSON response")
        return
    formatted_json = json.dumps(json_data, ensure_ascii=False, indent=2)
    logger.debug(
        "Response %s %s, Response Body:\n%s",
        response.status,
        response.content_type,
        formatted_json,
    )


def init_app(app: Flask):
    """Initialize the request logging extension."""
    if not dify_config.ENABLE_REQUEST_LOGGING:
        return
    request_started.connect(_log_request_started, app)
    request_finished.connect(_log_request_finished, app)
