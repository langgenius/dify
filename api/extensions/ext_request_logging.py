import json
import logging

import flask
from flask import Flask
from flask.signals import request_finished, request_started

from configs import dify_config

logger = logging.getLogger(__name__)


def init_app(app: Flask):
    """Initialize the request logging extension."""
    if not dify_config.ENABLE_REQUEST_LOGGING:
        return

    @request_started.connect_via(app)
    def log_request_started(sender, **extra):
        """Log the start of a request."""
        if not logger.isEnabledFor(logging.DEBUG):
            return

        request = flask.request
        content_type = request.content_type
        if request.data and "application/json" in content_type.lower():
            try:
                json_data = json.loads(request.data)
                formatted_json = json.dumps(json_data, ensure_ascii=False, indent=2)
                logger.debug(
                    "Received Request %s -> %s, Request Body:\n%s",
                    request.method,
                    request.path,
                    formatted_json,
                )
            except Exception:
                logger.exception("Failed to parse JSON request")
        else:
            logger.debug("Received Request %s -> %s", request.method, request.path)

    @request_finished.connect_via(app)
    def log_request_finished(sender, response, **extra):
        """Log the end of a request."""
        if not logger.isEnabledFor(logging.DEBUG) or response is None:
            return

        if response.content_type and "application/json" in response.content_type.lower():
            try:
                response_data = response.get_data(as_text=True)
                json_data = json.loads(response_data)
                formatted_json = json.dumps(json_data, ensure_ascii=False, indent=2)
                logger.debug(
                    "Response %s %s, Response Body:\n%s",
                    response.status,
                    response.content_type,
                    formatted_json,
                )
            except Exception:
                logger.exception("Failed to parse JSON response")
        else:
            logger.debug("Response %s %s", response.status, response.content_type)
