"""Flask error responses for trigger endpoints.

Request parsing failures retain their HTTP status and response. Route handlers
translate domain failures; unexpected failures are rendered here after unwinding
the handler, so they cannot swallow a framework-generated 400 or 413.
"""

import logging

from flask import Blueprint, Response, jsonify, request
from werkzeug.exceptions import HTTPException

logger = logging.getLogger(__name__)


def register_error_handlers(blueprint: Blueprint) -> None:
    @blueprint.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException) -> HTTPException:
        return error

    @blueprint.errorhandler(Exception)
    def handle_unexpected_error(error: Exception) -> tuple[Response, int]:
        logger.exception("Trigger request failed for %s", request.path)
        message = str(error) if request.endpoint == "trigger.handle_webhook" else "An internal error has occurred."
        return jsonify({"error": "Internal server error", "message": message}), 500
